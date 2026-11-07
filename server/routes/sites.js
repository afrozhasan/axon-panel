import { Router } from "express";
import path from "node:path";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import {
  listSites,
  readSite,
  writeSiteValidated,
  enableSite,
  disableSite,
  deleteSite,
  testConfig,
  reloadNginx,
  ensureDirectory,
  chownPath,
  NGINX_AVAILABLE,
} from "../lib/nginx.js";
import { listTemplates, renderTemplate, templateExists, templateNeeds } from "../templates/index.js";
import { assertSiteName, assertDomain, assertPort, assertEnum, resolveSafePath } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";
import { run } from "../lib/exec.js";
import { enqueueTask } from "../lib/queue.js";
import { getDb } from "../lib/db.js";
import { randomBytes } from "node:crypto";
import { assertCanCreateWebsite } from "../lib/quotas.js";
import { isWordPress, getWpOverview, toggleWpPlugin, updateWpPlugin, applyWpHardening, optimizeWpDatabase } from "../lib/stacks/wordpress.js";
import { isLaravel, getLaravelOverview, runArtisan, readLaravelEnv, writeLaravelEnv } from "../lib/stacks/laravel.js";
import { isAstro, getAstroOverview, HEADLESS_CMS_PRESETS } from "../lib/stacks/astro.js";
import { isNodeApp, isNextJs, getNodeOverview } from "../lib/stacks/nodejs.js";
import {
  listDomainsForWebsite,
  addDomainToWebsite,
  updateDomain,
  deleteDomain,
  issueDomainSsl,
} from "../lib/domains.js";

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

function siteRootFor(name) {
  return path.join(SITE_ROOT_BASE, name);
}

function resolveAppRoot(name, summary) {
  if (summary?.roots && summary.roots[0]) {
    const root = summary.roots[0];
    if (root.endsWith("/public") || root.endsWith("/dist")) {
      return path.dirname(root);
    }
    return root;
  }
  return siteRootFor(name);
}

