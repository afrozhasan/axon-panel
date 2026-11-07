import { Router } from "express";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { run } from "../lib/exec.js";
import { audit, readAudit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";
import { runSecurityScan, autoFixSecurityIssues } from "../lib/security/scanner.js";

const router = Router();

const SSH_SECURITY_CONF = "/etc/ssh/sshd_config.d/00-panel-security.conf";
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const IPV6_RE = /^[0-9a-fA-F:]+(\/\d{1,3})?$/;
const PORT_RE = /^(\d{1,5})(:\d{1,5})?$/;

function isValidIpOrCidr(ip) {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  return IP_RE.test(trimmed) || IPV6_RE.test(trimmed);
}

function parseUfwRules(stdout) {
  const lines = stdout.split("\n");
  const rules = [];

  for (const line of lines) {
    const m = line.match(
      /^\s*\[\s*(\d+)\]\s+(.*?)\s{2,}(ALLOW IN|DENY IN|REJECT IN|LIMIT IN|ALLOW OUT|DENY OUT|REJECT OUT|LIMIT OUT|ALLOW|DENY|REJECT|LIMIT)\s+(.*?)(?:\s+#\s+(.*))?$/i
    );
    if (m) {
      rules.push({
        number: parseInt(m[1], 10),
        to: m[2].trim(),
        action: m[3].trim().toUpperCase(),
        from: m[4].trim(),
        comment: (m[5] || "").trim(),
      });
    }
  }

  return rules;
}

function parseUfwVerbose(stdout) {
  const activeMatch = stdout.match(/^Status:\s*(\w+)/im);
  const active = activeMatch ? activeMatch[1].toLowerCase() === "active" : false;

  const defaultMatch = stdout.match(/Default:\s*(\w+)\s*\(incoming\),\s*(\w+)\s*\(outgoing\)/i);
  const defaultIncoming = defaultMatch ? defaultMatch[1].toLowerCase() : "deny";
  const defaultOutgoing = defaultMatch ? defaultMatch[2].toLowerCase() : "allow";

  const loggingMatch = stdout.match(/Logging:\s*(.+)/im);
  const logging = loggingMatch ? loggingMatch[1].trim() : "off";

  return { active, defaultIncoming, defaultOutgoing, logging };
}

async function getFail2banJailDetails(jail) {
  const result = await run("fail2ban-client", ["status", jail], { timeout: 10000 });
  if (!result.ok) {
    return {
      name: jail,
      currentlyFailed: 0,
      totalFailed: 0,
      currentlyBanned: 0,
      totalBanned: 0,
      bannedIps: [],
    };
  }

  const out = result.stdout;
  const currFailed = out.match(/Currently failed:\s*(\d+)/i);
  const totFailed = out.match(/Total failed:\s*(\d+)/i);
  const currBanned = out.match(/Currently banned:\s*(\d+)/i);
  const totBanned = out.match(/Total banned:\s*(\d+)/i);
  const ipList = out.match(/Banned IP list:\s*(.*)/i);

  const bannedIps = ipList && ipList[1].trim()
    ? ipList[1].trim().split(/\s+/).filter(Boolean)
    : [];

  return {
    name: jail,
    currentlyFailed: currFailed ? parseInt(currFailed[1], 10) : 0,
    totalFailed: totFailed ? parseInt(totFailed[1], 10) : 0,
    currentlyBanned: currBanned ? parseInt(currBanned[1], 10) : bannedIps.length,
    totalBanned: totBanned ? parseInt(totBanned[1], 10) : 0,
    bannedIps,
  };
}

async function getFail2banStatus() {
  const pingRes = await run("fail2ban-client", ["ping"], { timeout: 5000 });
  const active = pingRes.ok && pingRes.stdout.includes("pong");

  if (!active) {
    return { active: false, jails: [] };
  }

  const statusRes = await run("fail2ban-client", ["status"], { timeout: 10000 });
  if (!statusRes.ok) {
    return { active: true, jails: [] };
  }

  const jailMatch = statusRes.stdout.match(/Jail list:\s*(.*)/i);
  const jailNames = jailMatch && jailMatch[1].trim()
    ? jailMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const jails = await Promise.all(jailNames.map((j) => getFail2banJailDetails(j)));

  return { active: true, jails };
}

async function getSshStatus() {
  const res = await run("sshd", ["-T"], { timeout: 10000 });
  let authorizedKeysCount = 0;
  if (existsSync("/root/.ssh/authorized_keys")) {
    try {
      const content = readFileSync("/root/.ssh/authorized_keys", "utf8");
      authorizedKeysCount = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#")).length;
    } catch {}
  }

  if (!res.ok) {
    return {
      port: 22,
      permitRootLogin: "yes",
      passwordAuthentication: "yes",
      pubkeyAuthentication: "yes",
      maxAuthTries: 3,
      loginGraceTime: 30,
      authorizedKeysCount,
      active: true,
    };
  }

  const out = res.stdout;
  const portM = out.match(/^port\s+(\d+)/im);
  const rootM = out.match(/^permitrootlogin\s+(\S+)/im);
  const passM = out.match(/^passwordauthentication\s+(\S+)/im);
  const pubkeyM = out.match(/^pubkeyauthentication\s+(\S+)/im);
  const maxTriesM = out.match(/^maxauthtries\s+(\d+)/im);
  const graceM = out.match(/^logingracetime\s+(\d+)/im);

  return {
    port: portM ? parseInt(portM[1], 10) : 22,
    permitRootLogin: rootM ? rootM[1].toLowerCase() : "yes",
    passwordAuthentication: passM ? passM[1].toLowerCase() : "yes",
    pubkeyAuthentication: pubkeyM ? pubkeyM[1].toLowerCase() : "yes",
    maxAuthTries: maxTriesM ? parseInt(maxTriesM[1], 10) : 3,
    loginGraceTime: graceM ? parseInt(graceM[1], 10) : 30,
    authorizedKeysCount,
    active: true,
  };
}

async function getListeningPorts() {
  const res = await run("ss", ["-tulpn", "-H"], { timeout: 10000 });
  if (!res.ok) return [];

  const lines = res.stdout.split("\n");
  const ports = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const proto = parts[0].toLowerCase();
    const local = parts[4]; // e.g. "0.0.0.0:80", "127.0.0.1:3306", "[::]:443"
    const lastColon = local.lastIndexOf(":");
    if (lastColon === -1) continue;

    const address = local.slice(0, lastColon).replace(/%[a-z0-9_-]+/i, "");
    const portStr = local.slice(lastColon + 1);
    const port = parseInt(portStr, 10);
    if (isNaN(port)) continue;

    // Users process string: users:(("nginx",pid=813514,fd=7),...)
    const usersPart = parts.slice(5).join(" ");
    let procName = "unknown";
    let pid = null;
    const procMatch = usersPart.match(/"([^"]+)",pid=(\d+)/);
    if (procMatch) {
      procName = procMatch[1];
      pid = parseInt(procMatch[2], 10);
    }

    const isPublic = address === "0.0.0.0" || address === "[::]" || address === "*" || address === "::";
    const key = `${proto}:${port}:${address}:${procName}`;

    if (!seen.has(key)) {
      seen.add(key);
      ports.push({
        proto: proto.toUpperCase(),
        port,
        address,
        process: procName,
        pid,
        isPublic,
      });
    }
  }

  ports.sort((a, b) => a.port - b.port);
  return ports;
}

