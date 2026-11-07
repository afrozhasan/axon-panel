import { Router } from "express";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { loadConfig, saveConfig, publicConfig } from "../config.js";
import { assertDomain, assertEmail, resolveSafePath } from "../lib/validate.js";
import { audit, readAudit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { reloadNginx } from "../lib/nginx.js";

const router = Router();

const SOCKET_RE = /^\/var\/run\/php\/[A-Za-z0-9._-]+\.sock$/;
const IP_RE = /^(\d{1,3}\.){3}\d{1,3}(\/\d{1,2})?$/;
const USER_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const ALLOWLIST_SNIPPET =
  existsSync("/etc/nginx/snippets/axon-panel-allowlist.conf")
    ? "/etc/nginx/snippets/axon-panel-allowlist.conf"
    : existsSync("/etc/nginx/snippets/axonpanel-allowlist.conf")
    ? "/etc/nginx/snippets/axonpanel-allowlist.conf"
    : "/etc/nginx/snippets/webpanel-allowlist.conf";
const BACKUP_ROOTS = ["/root", "/var", "/home", "/mnt", "/srv"];

router.get("/", (_req, res, next) => {
  try {
    const config = loadConfig();
    res.json({
      config: publicConfig(),
      runtime: {
        node: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryBytes: process.memoryUsage().rss,
        pid: process.pid,
      },
      allowlistSnippet: existsSync(ALLOWLIST_SNIPPET),
      backupDirExists: existsSync(config.backupDir),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const patch = {};
    const current = loadConfig();

    if (body.panelDomain !== undefined) patch.panelDomain = assertDomain(body.panelDomain);
    if (body.letsencryptEmail !== undefined) patch.letsencryptEmail = assertEmail(body.letsencryptEmail);
    if (body.sessionHours !== undefined) {
      const hours = Number(body.sessionHours);
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
        return res.status(400).json({ error: "Session length must be between 1 and 168 hours" });
      }
      patch.sessionHours = hours;
    }
    if (body.adminUser !== undefined) {
      if (typeof body.adminUser !== "string" || !USER_RE.test(body.adminUser)) {
        return res.status(400).json({ error: "Invalid admin username" });
      }
      patch.adminUser = body.adminUser;
    }
    if (body.phpFpmSocket !== undefined) {
      if (typeof body.phpFpmSocket !== "string" || !SOCKET_RE.test(body.phpFpmSocket)) {
        return res.status(400).json({ error: "PHP-FPM socket must look like /var/run/php/php8.3-fpm.sock" });
      }
      patch.phpFpmSocket = body.phpFpmSocket;
    }
    if (body.backupDir !== undefined) {
      const dir = resolveSafePath(String(body.backupDir), BACKUP_ROOTS);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      patch.backupDir = dir;
    }
    if (body.maxUploadMb !== undefined) {
      const mb = Number(body.maxUploadMb);
      if (!Number.isInteger(mb) || mb < 1 || mb > 4096) {
        return res.status(400).json({ error: "Upload limit must be between 1 and 4096 MB" });
      }
      patch.maxUploadMb = mb;
    }
    if (body.ipAllowlist !== undefined) {
      if (!Array.isArray(body.ipAllowlist)) return res.status(400).json({ error: "Allowlist must be an array" });
      const entries = body.ipAllowlist.map((entry) => String(entry).trim()).filter(Boolean);
      for (const entry of entries) {
        if (entry !== "*" && !IP_RE.test(entry)) {
          return res.status(400).json({ error: `Invalid IP or CIDR: ${entry}` });
        }
      }
      patch.ipAllowlist = entries;
    }

    if (Object.keys(patch).length === 0) return res.status(400).json({ error: "Nothing to update" });

    saveConfig(patch);
    audit({
      action: "settings.update",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { ...patch, ipAllowlist: patch.ipAllowlist ? `${patch.ipAllowlist.length} entries` : undefined },
    });
    return res.json({ ok: true, config: publicConfig(), previousDomain: current.panelDomain });
  } catch (error) {
    return next(error);
  }
});

router.post("/allowlist/apply", async (req, res, next) => {
  try {
    const { ipAllowlist } = loadConfig();
    const snippetDir = path.dirname(ALLOWLIST_SNIPPET);
    if (!existsSync(snippetDir)) mkdirSync(snippetDir, { recursive: true, mode: 0o755 });

    const lines = ["# Managed by webpanel — regenerated from the Settings page.", ""];
    if (!ipAllowlist || ipAllowlist.length === 0) {
      lines.push("# No allowlist configured; the panel is reachable from any address.", "");
    } else {
      for (const entry of ipAllowlist) {
        lines.push(entry === "*" ? "allow all;" : `allow ${entry};`);
      }
      lines.push("deny all;", "");
    }

    writeFileSync(ALLOWLIST_SNIPPET, lines.join("\n"), { mode: 0o644 });
    const reload = await reloadNginx();

    audit({
      action: "settings.allowlist.apply",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { entries: ipAllowlist.length },
      result: reload.ok ? "ok" : "error",
      detail: reload.error,
    });

    if (!reload.ok) return res.status(500).json({ error: reload.error, written: true });
    return res.json({ ok: true, file: ALLOWLIST_SNIPPET });
  } catch (error) {
    return next(error);
  }
});

router.get("/audit", (req, res, next) => {
  try {
    res.json({ entries: readAudit(req.query.limit) });
  } catch (error) {
    next(error);
  }
});

export default router;
