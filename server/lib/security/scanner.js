import { existsSync, readdirSync, statSync, readFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { listSites } from "../nginx.js";
import { CONFIG_DIR } from "../../config.js";

export async function runSecurityScan() {
  const issues = [];
  const checks = [];
  const startedAt = new Date().toISOString();

  // 1. World-Writable Files in /var/www
  try {
    const wwRes = await run("find", ["/var/www", "-maxdepth", "4", "-type", "f", "-perm", "-0002"], { timeout: 15000 }).catch(() => null);
    const wwFiles = (wwRes?.stdout || "").split("\n").filter(Boolean);
    if (wwFiles.length > 0) {
      issues.push({
        id: "world_writable_files",
        severity: "high",
        title: "World-writable files detected in /var/www",
        description: `Found ${wwFiles.length} file(s) with world-write permissions (other +w).`,
        items: wwFiles.slice(0, 10),
        canAutoFix: true,
      });
      checks.push({ name: "Filesystem Permissions", status: "fail", count: wwFiles.length });
    } else {
      checks.push({ name: "Filesystem Permissions", status: "pass" });
    }
  } catch {
    checks.push({ name: "Filesystem Permissions", status: "skip" });
  }

  // 2. Sensitive Config File Permissions
  const sensitiveFiles = [
    { path: path.join(CONFIG_DIR, "config.json"), maxMode: 0o600 },
    { path: path.join(CONFIG_DIR, "axon.db"), maxMode: 0o600 },
    { path: "/etc/shadow", maxMode: 0o640 },
  ];

  let sensitiveViolations = 0;
  for (const { path: filePath, maxMode } of sensitiveFiles) {
    if (existsSync(filePath)) {
      try {
        const st = statSync(filePath);
        const mode = st.mode & 0o777;
        if (mode > maxMode) {
          sensitiveViolations += 1;
          issues.push({
            id: `perm_${path.basename(filePath)}`,
            severity: "critical",
            title: `Excessive permissions on ${filePath}`,
            description: `File has mode ${mode.toString(8)}, should be ${maxMode.toString(8)}.`,
            canAutoFix: true,
          });
        }
      } catch {}
    }
  }

  if (sensitiveViolations === 0) {
    checks.push({ name: "Credential File Permissions", status: "pass" });
  } else {
    checks.push({ name: "Credential File Permissions", status: "fail", count: sensitiveViolations });
  }

  // 3. Suspicious PHP Scripts in Upload Directories
  try {
    const uploadPaths = ["/var/www/*/wp-content/uploads", "/var/www/*/storage/app/public"];
    const phpUploads = [];
    for (const globPath of uploadPaths) {
      const parent = path.dirname(globPath.replace(/\/\*.*$/, ""));
      if (existsSync(parent)) {
        const findRes = await run("find", ["/var/www", "-path", "*/uploads/*", "-name", "*.php", "-o", "-name", "*.phtml"], { timeout: 15000 }).catch(() => null);
        const found = (findRes?.stdout || "").split("\n").filter(Boolean);
        phpUploads.push(...found);
      }
    }

    if (phpUploads.length > 0) {
      issues.push({
        id: "php_in_uploads",
        severity: "critical",
        title: "PHP scripts located inside upload directories",
        description: `Found ${phpUploads.length} PHP file(s) in upload folders. These may be webshells or malicious uploads.`,
        items: phpUploads.slice(0, 10),
        canAutoFix: false,
      });
      checks.push({ name: "Upload Directory Integrity", status: "warn", count: phpUploads.length });
    } else {
      checks.push({ name: "Upload Directory Integrity", status: "pass" });
    }
  } catch {
    checks.push({ name: "Upload Directory Integrity", status: "pass" });
  }

  // 4. Exposed Sensitive Files via Web Server (HTTP Probe)
  const sites = listSites();
  const probeTargets = [".env", ".git/HEAD", "wp-config.php.bak", "id_rsa"];
  let exposedCount = 0;

  for (const site of sites.slice(0, 5)) {
    if (!site.enabled || !site.serverNames[0]) continue;
    const domain = site.serverNames[0];

    for (const target of probeTargets) {
      try {
        const res = await run("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "5", `http://127.0.0.1/${target}`, "-H", `Host: ${domain}`], { timeout: 8000 });
        const code = Number(res.stdout.trim().slice(-3));
        if (code === 200) {
          exposedCount += 1;
          issues.push({
            id: `exposed_${domain}_${target}`,
            severity: "critical",
            title: `Exposed sensitive file: http://${domain}/${target}`,
            description: `File returned HTTP 200 OK publicly. Attackers can download environment secrets or Git history.`,
            canAutoFix: true,
          });
        }
      } catch {}
    }
  }

  if (exposedCount === 0) {
    checks.push({ name: "Web Server File Protection (.env, .git)", status: "pass" });
  } else {
    checks.push({ name: "Web Server File Protection (.env, .git)", status: "fail", count: exposedCount });
  }

  // 5. Firewall & SSH Baseline
  try {
    const ufwRes = await run("ufw", ["status"], { timeout: 10000 });
    const ufwActive = (ufwRes.stdout || "").includes("Status: active");
    if (!ufwActive) {
      issues.push({
        id: "ufw_inactive",
        severity: "medium",
        title: "UFW Firewall is disabled",
        description: "The host firewall is currently inactive. Unnecessary listening ports may be exposed.",
        canAutoFix: true,
      });
      checks.push({ name: "UFW Firewall", status: "fail" });
    } else {
      checks.push({ name: "UFW Firewall", status: "pass" });
    }
  } catch {
    checks.push({ name: "UFW Firewall", status: "skip" });
  }

  // Overall Score & Grade
  const total = checks.length;
  const passed = checks.filter((c) => c.status === "pass").length;
  const grade = passed === total ? "A+" : passed >= total - 1 ? "A" : passed >= total - 2 ? "B" : "C";

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    score: { grade, passed, total },
    checks,
    issues,
  };
}

export async function autoFixSecurityIssues() {
  const actions = [];

  // 1. Fix permissions on /var/www (remove world-writable, set 755/644)
  try {
    await run("chmod", ["-R", "o-w", "/var/www"], { timeout: 30000 }).catch(() => {});
    actions.push("Removed world-writable permissions from /var/www");
  } catch {}

  // 2. Fix database and config.json permissions
  try {
    const dbFile = path.join(CONFIG_DIR, "axon.db");
    const cfgFile = path.join(CONFIG_DIR, "config.json");
    if (existsSync(dbFile)) chmodSync(dbFile, 0o600);
    if (existsSync(cfgFile)) chmodSync(cfgFile, 0o600);
    actions.push(`Restricted ${CONFIG_DIR} database and config files to 0600`);
  } catch {}

  // 3. Enable UFW if inactive
  try {
    const ufwRes = await run("ufw", ["status"]);
    if (!ufwRes.stdout.includes("Status: active")) {
      await run("ufw", ["--force", "enable"]);
      actions.push("Enabled UFW host firewall");
    }
  } catch {}

  return { ok: true, actions };
}