// ---------------------- ROUTES ----------------------

router.get("/overview", async (_req, res, next) => {
  try {
    const [ufwNumbered, ufwVerbose, f2b, ssh, ports] = await Promise.all([
      run("ufw", ["status", "numbered"], { timeout: 10000 }),
      run("ufw", ["status", "verbose"], { timeout: 10000 }),
      getFail2banStatus(),
      getSshStatus(),
      getListeningPorts(),
    ]);

    const ufwInfo = parseUfwVerbose(ufwVerbose.ok ? ufwVerbose.stdout : "");
    const rules = ufwNumbered.ok ? parseUfwRules(ufwNumbered.stdout) : [];
    const cfg = loadConfig();

    let totalBanned = 0;
    let currentlyBanned = 0;
    for (const j of f2b.jails) {
      totalBanned += j.totalBanned;
      currentlyBanned += j.currentlyBanned;
    }

    const publicPorts = ports.filter((p) => p.isPublic);

    // Calculate security recommendations / score
    const warnings = [];
    let passedChecks = 0;
    const totalChecks = 6;

    if (ufwInfo.active) {
      passedChecks++;
    } else {
      warnings.push("Firewall (UFW) is currently disabled");
    }

    if (f2b.active) {
      passedChecks++;
    } else {
      warnings.push("Intrusion prevention (Fail2ban) is not running");
    }

    if (ssh.permitRootLogin === "no" || ssh.permitRootLogin === "prohibit-password") {
      passedChecks++;
    } else {
      warnings.push("SSH PermitRootLogin is enabled (password login as root permitted)");
    }

    if (ssh.port !== 22) {
      passedChecks++;
    } else {
      warnings.push("SSH is running on default port 22");
    }

    if (cfg.totpEnabled) {
      passedChecks++;
    } else {
      warnings.push("Two-factor authentication (2FA) is not enabled on this panel");
    }

    if (cfg.ipAllowlist && cfg.ipAllowlist.length > 0) {
      passedChecks++;
    } else {
      warnings.push("Panel access is not restricted by an IP allowlist");
    }

    let grade = "A";
    if (passedChecks <= 2) grade = "F";
    else if (passedChecks === 3) grade = "C";
    else if (passedChecks === 4) grade = "B";
    else if (passedChecks === 5) grade = "B+";
    else grade = "A";

    res.json({
      firewall: {
        active: ufwInfo.active,
        rulesCount: rules.length,
        defaultIncoming: ufwInfo.defaultIncoming,
        defaultOutgoing: ufwInfo.defaultOutgoing,
      },
      fail2ban: {
        active: f2b.active,
        jailsCount: f2b.jails.length,
        currentlyBanned,
        totalBanned,
      },
      ssh: {
        port: ssh.port,
        permitRootLogin: ssh.permitRootLogin,
        passwordAuthentication: ssh.passwordAuthentication,
        pubkeyAuthentication: ssh.pubkeyAuthentication,
        authorizedKeysCount: ssh.authorizedKeysCount,
      },
      panel: {
        totpEnabled: !!cfg.totpEnabled,
        ipAllowlistCount: (cfg.ipAllowlist || []).length,
        sessionHours: cfg.sessionHours,
      },
      ports: {
        total: ports.length,
        public: publicPorts.length,
        localhost: ports.length - publicPorts.length,
      },
      score: {
        grade,
        passed: passedChecks,
        total: totalChecks,
        warnings,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/firewall", async (_req, res, next) => {
  try {
    const [numRes, verbRes] = await Promise.all([
      run("ufw", ["status", "numbered"], { timeout: 10000 }),
      run("ufw", ["status", "verbose"], { timeout: 10000 }),
    ]);

    const verbose = parseUfwVerbose(verbRes.ok ? verbRes.stdout : "");
    const rules = numRes.ok ? parseUfwRules(numRes.stdout) : [];

    res.json({
      active: verbose.active,
      logging: verbose.logging,
      defaultIncoming: verbose.defaultIncoming,
      defaultOutgoing: verbose.defaultOutgoing,
      rules,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/firewall/toggle", async (req, res, next) => {
  try {
    const { enable } = req.body ?? {};
    const shouldEnable = Boolean(enable);
    const args = shouldEnable ? ["--force", "enable"] : ["disable"];
    const result = await run("ufw", args, { timeout: 15000 });

    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || "Failed to toggle firewall" });
    }

    audit({
      action: shouldEnable ? "security.firewall.enable" : "security.firewall.disable",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { enable: shouldEnable },
      result: "ok",
    });

    res.json({ ok: true, active: shouldEnable });
  } catch (error) {
    next(error);
  }
});

router.post("/firewall/rules", async (req, res, next) => {
  try {
    const { port, proto = "tcp", action = "allow", from, comment } = req.body ?? {};

    if (!port || typeof port !== "string" || !PORT_RE.test(port.trim())) {
      return res.status(400).json({ error: "Invalid port or port range (e.g. 80, 443, 8000:9000)" });
    }

    const cleanPort = port.trim();
    const cleanProto = String(proto).toLowerCase();
    if (!["tcp", "udp", "any"].includes(cleanProto)) {
      return res.status(400).json({ error: "Protocol must be tcp, udp, or any" });
    }

    const cleanAction = String(action).toLowerCase();
    if (!["allow", "deny", "limit", "reject"].includes(cleanAction)) {
      return res.status(400).json({ error: "Action must be allow, deny, limit, or reject" });
    }

    const args = [cleanAction];

    if (from && from.trim() && from.trim().toLowerCase() !== "any" && from.trim().toLowerCase() !== "anywhere") {
      const cleanFrom = from.trim();
      if (!isValidIpOrCidr(cleanFrom)) {
        return res.status(400).json({ error: "Invalid source IP or CIDR notation (e.g. 192.168.1.1 or 10.0.0.0/24)" });
      }
      args.push("from", cleanFrom, "to", "any", "port", cleanPort);
      if (cleanProto !== "any") {
        args.push("proto", cleanProto);
      }
    } else {
      if (cleanProto !== "any") {
        args.push(`${cleanPort}/${cleanProto}`);
      } else {
        args.push(cleanPort);
      }
    }

    if (comment && typeof comment === "string" && comment.trim()) {
      const cleanComment = comment.trim().slice(0, 40);
      if (!/^[A-Za-z0-9 _.-]+$/.test(cleanComment)) {
        return res.status(400).json({ error: "Comment can only contain alphanumeric characters, spaces, and ._-" });
      }
      args.push("comment", cleanComment);
    }

    const result = await run("ufw", args, { timeout: 15000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || "Failed to add firewall rule" });
    }

    audit({
      action: "security.firewall.rule.add",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { port: cleanPort, proto: cleanProto, action: cleanAction, from: from || "Anywhere", comment },
      result: "ok",
    });

    res.json({ ok: true, message: "Firewall rule added successfully" });
  } catch (error) {
    next(error);
  }
});

router.delete("/firewall/rules/:number", async (req, res, next) => {
  try {
    const num = parseInt(req.params.number, 10);
    if (isNaN(num) || num < 1) {
      return res.status(400).json({ error: "Rule number must be a positive integer" });
    }

    const result = await run("ufw", ["--force", "delete", String(num)], { timeout: 15000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || `Failed to delete rule #${num}` });
    }

    audit({
      action: "security.firewall.rule.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { ruleNumber: num },
      result: "ok",
    });

    res.json({ ok: true, message: `Rule #${num} deleted successfully` });
  } catch (error) {
    next(error);
  }
});

router.post("/firewall/default", async (req, res, next) => {
  try {
    const { direction = "incoming", policy = "deny" } = req.body ?? {};
    const dir = String(direction).toLowerCase();
    const pol = String(policy).toLowerCase();

    if (!["incoming", "outgoing"].includes(dir)) {
      return res.status(400).json({ error: "Direction must be incoming or outgoing" });
    }
    if (!["allow", "deny", "reject"].includes(pol)) {
      return res.status(400).json({ error: "Policy must be allow, deny, or reject" });
    }

    const result = await run("ufw", ["default", pol, dir], { timeout: 15000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || "Failed to update default policy" });
    }

    audit({
      action: "security.firewall.default",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { direction: dir, policy: pol },
      result: "ok",
    });

    res.json({ ok: true, message: `Default ${dir} policy updated to ${pol}` });
  } catch (error) {
    next(error);
  }
});

router.get("/fail2ban", async (_req, res, next) => {
  try {
    const status = await getFail2banStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.post("/fail2ban/service", async (req, res, next) => {
  try {
    const { action = "restart" } = req.body ?? {};
    const act = String(action).toLowerCase();
    if (!["start", "stop", "restart"].includes(act)) {
      return res.status(400).json({ error: "Action must be start, stop, or restart" });
    }

    const result = await run("systemctl", [act, "fail2ban.service"], { timeout: 15000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || `Failed to ${act} fail2ban` });
    }

    audit({
      action: `security.fail2ban.${act}`,
      actor: req.actor.username,
      ip: clientIp(req),
      result: "ok",
    });

    res.json({ ok: true, message: `Fail2ban ${act} successful` });
  } catch (error) {
    next(error);
  }
});

router.post("/fail2ban/unban", async (req, res, next) => {
  try {
    const { ip, jail } = req.body ?? {};
    if (!ip || !isValidIpOrCidr(ip)) {
      return res.status(400).json({ error: "A valid IP address is required" });
    }

    const cleanIp = ip.trim();
    let result;
    if (jail && typeof jail === "string" && jail.trim()) {
      const cleanJail = jail.trim();
      result = await run("fail2ban-client", ["set", cleanJail, "unbanip", cleanIp], { timeout: 10000 });
    } else {
      result = await run("fail2ban-client", ["unban", cleanIp], { timeout: 10000 });
    }

    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || `Failed to unban IP ${cleanIp}` });
    }

    audit({
      action: "security.fail2ban.unban",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { targetIp: cleanIp, jail: jail || "all" },
      result: "ok",
    });

    res.json({ ok: true, message: `IP ${cleanIp} unbanned successfully` });
  } catch (error) {
    next(error);
  }
});

