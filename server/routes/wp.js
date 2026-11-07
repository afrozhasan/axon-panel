import { Router } from "express";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { readSite } from "../lib/nginx.js";
import { assertSiteName } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { getDb } from "../lib/db.js";
import { run } from "../lib/exec.js";

import {
  auditSecurity,
  previewHardening,
  applyHardening,
  rollbackHardening,
  scanMalwareAndFiles,
  runWpCli,
  changeDatabasePrefix,
  regenerateSaltKeys,
  toggleSecurityFeature,
} from "../lib/wp/security.js";
import {
  auditOptimization,
  applyOptimization,
  optimizeImages,
} from "../lib/wp/optimization.js";
import {
  getCacheStatus,
  previewCachePreset,
  applyCachePreset,
  purgeFastCgiCache,
  flushRedisIsolated,
  resetOpcache,
  configureCloudflare,
  purgeCloudflareCache,
} from "../lib/wp/cache.js";
import {
  getWpDatabaseInfo,
  optimizeWpTables,
  repairWpTables,
} from "../lib/wp/database.js";
import {
  listWpBackups,
  createWpBackup,
  restoreWpBackup,
  deleteWpBackup,
} from "../lib/wp/backup.js";

const router = Router();
const SITE_ROOT_BASE = "/var/www";

function assertSiteAccess(req, siteName) {
  const role = req.actor?.role;
  if (role === "super_admin" || role === "server_admin") return true;
  const db = getDb();
  const row = db.prepare("SELECT organization_id FROM websites WHERE name = ?").get(siteName);
  if (!row || row.organization_id !== (req.actor?.orgId || "org_default")) {
    const error = new Error(`Access denied to website "${siteName}"`);
    error.status = 403;
    throw error;
  }
  return true;
}

function resolveDocroot(siteName) {
  const site = readSite(siteName);
  if (site.summary?.roots && site.summary.roots[0]) {
    const root = site.summary.roots[0];
    if (root.endsWith("/public") || root.endsWith("/dist")) {
      return path.dirname(root);
    }
    return root;
  }
  return path.join(SITE_ROOT_BASE, siteName);
}

function parseWpCliJson(stdout, fallback = []) {
  if (!stdout) return fallback;
  try {
    return JSON.parse(stdout.trim());
  } catch {
    const text = stdout.trim();
    const startArr = text.indexOf("[");
    const endArr = text.lastIndexOf("]");
    if (startArr !== -1 && endArr !== -1 && endArr > startArr) {
      try {
        return JSON.parse(text.slice(startArr, endArr + 1));
      } catch {}
    }
    const startObj = text.indexOf("{");
    const endObj = text.lastIndexOf("}");
    if (startObj !== -1 && endObj !== -1 && endObj > startObj) {
      try {
        return JSON.parse(text.slice(startObj, endObj + 1));
      } catch {}
    }
    return fallback;
  }
}