router.get("/", async (req, res, next) => {
  try {
    let sites = listSites();
    const role = req.actor?.role;
    if (role === "customer" || role === "developer") {
      const db = getDb();
      const userOrg = req.actor?.orgId || "org_default";
      const allowedRows = db.prepare("SELECT name FROM websites WHERE organization_id = ?").all(userOrg);
      const allowedNames = new Set(allowedRows.map((r) => r.name));
      sites = sites.filter((s) => allowedNames.has(s.name));
    }
    const version = await run("nginx", ["-v"], { timeout: 10000 });
    res.json({
      sites,
      nginx: {
        version: `${version.stdout}${version.stderr}`.trim().replace(/^nginx version:\s*/, ""),
        test: await testConfig(),
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get("/templates", (_req, res) => {
  res.json({ templates: listTemplates(), defaultSocket: loadConfig().phpFpmSocket });
});

router.get("/status", async (_req, res, next) => {
  try {
    res.json(await testConfig());
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req, res, next) => {
  try {
    const result = await testConfig();
    audit({ action: "nginx.test", actor: req.actor.username, ip: clientIp(req), result: result.ok ? "ok" : "error" });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/reload", async (req, res, next) => {
  try {
    const result = await reloadNginx();
    audit({
      action: "nginx.reload",
      actor: req.actor.username,
      ip: clientIp(req),
      result: result.ok ? "ok" : "error",
      detail: result.error,
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/:name", (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    res.json(readSite(req.params.name));
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    assertCanCreateWebsite(req.actor?.orgId, req.actor?.role);
    const body = req.body ?? {};
    const template = assertEnum(body.template, ["static", "php", "proxy", "redirect"], "template");
    if (!templateExists(template)) return res.status(400).json({ error: "Unknown template" });

    const domain = assertDomain(body.domain);
    const name = body.name ? assertSiteName(body.name) : assertSiteName(domain);
    const aliases = Array.isArray(body.aliases) ? body.aliases.filter(Boolean).map(assertDomain) : [];
    const needs = templateNeeds(template);

    const config = loadConfig();
    const vars = { serverNames: [domain, ...aliases].join(" "), maxBody: "50M" };

    if (needs.port || template === "proxy") {
      vars.port = assertPort(body.port);
    }
    if (needs.socket || template === "php") {
      vars.socket = body.socket ? String(body.socket) : config.phpFpmSocket;
      if (vars.socket && (vars.socket.includes("php7.4") || vars.socket.includes("php7.") || vars.socket.includes("php5."))) {
        return res.status(400).json({
          error: "PHP 7.4 and older versions are end-of-life and strictly prohibited. Axon Panel requires PHP 8.1 or higher (PHP 8.3 recommended).",
        });
      }
    }
    if (template === "redirect") {
      const target = assertDomain(body.target);
      vars.target = `https://${target}`;
    }

    let root = null;
    if (template !== "redirect") {
      const requested = body.root ? resolveSafePath(String(body.root), [SITE_ROOT_BASE]) : siteRootFor(name);
      root = requested;
      vars.root = requested;
    }

    const content = renderTemplate(template, vars);
    const result = await writeSiteValidated(name, content);

    if (!result.ok) {
      audit({
        action: "site.create",
        actor: req.actor.username,
        ip: clientIp(req),
        params: { name, domain, template },
        result: "error",
        detail: result.error,
      });
      return res.status(400).json({ error: `nginx rejected the generated configuration:\n${result.error}` });
    }

    let createdPath = null;
    if (root && body.createRoot !== false) {
      ensureDirectory(root);
      if (template === "php") ensureDirectory(path.join(root, "public"));
      const owner = body.owner ? String(body.owner) : template === "php" ? "www-data" : null;
      if (owner) chownPath(root, owner, owner);
      createdPath = root;
    }

    let enabled = false;
    if (body.enable !== false) {
      const enableResult = await enableSite(name);
      enabled = enableResult.ok;
      if (!enableResult.ok) {
        return res.status(500).json({ error: enableResult.error, created: true, name });
      }
    }

    // Persist to SQLite websites registry
    try {
      const db = getDb();
      const siteId = `site_${randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR REPLACE INTO websites (id, organization_id, name, primary_domain, app_type, document_root)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(siteId, req.actor?.orgId || "org_default", name, domain, template, root || siteRootFor(name));
    } catch {
      /* ignore */
    }

    audit({
      action: "site.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name, domain, template, enabled },
    });
    return res.status(201).json({ ok: true, name, enabled, root: createdPath, summary: result.summary });
  } catch (error) {
    return next(error);
  }
});

router.put("/:name", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const { content } = req.body ?? {};
    if (typeof content !== "string" || content.length === 0) {
      return res.status(400).json({ error: "Config content is required" });
    }
    if (Buffer.byteLength(content) > 512 * 1024) {
      return res.status(413).json({ error: "Config is too large" });
    }

    const result = await writeSiteValidated(name, content);
    audit({
      action: "site.update",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
      detail: result.error,
    });

    if (!result.ok) {
      return res.status(400).json({
        error: `nginx rejected the configuration. Your previous version has been restored.\n\n${result.error}`,
      });
    }

    const reload = await reloadNginx();
    return res.json({ ok: true, summary: result.summary, reloaded: reload.ok, reloadError: reload.error });
  } catch (error) {
    return next(error);
  }
});

router.post("/:name/enable", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const result = await enableSite(name);
    audit({
      action: "site.enable",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
      detail: result.error,
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/:name/disable", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const result = await disableSite(name);
    audit({
      action: "site.disable",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
      detail: result.error,
    });
    if (!result.ok) return res.status(500).json({ error: result.error });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/:name", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    if (req.body?.confirm !== name) {
      return res.status(400).json({ error: "Type the exact site name to confirm deletion" });
    }
    const result = deleteSite(name);
    await reloadNginx();
    try {
      getDb().prepare("DELETE FROM websites WHERE name = ?").run(name);
    } catch {
      /* ignore */
    }
    audit({ action: "site.delete", actor: req.actor.username, ip: clientIp(req), params: { name, backup: result.backup } });
    return res.json({ ok: true, backup: result.backup });
  } catch (error) {
    return next(error);
  }
});

router.post("/:name/switch-php", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const { version } = req.body ?? {};
    if (!version || !/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Valid PHP version required (e.g. 8.2, 8.3, 8.4)" });
    }
    if (parseFloat(version) < 8.1 || version === "7.4" || version.startsWith("7.") || version.startsWith("5.")) {
      return res.status(400).json({
        error: "PHP 7.4 and older versions are end-of-life and strictly prohibited. Axon Panel requires PHP 8.1 or higher (PHP 8.3 recommended).",
      });
    }

    const file = path.join(NGINX_AVAILABLE, name);
    if (!existsSync(file)) return res.status(404).json({ error: "Site not found" });

    let content = readFileSync(file, "utf8");
    if (!content.includes("fastcgi_pass")) {
      return res.status(400).json({ error: "This site does not use FastCGI / PHP" });
    }

    const sock = `/var/run/php/php${version}-fpm.sock`;
    const oldContent = content;
    content = content.replace(
      /fastcgi_pass\s+unix:\/var\/run\/php\/php[0-9.]+-fpm\.sock;/g,
      `fastcgi_pass unix:${sock};`,
    );

    writeFileSync(file, content, "utf8");
    const test = await testConfig();
    if (!test.ok) {
      writeFileSync(file, oldContent, "utf8");
      return res.status(400).json({ error: `Nginx test failed: ${test.error}` });
    }

    await reloadNginx();
    audit({ action: "site.switch_php", actor: req.actor.username, ip: clientIp(req), params: { name, version }, result: "ok" });
    res.json({ ok: true, message: `Switched ${name} to PHP ${version}` });
  } catch (error) {
    next(error);
  }
});

// Stack Detection & Overview
router.get("/:name/stack", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    if (isWordPress(docroot)) {
      const wp = await getWpOverview(docroot);
      return res.json({ type: "wordpress", docroot, details: wp });
    }
    if (isLaravel(docroot)) {
      const laravel = await getLaravelOverview(docroot);
      return res.json({ type: "laravel", docroot, details: laravel });
    }
    if (isAstro(docroot)) {
      const astro = await getAstroOverview(docroot);
      return res.json({ type: "astro", docroot, details: astro });
    }
    if (isNodeApp(docroot)) {
      const node = await getNodeOverview(docroot);
      return res.json({ type: node.isNextJs ? "nextjs" : "nodejs", docroot, details: node });
    }

    return res.json({
      type: site.summary.kind === "php" ? "php" : site.summary.kind === "proxy" ? "proxy" : "static",
      docroot,
      details: { summary: site.summary },
    });
  } catch (error) {
    next(error);
  }
});

// WordPress Toolkit Endpoints
router.get("/:name/wordpress", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const overview = await getWpOverview(docroot);
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

router.post("/:name/wordpress/plugin", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const { plugin, action } = req.body ?? {};
    if (!plugin) return res.status(400).json({ error: "Plugin identifier required" });

    if (action === "update") {
      const result = await updateWpPlugin(docroot, plugin);
      audit({ action: "wp.plugin.update", actor: req.actor.username, ip: clientIp(req), params: { site: name, plugin } });
      return res.json(result);
    }

    const activate = action === "activate";
    const result = await toggleWpPlugin(docroot, plugin, activate);
    audit({ action: `wp.plugin.${action}`, actor: req.actor.username, ip: clientIp(req), params: { site: name, plugin } });
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:name/wordpress/harden", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const result = await applyWpHardening(docroot);
    audit({ action: "wp.harden", actor: req.actor.username, ip: clientIp(req), params: { site: name } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/:name/wordpress/optimize", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const result = await optimizeWpDatabase(docroot);
    audit({ action: "wp.db.optimize", actor: req.actor.username, ip: clientIp(req), params: { site: name } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Laravel Framework Endpoints
router.get("/:name/laravel", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const overview = await getLaravelOverview(docroot);
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

router.post("/:name/laravel/artisan", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const { command, args } = req.body ?? {};
    if (!command) return res.status(400).json({ error: "Artisan command required" });

    const result = await runArtisan(docroot, command, Array.isArray(args) ? args : []);
    audit({ action: "laravel.artisan", actor: req.actor.username, ip: clientIp(req), params: { site: name, command } });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/:name/laravel/env", (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const env = readLaravelEnv(docroot);
    res.json({ env });
  } catch (error) {
    next(error);
  }
});

router.post("/:name/laravel/env", (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);
    const { env } = req.body ?? {};
    if (!env || typeof env !== "object") return res.status(400).json({ error: "Environment object required" });

    writeLaravelEnv(docroot, env);
    audit({ action: "laravel.env.update", actor: req.actor.username, ip: clientIp(req), params: { site: name } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Node.js & Astro Endpoints
router.get("/:name/node", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    if (isAstro(docroot)) {
      const astro = await getAstroOverview(docroot);
      return res.json({ type: "astro", ...astro });
    }

    const node = await getNodeOverview(docroot);
    res.json({ type: node.isNextJs ? "nextjs" : "nodejs", ...node });
  } catch (error) {
    next(error);
  }
});

router.post("/:name/node/build", (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    const task = enqueueTask({
      taskType: "app.build",
      payload: { siteName: name, docroot },
      userId: req.actor.id || null,
    });

    audit({ action: "app.build.enqueued", actor: req.actor.username, ip: clientIp(req), params: { site: name, taskId: task.id } });
    res.json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

// Git status and deployment
router.get("/:name/git", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    // Read deploy SSH public key if available
    let deployKey = "";
    const edKeyPath = "/root/.ssh/id_ed25519.pub";
    const rsaKeyPath = "/root/.ssh/id_rsa.pub";
    if (existsSync(edKeyPath)) {
      deployKey = readFileSync(edKeyPath, "utf8").trim();
    } else if (existsSync(rsaKeyPath)) {
      deployKey = readFileSync(rsaKeyPath, "utf8").trim();
    }

    const hostHeader = req.get("host") || config.panelDomain || "localhost";
    const protocol = req.protocol === "http" && !req.secure ? "http" : "https";
    const webhookUrl = `${protocol}://${hostHeader}/api/sites/${encodeURIComponent(name)}/git/webhook`;

    const gitDir = path.join(docroot, ".git");
    if (!existsSync(gitDir)) {
      return res.json({
        hasGit: false,
        docroot,
        deployKey,
        webhookUrl,
      });
    }

    const [branchRes, commitRes, statusRes, remoteRes] = await Promise.all([
      run("git", ["-C", docroot, "branch", "--show-current"]).catch(() => ({ ok: false, stdout: "" })),
      run("git", ["-C", docroot, "log", "-1", "--format=%H%n%h%n%s%n%an%n%cr"]).catch(() => ({ ok: false, stdout: "" })),
      run("git", ["-C", docroot, "status", "--porcelain"]).catch(() => ({ ok: false, stdout: "" })),
      run("git", ["-C", docroot, "config", "--get", "remote.origin.url"]).catch(() => ({ ok: false, stdout: "" })),
    ]);

    const logLines = (commitRes.stdout || "").trim().split("\n");
    const commitHash = logLines[0] || "";
    const commitShort = logLines[1] || "";
    const message = logLines[2] || "";
    const author = logLines[3] || "";
    const date = logLines[4] || "";

    res.json({
      hasGit: true,
      docroot,
      branch: branchRes.stdout.trim() || "main",
      commit: commitShort,
      commitHash,
      message,
      author,
      date,
      latestCommit: commitShort ? `${commitShort} - ${message} (${date}) <${author}>` : "",
      remoteUrl: remoteRes.stdout.trim() || "",
      clean: !statusRes.stdout.trim(),
      changesCount: statusRes.stdout.trim().split("\n").filter(Boolean).length,
      deployKey,
      webhookUrl,
    });
  } catch (error) {
    next(error);
  }
});

// Connect remote repository or initialize local git
router.post("/:name/git/connect", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    const { repoUrl, branch = "main", action = "clone", runBuild = true } = req.body ?? {};

    if (!repoUrl && action !== "init") {
      return res.status(400).json({ error: "Repository URL is required (e.g. https://github.com/org/repo.git or git@github.com:...)" });
    }

    const cleanBranch = (branch || "main").trim();
    const cleanUrl = repoUrl ? repoUrl.trim() : "";

    if (action === "init") {
      await run("git", ["-C", docroot, "init"]);
      if (cleanUrl) {
        await run("git", ["-C", docroot, "remote", "add", "origin", cleanUrl]).catch(() =>
          run("git", ["-C", docroot, "remote", "set-url", "origin", cleanUrl])
        );
      }
      await run("git", ["-C", docroot, "add", "-A"]);
      await run("git", ["-C", docroot, "commit", "-m", "Initial commit from Axon Panel"]).catch(() => {});
      await run("chown", ["-R", "www-data:www-data", docroot]).catch(() => {});
      audit({ action: "git.init", actor: req.actor.username, ip: clientIp(req), params: { site: name } });
      return res.json({ ok: true, message: "Local Git repository initialized" });
    }

    // Connect remote repository
    const gitDir = path.join(docroot, ".git");
    if (!existsSync(gitDir)) {
      await run("git", ["-C", docroot, "init"]);
      await run("git", ["-C", docroot, "remote", "add", "origin", cleanUrl]).catch(() =>
        run("git", ["-C", docroot, "remote", "set-url", "origin", cleanUrl])
      );
    } else {
      await run("git", ["-C", docroot, "remote", "set-url", "origin", cleanUrl]).catch(() =>
        run("git", ["-C", docroot, "remote", "add", "origin", cleanUrl])
      );
    }

    // Fetch and checkout branch
    const fetchRes = await run("git", ["-C", docroot, "fetch", "origin", cleanBranch], { timeout: 120000 });
    if (!fetchRes.ok) {
      return res.status(400).json({
        error: `Git fetch failed: ${fetchRes.stderr || fetchRes.stdout || "Unknown error"}. Check repository URL and branch name. For private repositories, ensure the server deploy key has been added.`
      });
    }

    const checkoutRes = await run("git", ["-C", docroot, "checkout", "-f", "-B", cleanBranch, `origin/${cleanBranch}`]);
    if (!checkoutRes.ok) {
      return res.status(400).json({ error: `Git checkout failed: ${checkoutRes.stderr || checkoutRes.stdout}` });
    }
    await run("git", ["-C", docroot, "branch", "-u", `origin/${cleanBranch}`, cleanBranch]).catch(() => {});

    // Ensure permissions
    await run("chown", ["-R", "www-data:www-data", docroot]).catch(() => {});

    // Update astro_projects if site is tracked there
    try {
      const db = getDb();
      db.prepare("UPDATE astro_projects SET git_repo = ?, git_branch = ? WHERE name = ? OR frontend_domain = ?").run(cleanUrl, cleanBranch, name, name);
    } catch {}

    // Auto-run build if requested and package.json exists
    let buildTask = null;
    if (runBuild && existsSync(path.join(docroot, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(docroot, "package.json"), "utf8"));
        if (pkg.scripts?.build) {
          buildTask = enqueueTask({
            taskType: "app.build",
            payload: { siteName: name, docroot },
            userId: req.actor.id || null,
          });
        }
      } catch {}
    }

    audit({ action: "git.connect", actor: req.actor.username, ip: clientIp(req), params: { site: name, repoUrl: cleanUrl, branch: cleanBranch } });
    res.json({ ok: true, message: `Successfully connected to ${cleanUrl} (${cleanBranch})`, buildTask });
  } catch (error) {
    next(error);
  }
});

// Pull latest changes from remote
router.post("/:name/git/pull", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    const gitDir = path.join(docroot, ".git");
    if (!existsSync(gitDir)) {
      return res.status(400).json({ error: "No Git repository found in site root" });
    }

    const branchRes = await run("git", ["-C", docroot, "branch", "--show-current"]).catch(() => ({ ok: false, stdout: "main" }));
    const branch = branchRes.stdout.trim() || "main";

    const pullRes = await run("git", ["-C", docroot, "pull", "origin", branch], { timeout: 120000 });
    if (!pullRes.ok) {
      return res.status(400).json({ error: `Git pull failed: ${pullRes.stderr || pullRes.stdout}` });
    }

    await run("chown", ["-R", "www-data:www-data", docroot]).catch(() => {});

    const { rebuild = true } = req.body ?? {};
    let buildTask = null;
    if (rebuild && existsSync(path.join(docroot, "package.json"))) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(docroot, "package.json"), "utf8"));
        if (pkg.scripts?.build) {
          buildTask = enqueueTask({
            taskType: "app.build",
            payload: { siteName: name, docroot },
            userId: req.actor.id || null,
          });
        }
      } catch {}
    }

    audit({ action: "git.pull", actor: req.actor.username, ip: clientIp(req), params: { site: name, branch } });
    res.json({
      ok: true,
      output: pullRes.stdout || "Already up to date.",
      buildTask,
    });
  } catch (error) {
    next(error);
  }
});

// Switch branch
router.post("/:name/git/branch", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    const { branch } = req.body ?? {};
    if (!branch) return res.status(400).json({ error: "Target branch required" });
    const cleanBranch = branch.trim();

    await run("git", ["-C", docroot, "fetch", "origin", cleanBranch], { timeout: 60000 });
    const checkoutRes = await run("git", ["-C", docroot, "checkout", cleanBranch]);
    if (!checkoutRes.ok) {
      const coRemote = await run("git", ["-C", docroot, "checkout", "-b", cleanBranch, `origin/${cleanBranch}`]);
      if (!coRemote.ok) {
        return res.status(400).json({ error: `Checkout failed: ${coRemote.stderr || coRemote.stdout}` });
      }
    }
    await run("git", ["-C", docroot, "pull", "origin", cleanBranch], { timeout: 60000 }).catch(() => {});
    await run("chown", ["-R", "www-data:www-data", docroot]).catch(() => {});

    try {
      const db = getDb();
      db.prepare("UPDATE astro_projects SET git_branch = ? WHERE name = ? OR frontend_domain = ?").run(cleanBranch, name, name);
    } catch {}

    audit({ action: "git.switch_branch", actor: req.actor.username, ip: clientIp(req), params: { site: name, branch: cleanBranch } });
    res.json({ ok: true, message: `Switched to branch ${cleanBranch}` });
  } catch (error) {
    next(error);
  }
});

