import { Router } from "express";
import { listApps, getApp, CATEGORIES } from "../apps/catalog.js";
import { preflight, startInstall, getJob, listJobs, activeJob, buildVars } from "../lib/apps/installer.js";
import { assertDomain, assertEmail, assertPort } from "../lib/validate.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";
import { getDb } from "../lib/db.js";
import { randomBytes } from "node:crypto";
import { assertCanCreateWebsite, assertCanCreateDatabase } from "../lib/quotas.js";
import { existsSync } from "node:fs";
import path from "node:path";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const apps = listApps();
    const withStatus = await Promise.all(
      apps.map(async (app) => {
        const checks = await preflight(app, { includeNetwork: false });
        const catalogEntry = getApp(app.id);
        const preview = catalogEntry.automated === false
          ? buildVars(catalogEntry, { domain: "example.com" }, "preview")
          : null;
        return {
          ...app,
          manualRecipe: preview
            ? (catalogEntry.manualRecipe ?? []).map((line) =>
                line.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(preview[key] ?? `{{${key}}}`)),
              )
            : app.manualRecipe,
          ready: checks.ok,
          blockers: checks.checks.filter((check) => check.status === "fail").length,
          checks: checks.checks,
        };
      }),
    );

    res.json({
      categories: CATEGORIES,
      apps: withStatus,
      activeJob: activeJob(),
      phpSocket: loadConfig().phpFpmSocket,
      defaultEmail: loadConfig().letsencryptEmail,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/jobs", (_req, res) => {
  res.json({ jobs: listJobs() });
});

router.get("/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });
  return res.json({ job });
});

router.get("/:id", async (req, res, next) => {
  try {
    const app = getApp(req.params.id);
    if (!app) return res.status(404).json({ error: "Unknown application" });

    const checks = await preflight(app, { includeNetwork: true });
    const vars = buildVars(app, { domain: "example.com" }, "preview");
    const recipe = (app.manualRecipe ?? []).map((line) =>
      line.replace(/\{\{(\w+)\}\}/g, (_m, key) => String(vars[key] ?? `{{${key}}}`)),
    );

    return res.json({
      app: {
        ...listApps().find((entry) => entry.id === app.id),
        manualRecipe: recipe,
      },
      preflight: checks,
      defaults: {
        database: vars.dbName,
        databaseUser: vars.dbUser,
        installDir: vars.installDir,
        docroot: vars.docroot,
        adminUser: "admin",
        adminEmail: loadConfig().letsencryptEmail,
      },
      conflict: existsSync(path.join("/var/www", "example.com")),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/preflight", async (req, res, next) => {
  try {
    const app = getApp(req.params.id);
    if (!app) return res.status(404).json({ error: "Unknown application" });
    res.json(await preflight(app, { includeNetwork: true }));
  } catch (error) {
    next(error);
  }
});

router.post("/:id/install", async (req, res, next) => {
  try {
    assertCanCreateWebsite(req.actor?.orgId, req.actor?.role);
    const body = req.body ?? {};
    const domain = assertDomain(body.domain);
    const aliases = Array.isArray(body.aliases) ? body.aliases.filter(Boolean).map(assertDomain) : [];

    const app = getApp(req.params.id);
    if (!app) return res.status(404).json({ error: "Unknown application" });

    if (app.database && app.database !== "none") {
      assertCanCreateDatabase(req.actor?.orgId, req.actor?.role);
    }

    const options = {
      domain,
      aliases,
      siteTitle: typeof body.siteTitle === "string" && body.siteTitle.trim() ? body.siteTitle.trim().slice(0, 120) : undefined,
      adminUser: typeof body.adminUser === "string" && body.adminUser.trim() ? body.adminUser.trim().slice(0, 60) : undefined,
      adminEmail: body.adminEmail ? assertEmail(body.adminEmail) : undefined,
      port: app.portSource && body.port ? assertPort(body.port) : undefined,
      siteUrl: body.useHttps === false ? `http://${domain}` : `https://${domain}`,
    };

    const job = await startInstall(app.id, options, req.actor.username, clientIp(req));

    // Register into SQLite websites
    try {
      const db = getDb();
      const siteId = `site_${randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR REPLACE INTO websites (id, organization_id, name, primary_domain, app_type, document_root)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(siteId, req.actor?.orgId || "org_default", domain, domain, app.id, path.join("/var/www", domain));
    } catch {
      /* ignore */
    }

    return res.status(202).json({ job });
  } catch (error) {
    return next(error);
  }
});

export default router;