router.post("/fail2ban/ban", async (req, res, next) => {
  try {
    const { ip, jail = "sshd" } = req.body ?? {};
    if (!ip || !isValidIpOrCidr(ip)) {
      return res.status(400).json({ error: "A valid IP address is required" });
    }
    const cleanJail = String(jail).trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(cleanJail)) {
      return res.status(400).json({ error: "Invalid jail name" });
    }

    const cleanIp = ip.trim();
    const result = await run("fail2ban-client", ["set", cleanJail, "banip", cleanIp], { timeout: 10000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || `Failed to ban IP ${cleanIp} in jail ${cleanJail}` });
    }

    audit({
      action: "security.fail2ban.ban",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { targetIp: cleanIp, jail: cleanJail },
      result: "ok",
    });

    res.json({ ok: true, message: `IP ${cleanIp} banned in jail ${cleanJail}` });
  } catch (error) {
    next(error);
  }
});

router.get("/ssh", async (_req, res, next) => {
  try {
    const status = await getSshStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.post("/ssh", async (req, res, next) => {
  try {
    const {
      port,
      permitRootLogin,
      passwordAuthentication,
      pubkeyAuthentication,
      maxAuthTries,
      loginGraceTime,
    } = req.body ?? {};

    const current = await getSshStatus();
    const newPort = port !== undefined ? parseInt(port, 10) : current.port;
    if (isNaN(newPort) || newPort < 1 || newPort > 65535) {
      return res.status(400).json({ error: "SSH Port must be an integer between 1 and 65535" });
    }

    const newRoot = permitRootLogin !== undefined ? String(permitRootLogin).toLowerCase() : current.permitRootLogin;
    if (!["yes", "no", "prohibit-password", "without-password"].includes(newRoot)) {
      return res.status(400).json({ error: "PermitRootLogin must be yes, no, or prohibit-password" });
    }

    const newPass = passwordAuthentication !== undefined ? String(passwordAuthentication).toLowerCase() : current.passwordAuthentication;
    if (!["yes", "no"].includes(newPass)) {
      return res.status(400).json({ error: "PasswordAuthentication must be yes or no" });
    }

    const newPubkey = pubkeyAuthentication !== undefined ? String(pubkeyAuthentication).toLowerCase() : current.pubkeyAuthentication;
    if (!["yes", "no"].includes(newPubkey)) {
      return res.status(400).json({ error: "PubkeyAuthentication must be yes or no" });
    }

    const newTries = maxAuthTries !== undefined ? parseInt(maxAuthTries, 10) : current.maxAuthTries;
    if (isNaN(newTries) || newTries < 1 || newTries > 10) {
      return res.status(400).json({ error: "MaxAuthTries must be between 1 and 10" });
    }

    const newGrace = loginGraceTime !== undefined ? parseInt(loginGraceTime, 10) : current.loginGraceTime;
    if (isNaN(newGrace) || newGrace < 5 || newGrace > 300) {
      return res.status(400).json({ error: "LoginGraceTime must be between 5 and 300 seconds" });
    }

    // Lockout safety guard:
    // If disabling password auth or root login, ensure at least one SSH public key is installed!
    if ((newPass === "no" || newRoot === "no") && current.authorizedKeysCount === 0) {
      return res.status(400).json({
        error: "Lockout Prevention Guard: Cannot disable PasswordAuthentication or PermitRootLogin because no SSH public keys are found in /root/.ssh/authorized_keys. Please add your SSH public key first.",
      });
    }

    // If port changed, auto-allow in UFW FIRST so user is never locked out
    if (newPort !== current.port) {
      await run("ufw", ["allow", `${newPort}/tcp`, "comment", "SSH new port auto-allow"], { timeout: 10000 });
    }

    const testConf = `${SSH_SECURITY_CONF}.test`;
    const confLines = [
      "# Managed by webpanel Security Settings",
      `Port ${newPort}`,
      `PermitRootLogin ${newRoot}`,
      `PasswordAuthentication ${newPass}`,
      `PubkeyAuthentication ${newPubkey}`,
      `MaxAuthTries ${newTries}`,
      `LoginGraceTime ${newGrace}`,
      "",
    ];

    writeFileSync(testConf, confLines.join("\n"), { mode: 0o644 });

    // Test with sshd -t
    const testResult = await run("sshd", ["-t"], { timeout: 10000 });
    if (!testResult.ok) {
      try { unlinkSync(testConf); } catch {}
      return res.status(400).json({
        error: `sshd configuration test failed: ${testResult.stderr || "Syntax error in proposed config"}`,
      });
    }

    // Valid: rename to active file
    writeFileSync(SSH_SECURITY_CONF, confLines.join("\n"), { mode: 0o644 });
    try { unlinkSync(testConf); } catch {}

    // Reload systemd & restart ssh service + socket
    await run("systemctl", ["daemon-reload"], { timeout: 10000 });
    const restartRes = await run("systemctl", ["restart", "ssh.service", "ssh.socket"], { timeout: 15000 });

    if (!restartRes.ok) {
      return res.status(500).json({ error: `Config written but failed to reload SSH: ${restartRes.stderr}` });
    }

    audit({
      action: "security.ssh.update",
      actor: req.actor.username,
      ip: clientIp(req),
      params: {
        port: newPort,
        permitRootLogin: newRoot,
        passwordAuthentication: newPass,
        pubkeyAuthentication: newPubkey,
      },
      result: "ok",
    });

    res.json({ ok: true, message: "SSH configuration applied and service reloaded successfully" });
  } catch (error) {
    next(error);
  }
});

router.get("/ports", async (_req, res, next) => {
  try {
    const ports = await getListeningPorts();
    res.json({ ports });
  } catch (error) {
    next(error);
  }
});

router.get("/audit", (req, res, next) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const entries = readAudit(limit);
    res.json({ entries });
  } catch (error) {
    next(error);
  }
});

router.get("/panel", (_req, res, next) => {
  try {
    const cfg = loadConfig();
    res.json({
      totpEnabled: !!cfg.totpEnabled,
      ipAllowlist: cfg.ipAllowlist || [],
      sessionHours: cfg.sessionHours,
      adminUser: cfg.adminUser,
      panelDomain: cfg.panelDomain,
      rateLimitMax: 5,
      rateLimitLockoutMin: 15,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/scan", async (_req, res, next) => {
  try {
    const results = await runSecurityScan();
    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.post("/scan/run", async (req, res, next) => {
  try {
    const results = await runSecurityScan();
    audit({ action: "security.scan.executed", actor: req.actor.username, ip: clientIp(req), params: { grade: results.score.grade } });
    res.json(results);
  } catch (error) {
    next(error);
  }
});

router.post("/scan/fix", async (req, res, next) => {
  try {
    const result = await autoFixSecurityIssues();
    audit({ action: "security.autofix.applied", actor: req.actor.username, ip: clientIp(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
