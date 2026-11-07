import { existsSync, readFileSync, writeFileSync, statSync, readdirSync, mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { run } from "../exec.js";
import { readSite, writeSiteValidated, reloadNginx } from "../nginx.js";
import { checkComponentVulnerabilities } from "./vulnerabilities.js";
import { getDb } from "../db.js";

const BACKUP_ROOT = "/var/backups/webpanel/wp-security";

export async function runWpCli(docroot, args = [], options = {}) {
  const fullArgs = ["--allow-root", `--path=${docroot}`, ...args];
  return run("wp", fullArgs, {
    timeout: options.timeout || 60000,
    cwd: docroot,
    env: { ...process.env, HOME: "/root" },
  });
}

function getFileMode(filePath) {
  try {
    const stat = statSync(filePath);
    return (stat.mode & 0o777).toString(8).padStart(4, "0");
  } catch {
    return null;
  }
}

/**
 * Perform a comprehensive real security audit of a WordPress installation
 */
export async function auditSecurity(docroot, siteName, domain) {
  if (!docroot || !existsSync(docroot)) {
    throw new Error(`WordPress document root does not exist: ${docroot}`);
  }

  const configPath = path.join(docroot, "wp-config.php");
  const wpConfigExists = existsSync(configPath);
  const configContent = wpConfigExists ? readFileSync(configPath, "utf8") : "";

  // 1. Core, Plugins, Themes via WP-CLI
  const [versionRes, updateRes, pluginsRes, themesRes, usersRes, checksumRes] = await Promise.all([
    runWpCli(docroot, ["core", "version"]).catch(() => ({ ok: false, stdout: "unknown" })),
    runWpCli(docroot, ["core", "check-update", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["plugin", "list", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["theme", "list", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["user", "list", "--role=administrator", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["core", "verify-checksums", "--format=json"]).catch((e) => ({ ok: false, stdout: "[]", error: e })),
  ]);

  const coreVersion = versionRes.stdout.trim() || "unknown";
  let updates = [];
  try { updates = JSON.parse(updateRes.stdout || "[]"); } catch {}
  let plugins = [];
  try { plugins = JSON.parse(pluginsRes.stdout || "[]"); } catch {}
  let themes = [];
  try { themes = JSON.parse(themesRes.stdout || "[]"); } catch {}
  let adminUsers = [];
  try { adminUsers = JSON.parse(usersRes.stdout || "[]"); } catch {}

  // 2. Vulnerability Scan against curated CVE dataset
  const componentsToCheck = [
    { name: "wordpress", version: coreVersion, type: "core" },
    ...plugins.map((p) => ({ name: p.name, version: p.version, type: "plugin" })),
    ...themes.map((t) => ({ name: t.name, version: t.version, type: "theme" })),
  ];
  const vulnReport = checkComponentVulnerabilities(componentsToCheck);

  // 3. Filesystem Permissions Inspection
  const wpConfigMode = getFileMode(configPath);
  const wpContentPath = path.join(docroot, "wp-content");
  const wpContentMode = getFileMode(wpContentPath);
  const uploadsPath = path.join(wpContentPath, "uploads");
  const uploadsMode = existsSync(uploadsPath) ? getFileMode(uploadsPath) : null;
  const indexPath = path.join(docroot, "index.php");
  const indexMode = getFileMode(indexPath);

  const permissions = {
    wpConfig: { path: "wp-config.php", mode: wpConfigMode, secure: wpConfigMode === "0600" || wpConfigMode === "0640" },
    wpContent: { path: "wp-content", mode: wpContentMode, secure: wpContentMode === "0755" || wpContentMode === "0750" },
    uploads: { path: "wp-content/uploads", mode: uploadsMode, secure: uploadsMode === "0755" || uploadsMode === "0750" },
    indexPhp: { path: "index.php", mode: indexMode, secure: indexMode === "0644" },
  };

  // 4. wp-config.php Constants Analysis
  const disallowFileEdit = /define\s*\(\s*['"]DISALLOW_FILE_EDIT['"]\s*,\s*true\s*\)/i.test(configContent);
  const disallowFileMods = /define\s*\(\s*['"]DISALLOW_FILE_MODS['"]\s*,\s*true\s*\)/i.test(configContent);
  const debugEnabled = /define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*true\s*\)/i.test(configContent);
  const debugDisplay = /define\s*\(\s*['"]WP_DEBUG_DISPLAY['"]\s*,\s*true\s*\)/i.test(configContent);
  const debugLog = /define\s*\(\s*['"]WP_DEBUG_LOG['"]\s*,\s*true\s*\)/i.test(configContent);
  const tablePrefixMatch = configContent.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/i);
  const tablePrefix = tablePrefixMatch ? tablePrefixMatch[1] : "wp_";

  // 5. Nginx Configuration Analysis
  let vhostContent = "";
  try {
    const siteObj = readSite(siteName);
    vhostContent = siteObj.content || "";
  } catch {}

  const nginxChecks = {
    blocksWpConfig: /location\s*=\s*\/wp-config\.php\s*\{[^}]*deny\s+all/i.test(vhostContent),
    blocksXmlrpc: /location\s*=\s*\/xmlrpc\.php\s*\{[^}]*deny\s+all/i.test(vhostContent),
    blocksUploadPhp: /location\s*~[^*]*\/(?:uploads|files)\/.*\\\.php\$\s*\{[^}]*deny\s+all/i.test(vhostContent) ||
                     /location\s*~\*\s*\/[^{]*(?:uploads|files)[^{]*\{[^}]*deny\s+all/i.test(vhostContent),
    blocksSensitiveFiles: /location\s*~\*\s*\\\.\(\?:bak\|conf\|dist\|fla\|in\[ci\]\|log\|psd\|sh\|sql\|sw\[op\]\|env\)\$\s*\{[^}]*deny\s+all/i.test(vhostContent) ||
                          /location\s*~\*\s*\\?\.\(\?:bak\|conf/i.test(vhostContent),
    blocksAuthorScan: /if\s*\(\$query_string\s*~\*\s*["']?author=/i.test(vhostContent),
    blocksVersionDisclosure: /location\s*~\*\s*\/[^{]*(?:readme\.html|license\.txt|wp-config-sample\.php)/i.test(vhostContent),
    blocksRestApiUsers: /location\s*~\*\s*\/wp-json\/wp\/v2\/users/i.test(vhostContent),
    hasXFrameOptions: /add_header\s+X-Frame-Options/i.test(vhostContent),
    hasXContentType: /add_header\s+X-Content-Type-Options/i.test(vhostContent),
    hasReferrerPolicy: /add_header\s+Referrer-Policy/i.test(vhostContent),
    hasHsts: /add_header\s+Strict-Transport-Security/i.test(vhostContent),
    hasPermissionsPolicy: /add_header\s+Permissions-Policy/i.test(vhostContent),
    hasLoginRateLimit: /limit_req\s+zone=\w+/i.test(vhostContent) && /wp-login\.php/i.test(vhostContent),
    hasHttpsRedirect: /listen\s+80;[\s\S]*?return\s+301\s+https:\/\//i.test(vhostContent),
    hasSsl: /listen\s+443\s+ssl/i.test(vhostContent),
  };

  // 6. Sensitive Files on Filesystem
  const sensitiveFilesList = [
    { file: ".env", risk: "high", desc: "Environment secrets file" },
    { file: ".git", risk: "critical", desc: "Git repository metadata" },
    { file: "wp-config.php.bak", risk: "critical", desc: "Backup config containing database credentials" },
    { file: "debug.log", risk: "medium", desc: "WP debug log exposed in webroot or wp-content" },
    { file: "readme.html", risk: "low", desc: "Exposes exact WordPress core version" },
    { file: "license.txt", risk: "low", desc: "Exposes WordPress distribution details" },
  ];
  const exposedFiles = sensitiveFilesList.filter((item) => {
    if (item.file === "debug.log") {
      return existsSync(path.join(docroot, "debug.log")) || existsSync(path.join(wpContentPath, "debug.log"));
    }
    return existsSync(path.join(docroot, item.file));
  });

  // 7. Core Checksum Verification
  let checksumMismatches = [];
  if (!checksumRes.ok) {
    try {
      checksumMismatches = JSON.parse(checksumRes.stdout || "[]");
    } catch {
      if (checksumRes.stdout && checksumRes.stdout.includes("doesn't verify against checksums")) {
        checksumMismatches = [{ file: "core-mismatch", reason: checksumRes.stdout.trim() }];
      }
    }
  }

  // 8. Unexpected PHP Files in Uploads (Static Heuristic)
  const unexpectedUploadPhp = [];
  if (existsSync(uploadsPath)) {
    try {
      const scanUploadsForPhp = (dir) => {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            scanUploadsForPhp(full);
          } else if (/\.(php|phtml|php[34578]|phar|suspected)$/i.test(entry.name)) {
            unexpectedUploadPhp.push({
              path: path.relative(docroot, full),
              size: statSync(full).size,
            });
          }
        }
      };
      scanUploadsForPhp(uploadsPath);
    } catch {}
  }

  // 9. Administrator Accounts & Weak Passwords Audit
  const hasDefaultAdmin = adminUsers.some((u) => u.user_login?.toLowerCase() === "admin" || u.user_login?.toLowerCase() === "administrator");
  const adminCount = adminUsers.length;

  // Safe non-destructive weak password audit:
  // Tests if any admin password matches known trivial passwords in a single check without revealing secrets
  let weakPasswordFound = false;
  let weakPasswordUser = null;
  const commonWeakList = ["admin", "password", "123456", "admin123", siteName.split(".")[0]];
  if (adminUsers.length > 0) {
    try {
      const weakCheckScript = `
        $admins = json_decode('${JSON.stringify(adminUsers.map((u) => u.user_login))}', true);
        $weaks = json_decode('${JSON.stringify(commonWeakList)}', true);
        $foundUser = null;
        foreach ($admins as $login) {
          $user = get_user_by('login', $login);
          if (!$user) continue;
          foreach ($weaks as $w) {
            if (wp_check_password($w, $user->user_pass, $user->ID)) {
              $foundUser = $login;
              break 2;
            }
          }
        }
        echo $foundUser ? $foundUser : 'NONE';
      `;
      const checkRes = await runWpCli(docroot, ["eval", weakCheckScript]);
      const resUser = checkRes.stdout.trim();
      if (resUser && resUser !== "NONE") {
        weakPasswordFound = true;
        weakPasswordUser = resUser;
      }
    } catch {}
  }

  // 10. REST API User Enumeration Check
  let restApiUserExposure = false;
  try {
    const restRes = await run("curl", [
      "-k", "-s", "-m", "5",
      `https://127.0.0.1/wp-json/wp/v2/users`,
      "-H", `Host: ${domain || siteName}`,
    ]);
    if (restRes.ok && restRes.stdout.includes('"slug":') && restRes.stdout.includes('"id":')) {
      restApiUserExposure = true;
    }
  } catch {}

  // Calculate Security Score (0 - 100)
  let score = 100;
  const deductions = [];

  if (vulnReport.criticalCount > 0) {
    score -= 35;
    deductions.push(`Critical vulnerability detected in components (-35)`);
  } else if (vulnReport.highCount > 0) {
    score -= 20;
    deductions.push(`High severity vulnerability detected in components (-20)`);
  }

  if (checksumMismatches.length > 0) {
    score -= 25;
    deductions.push(`Core WordPress checksum verification failed (-25)`);
  }

  if (unexpectedUploadPhp.length > 0) {
    score -= 20;
    deductions.push(`Executable PHP files found inside uploads directory (-20)`);
  }

  if (weakPasswordFound) {
    score -= 25;
    deductions.push(`Trivial/weak password detected on admin account '${weakPasswordUser}' (-25)`);
  }

  if (hasDefaultAdmin) {
    score -= 10;
    deductions.push(`Default 'admin' or 'administrator' account exists (-10)`);
  }

  if (!disallowFileEdit) {
    score -= 10;
    deductions.push(`Dashboard file editing is enabled (-10)`);
  }

  if (debugDisplay) {
    score -= 10;
    deductions.push(`WP_DEBUG_DISPLAY is enabled in production (-10)`);
  }

  if (!permissions.wpConfig.secure) {
    score -= 10;
    deductions.push(`wp-config.php file permissions are loose (${wpConfigMode || "unknown"}) (-10)`);
  }

  if (!nginxChecks.blocksUploadPhp) {
    score -= 10;
    deductions.push(`Nginx does not block PHP execution in uploads directory (-10)`);
  }

  if (!nginxChecks.blocksWpConfig) {
    score -= 10;
    deductions.push(`Nginx does not explicitly deny direct access to wp-config.php (-10)`);
  }

  if (!nginxChecks.blocksXmlrpc) {
    score -= 5;
    deductions.push(`XML-RPC is publicly accessible (-5)`);
  }

  if (!nginxChecks.hasXFrameOptions || !nginxChecks.hasXContentType) {
    score -= 5;
    deductions.push(`Missing core security headers (-5)`);
  }

  if (!nginxChecks.hasHttpsRedirect || !nginxChecks.hasSsl) {
    score -= 10;
    deductions.push(`Site is not enforcing HTTPS redirection (-10)`);
  }

  score = Math.max(0, Math.min(100, score));

  let grade = "A";
  if (score < 60) grade = "F";
  else if (score < 70) grade = "D";
  else if (score < 80) grade = "C";
  else if (score < 90) grade = "B";

  // Fetch current applied profile from database
  let currentProfile = "none";
  try {
    const db = getDb();
    const row = db.prepare("SELECT profile, applied_at FROM wp_security_profiles WHERE site_name = ?").get(siteName);
    if (row?.profile) currentProfile = row.profile;
  } catch {}

  return {
    siteName,
    domain: domain || siteName,
    docroot,
    score,
    grade,
    currentProfile,
    deductions,
    core: {
      version: coreVersion,
      updateAvailable: updates.length > 0 ? updates[0].version : null,
      tablePrefix,
    },
    vulnerabilities: vulnReport,
    permissions,
    wpConfig: {
      disallowFileEdit,
      disallowFileMods,
      debugEnabled,
      debugDisplay,
      debugLog,
    },
    features: {
      tablePrefix,
      isDefaultPrefix: tablePrefix === "wp_",
      wpDebug: {
        enabled: debugEnabled,
        display: debugDisplay,
        log: debugLog,
      },
      disallowFileEdit,
      disallowFileMods,
      blockXmlrpc: nginxChecks.blocksXmlrpc,
      blockUploadPhp: nginxChecks.blocksUploadPhp,
      blockWpConfig: nginxChecks.blocksWpConfig,
      blockSensitiveFiles: nginxChecks.blocksSensitiveFiles,
      blockAuthorScan: nginxChecks.blocksAuthorScan,
      blockVersionDisclosure: nginxChecks.blocksVersionDisclosure,
      securityHeaders: nginxChecks.hasXFrameOptions && nginxChecks.hasXContentType,
      blockRestApiUsers: nginxChecks.blocksRestApiUsers,
    },
    nginx: nginxChecks,
    sensitiveFiles: exposedFiles,
    integrity: {
      checksumOk: checksumMismatches.length === 0,
      mismatchesCount: checksumMismatches.length,
      mismatches: checksumMismatches.slice(0, 10),
    },
    malwareScanner: {
      unexpectedUploadPhpCount: unexpectedUploadPhp.length,
      unexpectedUploadPhp,
      disclaimer: "Notice: Heuristic static scanning and core checksum verification only. Clean results do not guarantee 100% absence of novel zero-day threats.",
    },
    authentication: {
      adminCount,
      hasDefaultAdmin,
      weakPasswordFound,
      weakPasswordUser,
      adminUsers: adminUsers.map((u) => ({ id: u.ID, login: u.user_login, email: u.user_email })),
      restApiUserExposure,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Preview hardening changes before execution
 */
export async function previewHardening(docroot, siteName, profile = "basic") {
  const configPath = path.join(docroot, "wp-config.php");
  const origConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const siteObj = readSite(siteName);
  const origVhost = siteObj.content || "";

  let newConfig = origConfig;
  let newVhost = origVhost;
  const changes = [];
  const compatibilityImpact = [];

  // 1. Basic Profile Changes
  if (profile === "basic" || profile === "advanced" || profile === "strict") {
    // wp-config.php DISALLOW_FILE_EDIT
    if (!/DISALLOW_FILE_EDIT/i.test(newConfig)) {
      newConfig = newConfig.replace("<?php", "<?php\ndefine('DISALLOW_FILE_EDIT', true);");
      changes.push({ target: "wp-config.php", change: "Add define('DISALLOW_FILE_EDIT', true);" });
    }
    // wp-config.php WP_DEBUG_DISPLAY false
    if (!/WP_DEBUG_DISPLAY/i.test(newConfig)) {
      newConfig = newConfig.replace("<?php", "<?php\ndefine('WP_DEBUG_DISPLAY', false);");
      changes.push({ target: "wp-config.php", change: "Add define('WP_DEBUG_DISPLAY', false);" });
    }

    // Nginx: Block wp-config.php & sensitive files
    if (!/location\s*=\s*\/wp-config\.php/i.test(newVhost)) {
      const blockRule = `
    # WordPress Security: Protect wp-config.php
    location = /wp-config.php {
        deny all;
    }
`;
      newVhost = insertBeforeLastClosingBrace(newVhost, blockRule);
      changes.push({ target: "nginx", change: "Block direct access to /wp-config.php" });
    }

    if (!/location\s*~\*\s*\\\.\(\?:bak\|conf/i.test(newVhost)) {
      const sensitiveRule = `
    # WordPress Security: Block sensitive file extensions
    location ~* \\.(?:bak|conf|dist|fla|in[ci]|log|psd|sh|sql|sw[op]|env)$ {
        deny all;
    }
`;
      newVhost = insertBeforeLastClosingBrace(newVhost, sensitiveRule);
      changes.push({ target: "nginx", change: "Deny access to sensitive files (.env, .sql, .bak, .log)" });
    }

    // Security Headers
    if (!/add_header\s+X-Frame-Options/i.test(newVhost)) {
      newVhost = insertAfterServerOpen(newVhost, `\n    add_header X-Frame-Options "SAMEORIGIN" always;\n    add_header X-Content-Type-Options "nosniff" always;`);
      changes.push({ target: "nginx", change: "Add X-Frame-Options and X-Content-Type-Options headers" });
    }

    compatibilityImpact.push("Basic Profile: 100% compatible with WooCommerce, Elementor, Bricks Builder, REST API, and webhooks. Disables built-in WordPress code editor.");
  }

  // 2. Advanced Profile Changes
  if (profile === "advanced" || profile === "strict") {
    // Block PHP in uploads
    if (!/location\s*~\*\s*\/(?:uploads|files)\/.*\\\.php\$/i.test(newVhost)) {
      const uploadRule = `
    # WordPress Security: Block PHP execution in upload directories
    location ~* /(?:uploads|files)/.*\\.php$ {
        deny all;
    }
`;
      newVhost = insertBeforeLastClosingBrace(newVhost, uploadRule);
      changes.push({ target: "nginx", change: "Block execution of PHP scripts in wp-content/uploads" });
    }

    // Restrict XML-RPC
    if (!/location\s*=\s*\/xmlrpc\.php/i.test(newVhost)) {
      const xmlrpcRule = `
    # WordPress Security: Restrict XML-RPC
    location = /xmlrpc.php {
        deny all;
    }
`;
      newVhost = insertBeforeLastClosingBrace(newVhost, xmlrpcRule);
      changes.push({ target: "nginx", change: "Deny public requests to /xmlrpc.php" });
    }

    // Referrer-Policy & HSTS
    if (!/add_header\s+Referrer-Policy/i.test(newVhost)) {
      newVhost = insertAfterServerOpen(newVhost, `\n    add_header Referrer-Policy "strict-origin-when-cross-origin" always;\n    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;`);
      changes.push({ target: "nginx", change: "Add Referrer-Policy and Permissions-Policy headers" });
    }

    changes.push({ target: "filesystem", change: "Set wp-config.php to 0600 and directories to 0755" });

    compatibilityImpact.push("Advanced Profile: REST API, Bricks Builder, WooCommerce cart & checkout fully preserved. Native mobile apps relying on legacy XML-RPC should switch to REST API / application passwords.");
  }

  // 3. Strict Profile Changes
  if (profile === "strict") {
    // Block readme.html, license.txt, wp-config-sample.php
    if (!/location\s*~[^*]*\/(?:readme\.html|license\.txt)/i.test(newVhost)) {
      const hideInfoRule = `
    # WordPress Security Strict: Conceal distribution files
    location ~* /(readme\\.html|license\\.txt|wp-config-sample\\.php) {
        deny all;
    }
`;
      newVhost = insertBeforeLastClosingBrace(newVhost, hideInfoRule);
      changes.push({ target: "nginx", change: "Block access to readme.html, license.txt, and wp-config-sample.php" });
    }

    // Block author enumeration: /?author=1
    if (!/if\s*\(\$query_string\s*~\*\s*author=/i.test(newVhost)) {
      const authorBlockRule = `
    # WordPress Security Strict: Prevent author username enumeration
    if ($query_string ~* "author=[0-9]+") {
        return 403;
    }
`;
      newVhost = insertAfterServerOpen(newVhost, authorBlockRule);
      changes.push({ target: "nginx", change: "Block author query string scans (?author=N)" });
    }

    compatibilityImpact.push("Strict Profile: Blocks author enumeration and version disclosure files. Compatible with standard WooCommerce & Bricks Builder.");
  }

  return {
    profile,
    siteName,
    changesCount: changes.length,
    changes,
    compatibilityImpact,
    configDiff: {
      original: origConfig,
      preview: newConfig,
    },
    vhostDiff: {
      original: origVhost,
      preview: newVhost,
    },
  };
}

/**
 * Apply a hardening profile safely with automated backup and rollback capability
 */
export async function applyHardening(docroot, siteName, profile = "basic", confirmed = false) {
  if (!confirmed) {
    throw new Error("Explicit confirmation required before applying hardening profile");
  }

  const timestamp = Date.now();
  const backupDir = path.join(BACKUP_ROOT, siteName, String(timestamp));
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  const configPath = path.join(docroot, "wp-config.php");
  const origConfig = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  const siteObj = readSite(siteName);
  const origVhost = siteObj.content || "";

  // 1. Create Atomic Backup Files
  writeFileSync(path.join(backupDir, "wp-config.php.bak"), origConfig, { mode: 0o600 });
  writeFileSync(path.join(backupDir, "nginx.conf.bak"), origVhost, { mode: 0o600 });
  writeFileSync(path.join(backupDir, "meta.json"), JSON.stringify({
    profile,
    timestamp,
    siteName,
    docroot,
    origWpConfigMode: getFileMode(configPath),
  }, null, 2), { mode: 0o600 });

  // 2. Generate Profile Changes
  const preview = await previewHardening(docroot, siteName, profile);

  try {
    // 3. Write wp-config.php
    writeFileSync(configPath, preview.configDiff.preview, { mode: 0o600 });

    // 4. Write Nginx Config with Validation
    const writeResult = await writeSiteValidated(siteName, preview.vhostDiff.preview);
    if (!writeResult.ok) {
      // Rollback wp-config.php immediately if Nginx fails
      writeFileSync(configPath, origConfig, { mode: 0o640 });
      throw new Error(`Nginx validation failed, automatically rolled back:\n${writeResult.error}`);
    }

    // 5. Reload Nginx
    const reloadResult = await reloadNginx();
    if (!reloadResult.ok) {
      // Rollback both
      writeFileSync(configPath, origConfig, { mode: 0o640 });
      await writeSiteValidated(siteName, origVhost);
      await reloadNginx();
      throw new Error(`Nginx reload failed, rolled back:\n${reloadResult.error}`);
    }

    // 6. Apply Safe Filesystem Permissions
    try {
      chmodSync(configPath, 0o600);
    } catch {}

    // 7. Record in Database
    const db = getDb();
    const updatedAudit = await auditSecurity(docroot, siteName);

    db.prepare(`
      INSERT INTO wp_security_profiles (site_name, profile, last_audit_at, audit_score, applied_at, backup_dir, previous_config_json)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, ?, ?)
      ON CONFLICT(site_name) DO UPDATE SET
        profile = excluded.profile,
        last_audit_at = excluded.last_audit_at,
        audit_score = excluded.audit_score,
        applied_at = excluded.applied_at,
        backup_dir = excluded.backup_dir,
        previous_config_json = excluded.previous_config_json,
        updated_at = CURRENT_TIMESTAMP
    `).run(siteName, profile, updatedAudit.score, backupDir, JSON.stringify({ origWpConfig: origConfig, origVhost }));

    db.prepare(`
      INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
      VALUES (?, 'security', ?, 'success', ?, ?)
    `).run(siteName, `harden.${profile}`, JSON.stringify({ changesApplied: preview.changesCount, newScore: updatedAudit.score }), backupDir);

    db.prepare(`
      INSERT INTO wp_backups (id, site_name, backup_type, backup_path, files_included, notes)
      VALUES (?, ?, 'security_pre_hardening', ?, 'wp-config.php,nginx.conf', ?)
    `).run(`sec_${timestamp}`, siteName, backupDir, `Pre-hardening backup before applying ${profile} profile`);

    return {
      ok: true,
      profile,
      backupId: `sec_${timestamp}`,
      backupDir,
      changesApplied: preview.changesCount,
      audit: updatedAudit,
    };
  } catch (err) {
    // Record failure in operations log
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
        VALUES (?, 'security', ?, 'error', ?, ?)
      `).run(siteName, `harden.${profile}`, JSON.stringify({ error: err.message }), backupDir);
    } catch {}
    throw err;
  }
}

/**
 * Roll back hardening changes from a backup
 */
export async function rollbackHardening(docroot, siteName, backupId) {
  const db = getDb();
  let backupRecord = null;
  if (backupId) {
    backupRecord = db.prepare("SELECT * FROM wp_backups WHERE id = ? AND site_name = ?").get(backupId, siteName);
  }
  if (!backupRecord) {
    const profileRow = db.prepare("SELECT backup_dir FROM wp_security_profiles WHERE site_name = ?").get(siteName);
    if (profileRow?.backup_dir && existsSync(profileRow.backup_dir)) {
      backupRecord = { backup_path: profileRow.backup_dir };
    }
  }

  if (!backupRecord || !existsSync(backupRecord.backup_path)) {
    throw new Error(`Backup record or directory not found for rollback of website ${siteName}`);
  }

  const wpConfigBak = path.join(backupRecord.backup_path, "wp-config.php.bak");
  const nginxBak = path.join(backupRecord.backup_path, "nginx.conf.bak");

  if (!existsSync(wpConfigBak) || !existsSync(nginxBak)) {
    throw new Error("Backup directory is missing wp-config.php.bak or nginx.conf.bak");
  }

  const origConfig = readFileSync(wpConfigBak, "utf8");
  const origVhost = readFileSync(nginxBak, "utf8");

  // Restore wp-config.php
  const configPath = path.join(docroot, "wp-config.php");
  writeFileSync(configPath, origConfig, { mode: 0o640 });

  // Restore Nginx
  const writeRes = await writeSiteValidated(siteName, origVhost);
  if (!writeRes.ok) {
    throw new Error(`Failed to restore Nginx configuration:\n${writeRes.error}`);
  }
  await reloadNginx();

  // Reset database profile
  db.prepare(`
    UPDATE wp_security_profiles
    SET profile = 'none', updated_at = CURRENT_TIMESTAMP
    WHERE site_name = ?
  `).run(siteName);

  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
    VALUES (?, 'security', 'rollback', 'rolled_back', ?, ?)
  `).run(siteName, JSON.stringify({ restoredBackup: backupRecord.backup_path }), backupRecord.backup_path);

  const updatedAudit = await auditSecurity(docroot, siteName);
  return {
    ok: true,
    message: "Security hardening changes rolled back successfully",
    audit: updatedAudit,
  };
}

/**
 * Perform a deep malware and suspicious-file scan
 */
export async function scanMalwareAndFiles(docroot) {
  const checksumRes = await runWpCli(docroot, ["core", "verify-checksums", "--format=json"]).catch((e) => ({
    ok: false,
    stdout: "[]",
    error: e.message || String(e),
  }));

  let checksumMismatches = [];
  try {
    checksumMismatches = JSON.parse(checksumRes.stdout || "[]");
  } catch {
    if (checksumRes.stdout && checksumRes.stdout.includes("doesn't verify")) {
      checksumMismatches = [{ file: "core-mismatch", reason: checksumRes.stdout.trim() }];
    }
  }

  // Suspicious pattern scanner
  const suspiciousFiles = [];
  const patterns = [
    { pattern: /eval\s*\(\s*(base64_decode|gzinflate|str_rot13)/i, label: "Obfuscated code execution (eval+base64/gzinflate)" },
    { pattern: /(passthru|shell_exec|system|exec)\s*\(\s*\$_(POST|GET|REQUEST|COOKIE)/i, label: "Direct web-input command execution (RCE webshell)" },
    { pattern: /(c99shell|r57shell|FilesMan|WSO_VERSION|alfa_data)/i, label: "Known webshell fingerprint" },
    { pattern: /\$GLOBALS\[['"][a-zA-Z0-9_]+['"]\]\s*=\s*['"]\\x/i, label: "Obfuscated hex global variable assignment" },
  ];

  const wpContentPath = path.join(docroot, "wp-content");
  const scanDir = (dir, depth = 0) => {
    if (depth > 6) return;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git") continue;
          scanDir(full, depth + 1);
        } else if (/\.(php|phtml|inc)$/i.test(entry.name)) {
          try {
            // Read first 100KB of file
            const content = readFileSync(full, "utf8");
            for (const { pattern, label } of patterns) {
              if (pattern.test(content)) {
                suspiciousFiles.push({
                  path: path.relative(docroot, full),
                  label,
                  size: statSync(full).size,
                });
                break;
              }
            }
          } catch {}
        }
      }
    } catch {}
  };

  if (existsSync(wpContentPath)) {
    scanDir(wpContentPath);
  }

  return {
    docroot,
    checksumPass: checksumMismatches.length === 0,
    checksumMismatches,
    suspiciousFilesCount: suspiciousFiles.length,
    suspiciousFiles,
    disclaimer: "Notice: This scanner combines official WordPress.org core checksum verification with heuristic webshell pattern inspection. Do not claim that an installation is malware-free solely because a basic scan found nothing. Advanced obfuscation, memory-resident processes, or unknown zero-day payloads require external telemetry.",
    timestamp: new Date().toISOString(),
  };
}

// Helpers for Nginx vhost manipulation
function insertBeforeLastClosingBrace(content, snippet) {
  const lastIndex = content.lastIndexOf("}");
  if (lastIndex === -1) return content + "\n" + snippet;
  return content.slice(0, lastIndex) + snippet + "\n" + content.slice(lastIndex);
}

function insertAfterServerOpen(content, snippet) {
  // Find the primary server block containing fastcgi_pass
  const serverRegex = /server\s*\{/g;
  let match;
  let targetBrace = -1;
  while ((match = serverRegex.exec(content)) !== null) {
    const start = match.index;
    const nextServer = content.indexOf("server {", start + 8);
    const blockSlice = content.slice(start, nextServer !== -1 ? nextServer : undefined);
    if (blockSlice.includes("fastcgi_pass") || blockSlice.includes("try_files $uri $uri/ /index.php")) {
      targetBrace = content.indexOf("{", start);
      break;
    }
  }

  if (targetBrace !== -1) {
    return content.slice(0, targetBrace + 1) + "\n" + snippet + content.slice(targetBrace + 1);
  }

  // Fallback to first server {
  const firstBrace = content.indexOf("{");
  if (firstBrace !== -1) {
    return content.slice(0, firstBrace + 1) + "\n" + snippet + content.slice(firstBrace + 1);
  }
  return content + "\n" + snippet;
}

/**
 * Safely update or add a PHP define() in wp-config.php
 */
export function setWpConfigConstant(content, name, value, isRaw = false) {
  const formattedVal = isRaw ? String(value) : (typeof value === "boolean" ? (value ? "true" : "false") : `'${value}'`);
  const regex = new RegExp(`define\\s*\\(\\s*['"]${name}['"]\\s*,\\s*[^)]+\\)\\s*;`, "i");
  const defLine = `define('${name}', ${formattedVal});`;

  // Match conditional definition: if ( ! defined( 'NAME' ) ) { define( 'NAME', ... ); }
  const conditionalRegex = new RegExp(`if\\s*\\(\\s*!\\s*defined\\s*\\(\\s*['"]${name}['"]\\s*\\)\\s*\\)\\s*\\{[^}]*\\}`, "is");

  if (conditionalRegex.test(content)) {
    return content.replace(conditionalRegex, defLine);
  } else if (regex.test(content)) {
    return content.replace(regex, defLine);
  } else {
    // Insert before "/* That's all, stop editing!" or require_once ABSPATH
    const insertPoint = content.search(/\/\* That's all, stop editing!/i);
    if (insertPoint !== -1) {
      return content.slice(0, insertPoint) + defLine + "\n" + content.slice(insertPoint);
    }
    const requirePoint = content.search(/require_once\s+ABSPATH/i);
    if (requirePoint !== -1) {
      return content.slice(0, requirePoint) + defLine + "\n" + content.slice(requirePoint);
    }
    return content.replace("<?php", `<?php\n${defLine}`);
  }
}

const NGINX_RULES = {
  xmlrpc: {
    pattern: /(?:#\s*[^\n]*XML-RPC\s*)?location\s*=\s*\/xmlrpc\.php\s*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security: Restrict XML-RPC
    location = /xmlrpc.php {
        deny all;
    }
`,
  },
  uploadPhp: {
    pattern: /(?:#\s*[^\n]*upload[^\n]*\s*)?location\s*~\*?\s*\/[^{]*(?:uploads|files)[^{]*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security: Block PHP execution in upload directories
    location ~* /(?:uploads|files)/.*\\.php$ {
        deny all;
    }
`,
  },
  wpConfig: {
    pattern: /(?:#\s*[^\n]*wp-config\.php\s*)?location\s*=\s*\/wp-config\.php\s*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security: Protect wp-config.php
    location = /wp-config.php {
        deny all;
    }
`,
  },
  sensitiveFiles: {
    pattern: /(?:#\s*[^\n]*sensitive[^\n]*\s*)?location\s*~\*\s*\\\.\(\?:bak\|conf\|dist\|fla\|in\[ci\]\|log\|psd\|sh\|sql\|sw\[op\]\|env\)\$\s*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security: Block sensitive file extensions
    location ~* \\.(?:bak|conf|dist|fla|in[ci]|log|psd|sh|sql|sw[op]|env)$ {
        deny all;
    }
`,
  },
  authorScan: {
    pattern: /(?:#\s*[^\n]*author[^\n]*\s*)?if\s*\(\$query_string\s*~\*\s*["']?author=[^"']+["']?\)\s*\{[^}]*return\s+403;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security Strict: Prevent author username enumeration
    if ($query_string ~* "author=[0-9]+") {
        return 403;
    }
`,
  },
  versionDisclosure: {
    pattern: /(?:#\s*[^\n]*distribution[^\n]*\s*)?location\s*~\*\s*\/[^{]*(?:readme\.html|license\.txt|wp-config-sample\.php)\s*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security Strict: Conceal distribution files
    location ~* /(readme\\.html|license\\.txt|wp-config-sample\\.php) {
        deny all;
    }
`,
  },
  securityHeaders: {
    pattern: /(?:add_header\s+X-Frame-Options[^\n]*\n|add_header\s+X-Content-Type-Options[^\n]*\n|add_header\s+Referrer-Policy[^\n]*\n|add_header\s+Permissions-Policy[^\n]*\n)/gi,
    snippet: `
    # WordPress Security: HTTP Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
`,
  },
  restApiUsers: {
    pattern: /(?:#\s*[^\n]*REST API user[^\n]*\s*)?location\s*~\*\s*\/wp-json\/wp\/v2\/users\s*\{[^}]*deny\s+all;?[^}]*\}\s*/gi,
    snippet: `
    # WordPress Security: Block REST API user enumeration
    location ~* /wp-json/wp/v2/users {
        deny all;
    }
`,
  },
};

export async function applyNginxRule(siteName, ruleKey, enable) {
  const rule = NGINX_RULES[ruleKey];
  if (!rule) throw new Error(`Unknown security rule: ${ruleKey}`);

  const siteObj = readSite(siteName);
  let vhost = siteObj.content || "";

  if (enable) {
    if (rule.pattern.test(vhost)) {
      return { ok: true, message: "Rule already active" };
    }
    if (ruleKey === "authorScan" || ruleKey === "securityHeaders") {
      vhost = insertAfterServerOpen(vhost, rule.snippet);
    } else {
      vhost = insertBeforeLastClosingBrace(vhost, rule.snippet);
    }
  } else {
    vhost = vhost.replace(rule.pattern, "").replace(/\n\s*\n\s*\n/g, "\n\n");
  }

  const writeResult = await writeSiteValidated(siteName, vhost);
  if (!writeResult.ok) {
    throw new Error(`Nginx validation failed:\n${writeResult.error}`);
  }
  const reloadResult = await reloadNginx();
  if (!reloadResult.ok) {
    throw new Error(`Nginx reload failed:\n${reloadResult.error}`);
  }
  return { ok: true };
}

/**
 * 1. Change WordPress Database Table Prefix
 */
export async function changeDatabasePrefix(docroot, siteName, newPrefix) {
  if (!newPrefix || typeof newPrefix !== "string") {
    throw new Error("A valid database table prefix is required");
  }
  let prefix = newPrefix.trim();
  if (!prefix.endsWith("_")) prefix += "_";

  if (!/^[a-zA-Z0-9_]+$/.test(prefix)) {
    throw new Error("Table prefix can only contain letters, numbers, and underscores (e.g. wp_sec7_)");
  }
  if (prefix.length < 3 || prefix.length > 20) {
    throw new Error("Table prefix must be between 3 and 20 characters in length");
  }

  const configPath = path.join(docroot, "wp-config.php");
  if (!existsSync(configPath)) throw new Error("wp-config.php not found");
  const configContent = readFileSync(configPath, "utf8");

  const match = configContent.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/);
  const currentPrefix = match ? match[1] : null;
  if (!currentPrefix) {
    throw new Error("Could not detect existing $table_prefix in wp-config.php");
  }
  if (currentPrefix === prefix) {
    throw new Error(`The database already uses prefix "${prefix}"`);
  }

  // 1. Get list of all tables starting with currentPrefix using WP-CLI
  const listScript = `
    global $wpdb;
    $escaped = addcslashes('${currentPrefix}', '_%');
    $tables = $wpdb->get_col("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name LIKE '{$escaped}%'");
    echo json_encode($tables);
  `;
  const listRes = await runWpCli(docroot, ["eval", listScript]);
  if (!listRes.ok) {
    throw new Error(`Failed to list database tables: ${listRes.stderr || listRes.stdout}`);
  }
  let tables = [];
  try {
    tables = JSON.parse(listRes.stdout.trim());
  } catch (err) {
    throw new Error(`Failed to parse tables output from WordPress: ${listRes.stdout}`);
  }

  if (!tables || tables.length === 0) {
    throw new Error(`No tables found with prefix "${currentPrefix}" in database`);
  }

  // 2. Backup wp-config.php before executing any database modifications
  const timestamp = Date.now();
  const backupDir = path.join(BACKUP_ROOT, siteName, `prefix_${timestamp}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(backupDir, "wp-config.php.bak"), configContent, { mode: 0o600 });
  writeFileSync(path.join(backupDir, "meta.json"), JSON.stringify({
    oldPrefix: currentPrefix,
    newPrefix: prefix,
    tablesCount: tables.length,
    timestamp,
  }, null, 2), { mode: 0o600 });

  // 3. Rename tables in MySQL
  const renamePairs = tables.map((t) => {
    const withoutPrefix = t.slice(currentPrefix.length);
    const newName = `${prefix}${withoutPrefix}`;
    return `\`${t}\` TO \`${newName}\``;
  });
  const renameSql = `RENAME TABLE ${renamePairs.join(", ")};`;
  const renameRes = await runWpCli(docroot, ["db", "query", renameSql]);
  if (!renameRes.ok) {
    throw new Error(`Database table rename failed: ${renameRes.stderr || renameRes.stdout}`);
  }

  // 4. Update usermeta table capabilities/user_level
  const escapedOld = currentPrefix.replace(/[_%]/g, "\\$0");
  const updateUsermetaSql = `UPDATE \`${prefix}usermeta\` SET meta_key = CONCAT('${prefix}', SUBSTRING(meta_key, ${currentPrefix.length + 1})) WHERE meta_key LIKE '${escapedOld}%';`;
  await runWpCli(docroot, ["db", "query", updateUsermetaSql]);

  // 5. Update options table (e.g. wp_user_roles)
  const updateOptionsSql = `UPDATE \`${prefix}options\` SET option_name = CONCAT('${prefix}', SUBSTRING(option_name, ${currentPrefix.length + 1})) WHERE option_name LIKE '${escapedOld}%';`;
  await runWpCli(docroot, ["db", "query", updateOptionsSql]);

  // 6. Update $table_prefix in wp-config.php
  const updatedConfig = configContent.replace(
    /\$table_prefix\s*=\s*['"][^'"]+['"]\s*;/,
    `$table_prefix = '${prefix}';`
  );
  writeFileSync(configPath, updatedConfig, { mode: 0o600 });

  // 7. Flush cache
  await runWpCli(docroot, ["cache", "flush"]).catch(() => {});

  // 8. Record in operations log
  const db = getDb();
  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
    VALUES (?, 'security', 'change_prefix', 'success', ?, ?)
  `).run(siteName, JSON.stringify({ oldPrefix: currentPrefix, newPrefix: prefix, tablesRenamed: tables.length }), backupDir);

  const updatedAudit = await auditSecurity(docroot, siteName);
  return {
    ok: true,
    oldPrefix: currentPrefix,
    newPrefix: prefix,
    tablesRenamed: tables.length,
    message: `Database prefix changed from "${currentPrefix}" to "${prefix}". Renamed ${tables.length} tables and updated wp-config.php successfully.`,
    audit: updatedAudit,
  };
}

/**
 * 2. Regenerate WordPress Secret Salt Keys
 */
export async function regenerateSaltKeys(docroot, siteName) {
  const configPath = path.join(docroot, "wp-config.php");
  if (!existsSync(configPath)) throw new Error("wp-config.php not found");
  const configContent = readFileSync(configPath, "utf8");

  const SALT_KEYS = [
    "AUTH_KEY",
    "SECURE_AUTH_KEY",
    "LOGGED_IN_KEY",
    "NONCE_KEY",
    "AUTH_SALT",
    "SECURE_AUTH_SALT",
    "LOGGED_IN_SALT",
    "NONCE_SALT",
  ];

  // Try fetching fresh salts from official WordPress.org salt service
  let newSalts = {};
  try {
    const res = await run("curl", ["-k", "-s", "-m", "5", "https://api.wordpress.org/secret-key/1.1/salt/"]);
    if (res.ok && res.stdout.includes("define(")) {
      for (const line of res.stdout.split("\n")) {
        const m = line.match(/define\(\s*['"]([A-Z_]+)['"]\s*,\s*['"](.*?)['"]\s*\);/);
        if (m && SALT_KEYS.includes(m[1])) {
          newSalts[m[1]] = m[2];
        }
      }
    }
  } catch {}

  // Fallback to local cryptographic random generator if offline or missing keys
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_ []{}<>~`+=,.;:/?|";
  for (const key of SALT_KEYS) {
    if (!newSalts[key]) {
      const bytes = crypto.randomBytes(64);
      let s = "";
      for (let i = 0; i < 64; i++) {
        s += chars[bytes[i] % chars.length];
      }
      newSalts[key] = s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    }
  }

  // Backup wp-config.php
  const timestamp = Date.now();
  const backupDir = path.join(BACKUP_ROOT, siteName, `salts_${timestamp}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(backupDir, "wp-config.php.bak"), configContent, { mode: 0o600 });

  let updatedContent = configContent;
  for (const key of SALT_KEYS) {
    const val = newSalts[key];
    const keyRegex = new RegExp(`define\\s*\\(\\s*['"]${key}['"]\\s*,\\s*['"].*?['"]\s*\\);`, "g");
    const replacement = `define( '${key}', '${val}' );`;
    if (keyRegex.test(updatedContent)) {
      updatedContent = updatedContent.replace(keyRegex, replacement);
    } else {
      updatedContent = setWpConfigConstant(updatedContent, key, val);
    }
  }

  writeFileSync(configPath, updatedContent, { mode: 0o600 });

  const db = getDb();
  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
    VALUES (?, 'security', 'regenerate_salts', 'success', ?, ?)
  `).run(siteName, JSON.stringify({ keysUpdated: SALT_KEYS.length }), backupDir);

  const updatedAudit = await auditSecurity(docroot, siteName);
  return {
    ok: true,
    keysUpdated: SALT_KEYS.length,
    message: "WordPress security salt keys regenerated successfully. All active user login sessions have been invalidated.",
    audit: updatedAudit,
  };
}

/**
 * 3. Granular Security Feature Toggle (wp-config.php & Nginx rules)
 */
export async function toggleSecurityFeature(docroot, siteName, feature, enabled) {
  const configPath = path.join(docroot, "wp-config.php");
  if (!existsSync(configPath)) throw new Error("wp-config.php not found");
  let configContent = readFileSync(configPath, "utf8");

  const db = getDb();
  let updatedConfig = false;
  let message = "";

  switch (feature) {
    case "wp_debug": {
      if (enabled) {
        configContent = setWpConfigConstant(configContent, "WP_DEBUG", true);
        configContent = setWpConfigConstant(configContent, "WP_DEBUG_LOG", true);
        configContent = setWpConfigConstant(configContent, "WP_DEBUG_DISPLAY", false);
        message = "WP_DEBUG enabled (logging enabled to debug.log, display suppressed)";
      } else {
        configContent = setWpConfigConstant(configContent, "WP_DEBUG", false);
        configContent = setWpConfigConstant(configContent, "WP_DEBUG_LOG", false);
        configContent = setWpConfigConstant(configContent, "WP_DEBUG_DISPLAY", false);
        message = "WP_DEBUG disabled";
      }
      updatedConfig = true;
      break;
    }
    case "wp_debug_display": {
      configContent = setWpConfigConstant(configContent, "WP_DEBUG_DISPLAY", Boolean(enabled));
      message = `WP_DEBUG_DISPLAY set to ${Boolean(enabled)}`;
      updatedConfig = true;
      break;
    }
    case "wp_debug_log": {
      configContent = setWpConfigConstant(configContent, "WP_DEBUG_LOG", Boolean(enabled));
      message = `WP_DEBUG_LOG set to ${Boolean(enabled)}`;
      updatedConfig = true;
      break;
    }
    case "file_edit": {
      // enabled = true means DISALLOW_FILE_EDIT is true (dashboard file editing is BLOCKED)
      configContent = setWpConfigConstant(configContent, "DISALLOW_FILE_EDIT", Boolean(enabled));
      message = enabled ? "Dashboard file editor disabled (DISALLOW_FILE_EDIT = true)" : "Dashboard file editor enabled (DISALLOW_FILE_EDIT = false)";
      updatedConfig = true;
      break;
    }
    case "file_mods": {
      configContent = setWpConfigConstant(configContent, "DISALLOW_FILE_MODS", Boolean(enabled));
      message = enabled ? "Theme/plugin installations disabled (DISALLOW_FILE_MODS = true)" : "Theme/plugin installations enabled";
      updatedConfig = true;
      break;
    }
    case "xmlrpc": {
      await applyNginxRule(siteName, "xmlrpc", Boolean(enabled));
      message = enabled ? "XML-RPC blocked in Nginx" : "XML-RPC allowed in Nginx";
      break;
    }
    case "upload_php": {
      await applyNginxRule(siteName, "uploadPhp", Boolean(enabled));
      message = enabled ? "PHP execution in uploads blocked" : "PHP execution in uploads allowed";
      break;
    }
    case "wp_config_protection": {
      await applyNginxRule(siteName, "wpConfig", Boolean(enabled));
      message = enabled ? "Direct access to wp-config.php denied in Nginx" : "wp-config.php Nginx rule removed";
      break;
    }
    case "sensitive_files": {
      await applyNginxRule(siteName, "sensitiveFiles", Boolean(enabled));
      message = enabled ? "Sensitive files (.env, .sql, .bak) blocked in Nginx" : "Sensitive files block removed";
      break;
    }
    case "author_enumeration": {
      await applyNginxRule(siteName, "authorScan", Boolean(enabled));
      message = enabled ? "Author username scanning blocked" : "Author query string allowed";
      break;
    }
    case "version_disclosure": {
      await applyNginxRule(siteName, "versionDisclosure", Boolean(enabled));
      message = enabled ? "readme.html and distribution files concealed" : "Distribution files access restored";
      break;
    }
    case "security_headers": {
      await applyNginxRule(siteName, "securityHeaders", Boolean(enabled));
      message = enabled ? "Security headers added" : "Security headers removed";
      break;
    }
    case "rest_api_users": {
      await applyNginxRule(siteName, "restApiUsers", Boolean(enabled));
      message = enabled ? "REST API /users endpoint blocked" : "REST API /users endpoint allowed";
      break;
    }
    default:
      throw new Error(`Unsupported security feature: ${feature}`);
  }

  if (updatedConfig) {
    writeFileSync(configPath, configContent, { mode: 0o600 });
  }

  // Audit log
  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json)
    VALUES (?, 'security', ?, 'success', ?)
  `).run(siteName, `toggle.${feature}`, JSON.stringify({ enabled, message }));

  const updatedAudit = await auditSecurity(docroot, siteName);
  return {
    ok: true,
    feature,
    enabled,
    message,
    audit: updatedAudit,
  };
}
