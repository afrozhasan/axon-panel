import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, cpSync, renameSync } from "node:fs";
import { run } from "../lib/exec.js";
import { testConfig, reloadNginx } from "../lib/nginx.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";

const router = Router();
const NGINX_CONF = "/etc/nginx/nginx.conf";

router.get("/status", async (_req, res, next) => {
  try {
    const versionRes = await run("nginx", ["-v"], { timeout: 5000 });
    const version = `${versionRes.stdout}${versionRes.stderr}`.trim().replace(/^nginx version:\s*/, "");

    const statusRes = await run("systemctl", ["is-active", "nginx"], { timeout: 5000 });
    const active = statusRes.stdout.trim() === "active";

    const test = await testConfig();

    // Check worker processes count
    const psRes = await run("pgrep", ["-c", "nginx"], { timeout: 5000 });
    const processCount = psRes.ok ? Number(psRes.stdout.trim()) : 0;

    res.json({
      active,
      version,
      test,
      processCount,
      confPath: NGINX_CONF,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/versions", async (_req, res, next) => {
  try {
    const policyRes = await run("apt-cache", ["policy", "nginx"], { timeout: 10000 });
    if (!policyRes.ok) {
      return res.status(500).json({ error: "Failed to query APT policy for NGINX" });
    }

    const out = policyRes.stdout;
    const installedMatch = out.match(/Installed:\s+([^\s]+)/);
    const installedRaw = installedMatch ? installedMatch[1] : "";

    const lines = out.split("\n");
    const rawVersions = [];

    for (const line of lines) {
      const verMatch = line.match(/^\s*(?:\*{3}\s+)?(\d+\.[^\s]+)\s+(\d+)/);
      if (verMatch) {
        const raw = verMatch[1];
        let channel = "legacy";
        let channelLabel = "Legacy Release";
        if (raw.startsWith("1.31.") || raw.startsWith("1.29.") || raw.startsWith("1.27.") || raw.startsWith("1.25.")) {
          channel = "mainline";
          channelLabel = "Official Mainline";
        } else if (raw.startsWith("1.30.")) {
          channel = "stable";
          channelLabel = "Official Stable";
        } else if (raw.includes("ubuntu")) {
          channel = "distro";
          channelLabel = "Ubuntu LTS Distro";
        } else if (raw.startsWith("1.28.")) {
          channel = "legacy-1.28";
          channelLabel = "Legacy Stable 1.28";
        } else if (raw.startsWith("1.26.")) {
          channel = "legacy-1.26";
          channelLabel = "Legacy Stable 1.26";
        }

        rawVersions.push({
          raw,
          displayVersion: raw.replace(/-1~noble$/, "").replace(/-2ubuntu[0-9.]+$/, ""),
          channel,
          channelLabel,
          priority: parseInt(verMatch[2], 10),
          isCurrent: raw === installedRaw,
        });
      }
    }

    const currentItem = rawVersions.find((v) => v.isCurrent);
    const currentChannel = currentItem?.channel || "stable";

    res.json({
      currentVersion: installedRaw.replace(/-1~noble$/, "").replace(/-2ubuntu[0-9.]+$/, ""),
      currentRaw: installedRaw,
      currentChannel,
      versions: rawVersions,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/switch-version", async (req, res, next) => {
  try {
    const { version } = req.body ?? {};
    if (!version || typeof version !== "string") {
      return res.status(400).json({ error: "Version is required" });
    }

    const targetVersion = version.trim();
    if (!/^[0-9]+\.[0-9]+(\.[0-9]+)?(-[0-9a-zA-Z~.]+)?$/.test(targetVersion)) {
      return res.status(400).json({ error: "Invalid version format" });
    }

    // 1. Get current installed version
    const policyRes = await run("apt-cache", ["policy", "nginx"], { timeout: 10000 });
    const currentInstalled = policyRes.ok ? policyRes.stdout.match(/Installed:\s+([^\s]+)/)?.[1] : null;

    if (currentInstalled === targetVersion) {
      return res.json({ ok: true, version: targetVersion, message: `NGINX is already on ${targetVersion}` });
    }

    // 2. Backup /etc/nginx
    const backupDir = `/etc/nginx.pre-switch-${Date.now()}`;
    try {
      cpSync("/etc/nginx", backupDir, { recursive: true });
    } catch (e) {
      console.warn("Failed to backup /etc/nginx:", e);
    }

    // 3. Update pin if channel is specified
    try {
      if (targetVersion.includes("ubuntu")) {
        writeFileSync("/etc/apt/preferences.d/99nginx", "Package: nginx nginx-common\nPin: release o=Ubuntu\nPin-Priority: 950\n\nPackage: *\nPin: origin nginx.org\nPin-Priority: 500\n", "utf8");
      } else if (targetVersion.startsWith("1.31.")) {
        writeFileSync("/etc/apt/preferences.d/99nginx", "Package: nginx\nPin: origin nginx.org\nPin: version 1.31.*\nPin-Priority: 950\n\nPackage: *\nPin: origin nginx.org\nPin-Priority: 900\n", "utf8");
      } else if (targetVersion.startsWith("1.30.")) {
        writeFileSync("/etc/apt/preferences.d/99nginx", "Package: nginx\nPin: origin nginx.org\nPin: version 1.30.*\nPin-Priority: 950\n\nPackage: *\nPin: origin nginx.org\nPin-Priority: 900\n", "utf8");
      } else {
        writeFileSync("/etc/apt/preferences.d/99nginx", `Package: nginx\nPin: version ${targetVersion.split("-")[0]}*\nPin-Priority: 950\n\nPackage: *\nPin: origin nginx.org\nPin-Priority: 900\n`, "utf8");
      }
    } catch {}

    // 4. Install target version
    const installArgs = ["install", "-y", "--allow-downgrades", "-o", "Dpkg::Options::=--force-confold"];
    if (targetVersion.includes("ubuntu")) {
      installArgs.push(`nginx=${targetVersion}`, `nginx-common=${targetVersion}`);
    } else {
      installArgs.push(`nginx=${targetVersion}`);
    }

    const installRes = await run("apt-get", installArgs, {
      timeout: 180000,
      env: { DEBIAN_FRONTEND: "noninteractive" },
    });

    if (!installRes.ok) {
      return res.status(500).json({ error: `Package installation failed: ${installRes.stderr || installRes.stdout}` });
    }

    // 5. Ensure default.conf in conf.d is disabled if generated
    if (existsSync("/etc/nginx/conf.d/default.conf")) {
      try {
        renameSync("/etc/nginx/conf.d/default.conf", "/etc/nginx/conf.d/default.conf.disabled");
      } catch {}
    }

    // 6. Reload systemd daemon
    await run("systemctl", ["daemon-reload"], { timeout: 10000 });

    // 7. Validate syntax
    const test = await testConfig();
    if (!test.ok) {
      // Automatic rollback!
      if (currentInstalled) {
        const rollbackArgs = ["install", "-y", "--allow-downgrades", "-o", "Dpkg::Options::=--force-confold"];
        if (currentInstalled.includes("ubuntu")) {
          rollbackArgs.push(`nginx=${currentInstalled}`, `nginx-common=${currentInstalled}`);
        } else {
          rollbackArgs.push(`nginx=${currentInstalled}`);
        }
        await run("apt-get", rollbackArgs, { timeout: 180000, env: { DEBIAN_FRONTEND: "noninteractive" } });
        try {
          cpSync(backupDir, "/etc/nginx", { recursive: true });
        } catch {}
        await run("systemctl", ["restart", "nginx"], { timeout: 15000 });
      }
      return res.status(400).json({
        error: `Configuration validation failed under NGINX ${targetVersion}. Safely rolled back to ${currentInstalled}. Error: ${test.error}`,
      });
    }

    // 8. Restart service
    await run("systemctl", ["restart", "nginx"], { timeout: 20000 });

    // 9. Query new version string
    const newVerRes = await run("nginx", ["-v"], { timeout: 5000 });
    const newVersion = `${newVerRes.stdout}${newVerRes.stderr}`.trim().replace(/^nginx version:\s*/, "");

    audit({
      action: "webserver.switch_version",
      actor: req.actor?.username,
      ip: clientIp(req),
      params: { from: currentInstalled, to: targetVersion, activeVersion: newVersion },
      result: "ok",
    });

    res.json({
      ok: true,
      version: newVersion,
      rawPackage: targetVersion,
      message: `NGINX successfully switched to ${newVersion}`,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/action", async (req, res, next) => {
  try {
    const { action } = req.body ?? {};
    if (!["test", "reload", "restart", "stop", "start"].includes(action)) {
      return res.status(400).json({ error: "Invalid action" });
    }

    if (action === "test") {
      const test = await testConfig();
      return res.json(test);
    }

    if (action === "reload") {
      const test = await testConfig();
      if (!test.ok) return res.status(400).json({ error: `Nginx syntax error: ${test.error}` });
      await reloadNginx();
      audit({ action: "webserver.reload", actor: req.actor?.username, ip: clientIp(req), result: "ok" });
      return res.json({ ok: true, message: "Nginx reloaded successfully" });
    }

    const result = await run("systemctl", [action, "nginx"], { timeout: 20000 });
    if (!result.ok) return res.status(500).json({ error: result.stderr || `Failed to ${action} Nginx` });

    audit({ action: `webserver.${action}`, actor: req.actor?.username, ip: clientIp(req), result: "ok" });
    res.json({ ok: true, message: `Nginx ${action}ed successfully` });
  } catch (error) {
    next(error);
  }
});

router.get("/config", async (_req, res, next) => {
  try {
    if (!existsSync(NGINX_CONF)) {
      return res.status(404).json({ error: "nginx.conf not found" });
    }
    const content = readFileSync(NGINX_CONF, "utf8");

    const settings = {
      server_tokens: content.match(/server_tokens\s+([^;]+);/)?.[1] || "on",
      client_max_body_size: content.match(/client_max_body_size\s+([^;]+);/)?.[1] || "default (1m)",
      keepalive_timeout: content.match(/keepalive_timeout\s+([^;]+);/)?.[1] || "65",
      gzip: content.match(/gzip\s+([^;]+);/)?.[1] || "on",
    };

    res.json({ path: NGINX_CONF, content, settings });
  } catch (error) {
    next(error);
  }
});

router.post("/config", async (req, res, next) => {
  try {
    const { content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Configuration content is required" });
    }

    const oldContent = readFileSync(NGINX_CONF, "utf8");
    writeFileSync(NGINX_CONF, content, "utf8");

    const test = await testConfig();
    if (!test.ok) {
      writeFileSync(NGINX_CONF, oldContent, "utf8");
      return res.status(400).json({ error: `Nginx validation failed: ${test.error}` });
    }

    await reloadNginx();
    audit({ action: "webserver.config.save", actor: req.actor?.username, ip: clientIp(req), result: "ok" });
    res.json({ ok: true, message: "nginx.conf saved and Nginx reloaded successfully" });
  } catch (error) {
    next(error);
  }
});

router.get("/logs", async (req, res, next) => {
  try {
    const type = req.query.type === "error" ? "error" : "access";
    const lines = Math.min(Math.max(Number(req.query.lines) || 100, 10), 1000);
    const logFile = `/var/log/nginx/${type}.log`;

    if (!existsSync(logFile)) {
      return res.json({ lines: [], logFile });
    }

    const result = await run("tail", ["-n", String(lines), logFile], { timeout: 10000 });
    const logLines = result.ok
      ? result.stdout.split("\n").filter(Boolean)
      : [];

    res.json({ type, logFile, lines: logLines });
  } catch (error) {
    next(error);
  }
});

export default router;