// Disconnect Git
router.post("/:name/git/disconnect", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const name = assertSiteName(req.params.name);
    const site = readSite(name);
    const docroot = resolveAppRoot(name, site.summary);

    const { removeGit = false } = req.body ?? {};
    const gitDir = path.join(docroot, ".git");
    if (removeGit && existsSync(gitDir)) {
      rmSync(gitDir, { recursive: true, force: true });
    } else {
      await run("git", ["-C", docroot, "remote", "remove", "origin"]).catch(() => {});
    }

    try {
      const db = getDb();
      db.prepare("UPDATE astro_projects SET git_repo = NULL WHERE name = ? OR frontend_domain = ?").run(name, name);
    } catch {}

    audit({ action: "git.disconnect", actor: req.actor.username, ip: clientIp(req), params: { site: name } });
    res.json({ ok: true, message: "Git repository disconnected" });
  } catch (error) {
    next(error);
  }
});

// Domain and Subdomain management for website
router.get("/:name/domains", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const domains = listDomainsForWebsite(req.params.name);
    res.json({ domains });
  } catch (error) {
    next(error);
  }
});

router.post("/:name/domains", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const result = await addDomainToWebsite(
      req.params.name,
      req.body ?? {},
      req.actor?.username,
      clientIp(req),
    );
    res.status(201).json({ ok: true, domain: result });
  } catch (error) {
    next(error);
  }
});

router.put("/:name/domains/:domain", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const result = await updateDomain(
      req.params.name,
      req.params.domain,
      req.body ?? {},
      req.actor?.username,
      clientIp(req),
    );
    res.json({ ok: true, domain: result });
  } catch (error) {
    next(error);
  }
});

router.delete("/:name/domains/:domain", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const result = await deleteDomain(
      req.params.name,
      req.params.domain,
      req.actor?.username,
      clientIp(req),
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.post("/:name/domains/:domain/ssl", async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.name);
    const result = await issueDomainSsl(
      req.params.name,
      req.params.domain,
      req.actor?.username,
      clientIp(req),
    );
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

export default router;