// -------------------------------------------------------------
// Overview
// -------------------------------------------------------------
router.get("/:site/overview", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const [verRes, pluginsRes, themesRes, updateRes] = await Promise.all([
      runWpCli(docroot, ["core", "version"]).catch(() => ({ stdout: "unknown" })),
      runWpCli(docroot, ["plugin", "list", "--format=json"]).catch(() => ({ stdout: "[]" })),
      runWpCli(docroot, ["theme", "list", "--format=json"]).catch(() => ({ stdout: "[]" })),
      runWpCli(docroot, ["core", "check-update", "--format=json"]).catch(() => ({ stdout: "[]" })),
    ]);

    let plugins = [];
    try { plugins = JSON.parse(pluginsRes.stdout || "[]"); } catch {}
    let themes = [];
    try { themes = JSON.parse(themesRes.stdout || "[]"); } catch {}
    let updates = [];
    try { updates = JSON.parse(updateRes.stdout || "[]"); } catch {}

    const configPath = path.join(docroot, "wp-config.php");
    const configContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";

    res.json({
      siteName,
      docroot,
      version: verRes.stdout.trim(),
      updateAvailable: updates[0]?.version || null,
      pluginsCount: plugins.length,
      activePlugins: plugins.filter((p) => p.status === "active").length,
      themesCount: themes.length,
      activeTheme: themes.find((t) => t.status === "active")?.name || "Unknown",
      tablePrefix: (configContent.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || "wp_",
    });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Module 1: Security Hardening
// -------------------------------------------------------------
router.get("/:site/security/audit", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const site = readSite(siteName);
    const primaryDomain = site.summary?.serverNames?.[0] || siteName;

    const auditData = await auditSecurity(docroot, siteName, primaryDomain);
    res.json(auditData);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/preview", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { profile = "basic" } = req.body ?? {};

    const preview = await previewHardening(docroot, siteName, profile);
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/harden", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { profile = "basic", confirmed = false } = req.body ?? {};

    const result = await applyHardening(docroot, siteName, profile, confirmed);
    audit({
      action: `wp.security.harden.${profile}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, profile },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/rollback", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { backupId } = req.body ?? {};

    const result = await rollbackHardening(docroot, siteName, backupId);
    audit({
      action: "wp.security.rollback",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, backupId },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:site/security/scan", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const scanResult = await scanMalwareAndFiles(docroot);
    res.json(scanResult);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/database-prefix", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { newPrefix } = req.body ?? {};

    const result = await changeDatabasePrefix(docroot, siteName, newPrefix);
    audit({
      action: "wp.security.change_prefix",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, newPrefix: result.newPrefix },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/regenerate-salts", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const result = await regenerateSaltKeys(docroot, siteName);
    audit({
      action: "wp.security.regenerate_salts",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/security/toggle", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { feature, enabled } = req.body ?? {};

    const result = await toggleSecurityFeature(docroot, siteName, feature, enabled);
    audit({
      action: `wp.security.toggle.${feature}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, feature, enabled },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Module 2: Performance Optimization
// -------------------------------------------------------------
router.get("/:site/optimization/audit", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const site = readSite(siteName);
    const primaryDomain = site.summary?.serverNames?.[0] || siteName;

    const data = await auditOptimization(docroot, siteName, primaryDomain);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/optimization/apply", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { options = {}, isRecommendedMode = false } = req.body ?? {};

    const result = await applyOptimization(docroot, siteName, options, isRecommendedMode);
    audit({
      action: "wp.optimization.apply",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, isRecommendedMode },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/optimization/images", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const options = req.body ?? {};

    const result = await optimizeImages(docroot, siteName, options);
    audit({
      action: "wp.optimization.images",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, count: result.processedCount },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Module 3: Advanced Cache Management
// -------------------------------------------------------------
router.get("/:site/cache/status", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const status = await getCacheStatus(siteName, docroot);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/preset/preview", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { preset = "safe" } = req.body ?? {};

    const preview = await previewCachePreset(siteName, docroot, preset);
    res.json(preview);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/preset/apply", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { preset = "safe", options = {} } = req.body ?? {};

    const result = await applyCachePreset(siteName, docroot, preset, options);
    audit({
      action: `wp.cache.preset.${preset}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, preset },
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/fastcgi/purge", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);

    const result = await purgeFastCgiCache(siteName);
    audit({ action: "wp.cache.fastcgi.purge", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/redis/flush", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const result = await flushRedisIsolated(siteName, docroot);
    audit({ action: "wp.cache.redis.flush_isolated", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/opcache/reset", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);

    const result = await resetOpcache();
    audit({ action: "wp.cache.opcache.reset", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/cloudflare/config", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const { token, zoneId, devMode = false } = req.body ?? {};

    const result = await configureCloudflare(siteName, { token, zoneId, devMode });
    audit({ action: "wp.cache.cloudflare.config", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/cache/cloudflare/purge", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const { urls } = req.body ?? {};

    const result = await purgeCloudflareCache(siteName, urls);
    audit({ action: "wp.cache.cloudflare.purge", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Plugins & Themes Management
// -------------------------------------------------------------
router.get("/:site/plugins", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const [listRes, updateRes] = await Promise.all([
      runWpCli(docroot, ["plugin", "list", "--format=json"]),
      runWpCli(docroot, ["plugin", "list", "--update=available", "--format=json"]).catch(() => ({ stdout: "[]" })),
    ]);

    let plugins = [];
    try { plugins = JSON.parse(listRes.stdout || "[]"); } catch {}
    let updates = [];
    try { updates = JSON.parse(updateRes.stdout || "[]"); } catch {}

    const updateMap = new Set(updates.map((u) => u.name));
    const enriched = plugins.map((p) => ({
      ...p,
      hasUpdate: updateMap.has(p.name),
    }));

    res.json({ plugins: enriched });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/plugins/toggle", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { plugin, activate = true } = req.body ?? {};

    const action = activate ? "activate" : "deactivate";
    const result = await runWpCli(docroot, ["plugin", action, plugin]);
    audit({ action: `wp.plugin.${action}`, actor: req.actor.username, ip: clientIp(req), params: { site: siteName, plugin } });
    res.json({ ok: result.ok, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/plugins/update", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { plugin = "--all" } = req.body ?? {};

    const args = plugin === "--all" ? ["plugin", "update", "--all"] : ["plugin", "update", plugin];
    const result = await runWpCli(docroot, args);
    audit({ action: "wp.plugin.update", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, plugin } });
    res.json({ ok: result.ok, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/plugins/delete", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { plugin } = req.body ?? {};

    if (!plugin || typeof plugin !== "string") {
      return res.status(400).json({ error: "Plugin name is required" });
    }

    // Attempt deactivation first in case the plugin is active
    await runWpCli(docroot, ["plugin", "deactivate", plugin]).catch(() => {});

    const result = await runWpCli(docroot, ["plugin", "delete", plugin]);
    if (!result.ok) {
      return res.status(400).json({ error: result.stderr.trim() || result.stdout.trim() || "Failed to delete plugin" });
    }

    audit({ action: "wp.plugin.delete", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, plugin } });
    res.json({ ok: true, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

router.get("/:site/themes", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const resThemes = await runWpCli(docroot, ["theme", "list", "--format=json"]);
    const themes = parseWpCliJson(resThemes.stdout, []);

    res.json({ themes });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/themes/delete", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { theme } = req.body ?? {};

    if (!theme || typeof theme !== "string") {
      return res.status(400).json({ error: "Theme name is required" });
    }

    const resThemes = await runWpCli(docroot, ["theme", "list", "--format=json"]);
    const themes = parseWpCliJson(resThemes.stdout, []);
    const targetTheme = themes.find((t) => t.name === theme);

    if (targetTheme && (targetTheme.status === "active" || targetTheme.status === "parent")) {
      return res.status(400).json({ error: `Cannot delete active theme "${theme}". Switch to another theme first.` });
    }

    const result = await runWpCli(docroot, ["theme", "delete", theme]);
    if (!result.ok) {
      return res.status(400).json({ error: result.stderr.trim() || result.stdout.trim() || "Failed to delete theme" });
    }

    audit({ action: "wp.theme.delete", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, theme } });
    res.json({ ok: true, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// WordPress User Management
// -------------------------------------------------------------
router.get("/:site/users", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const result = await runWpCli(docroot, ["user", "list", "--format=json"]);
    const users = parseWpCliJson(result.stdout, []);
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/users/create", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { username, email, password, role = "subscriber", displayName } = req.body ?? {};

    if (!username || typeof username !== "string" || !username.trim()) {
      return res.status(400).json({ error: "Username is required" });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }

    const validRoles = ["administrator", "editor", "author", "contributor", "subscriber"];
    const targetRole = validRoles.includes(role) ? role : "subscriber";

    const args = ["user", "create", username.trim(), email.trim(), `--role=${targetRole}`];
    if (password && typeof password === "string" && password.trim()) {
      args.push(`--user_pass=${password.trim()}`);
    }
    if (displayName && typeof displayName === "string" && displayName.trim()) {
      args.push(`--display_name=${displayName.trim()}`);
    }

    const result = await runWpCli(docroot, args);
    if (!result.ok) {
      return res.status(400).json({ error: result.stderr.trim() || result.stdout.trim() || "Failed to create user" });
    }

    audit({
      action: "wp.user.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, username: username.trim(), role: targetRole },
    });

    res.json({ ok: true, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/users/update", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { id, role, password, email, displayName } = req.body ?? {};

    if (!id) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const args = ["user", "update", String(id)];
    if (role && typeof role === "string" && role.trim()) {
      args.push(`--role=${role.trim()}`);
    }
    if (email && typeof email === "string" && email.trim()) {
      args.push(`--user_email=${email.trim()}`);
    }
    if (displayName && typeof displayName === "string" && displayName.trim()) {
      args.push(`--display_name=${displayName.trim()}`);
    }
    if (password && typeof password === "string" && password.trim()) {
      args.push(`--user_pass=${password.trim()}`);
    }

    if (args.length === 3) {
      return res.status(400).json({ error: "No fields to update provided" });
    }

    const result = await runWpCli(docroot, args);
    if (!result.ok) {
      return res.status(400).json({ error: result.stderr.trim() || result.stdout.trim() || "Failed to update user" });
    }

    audit({
      action: "wp.user.update",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, id, role },
    });

    res.json({ ok: true, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/users/delete", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { id, reassignId } = req.body ?? {};

    if (!id) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const args = ["user", "delete", String(id), "--yes"];
    if (reassignId) {
      args.push(`--reassign=${String(reassignId)}`);
    }

    const result = await runWpCli(docroot, args);
    if (!result.ok) {
      return res.status(400).json({ error: result.stderr.trim() || result.stdout.trim() || "Failed to delete user" });
    }

    audit({
      action: "wp.user.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { site: siteName, id, reassignId: reassignId || null },
    });

    res.json({ ok: true, output: result.stdout.trim() });
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Database Operations
// -------------------------------------------------------------
router.get("/:site/database/tables", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const info = await getWpDatabaseInfo(docroot);
    res.json(info);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/database/optimize", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { tableName } = req.body ?? {};

    const result = await optimizeWpTables(docroot, siteName, tableName);
    audit({ action: "wp.db.optimize", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, tableName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/database/repair", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);

    const result = await repairWpTables(docroot, siteName);
    audit({ action: "wp.db.repair", actor: req.actor.username, ip: clientIp(req), params: { site: siteName } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Backups & Snapshots
// -------------------------------------------------------------
router.get("/:site/backups", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);

    const backups = listWpBackups(siteName);
    res.json({ backups });
  } catch (error) {
    next(error);
  }
});

router.post("/:site/backups/create", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { notes = "Manual WordPress snapshot" } = req.body ?? {};

    const result = await createWpBackup(siteName, docroot, { backupType: "manual", notes });
    audit({ action: "wp.backup.create", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, id: result.backupId } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:site/backups/restore", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { backupId } = req.body ?? {};
    if (!backupId) return res.status(400).json({ error: "Backup ID required" });

    const result = await restoreWpBackup(siteName, docroot, backupId);
    audit({ action: "wp.backup.restore", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, backupId } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.delete("/:site/backups/:backupId", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const { backupId } = req.params;

    const result = deleteWpBackup(siteName, backupId);
    audit({ action: "wp.backup.delete", actor: req.actor.username, ip: clientIp(req), params: { site: siteName, backupId } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// -------------------------------------------------------------
// Logs Viewer
// -------------------------------------------------------------
router.get("/:site/logs", async (req, res, next) => {
  try {
    const siteName = assertSiteName(req.params.site);
    assertSiteAccess(req, siteName);
    const docroot = resolveDocroot(siteName);
    const { source = "debug" } = req.query;

    let logLines = [];

    if (source === "debug") {
      const debugLogPath = path.join(docroot, "wp-content", "debug.log");
      if (existsSync(debugLogPath)) {
        const tailRes = await run("tail", ["-n", "100", debugLogPath]);
        logLines = (tailRes.stdout || "").split("\n").filter(Boolean);
      } else {
        logLines = ["[Notice] wp-content/debug.log does not exist or WP_DEBUG_LOG is disabled."];
      }
    } else if (source === "nginx-access") {
      const accessLogPath = "/var/log/nginx/access.log";
      if (existsSync(accessLogPath)) {
        const tailRes = await run("tail", ["-n", "100", accessLogPath]);
        logLines = (tailRes.stdout || "").split("\n").filter((l) => l.includes(siteName));
      }
    } else if (source === "nginx-error") {
      const errorLogPath = "/var/log/nginx/error.log";
      if (existsSync(errorLogPath)) {
        const tailRes = await run("tail", ["-n", "100", errorLogPath]);
        logLines = (tailRes.stdout || "").split("\n").filter((l) => l.includes(siteName) || l.includes("FastCGI"));
      }
    }

    res.json({ siteName, source, lines: logLines });
  } catch (error) {
    next(error);
  }
});

export default router;
