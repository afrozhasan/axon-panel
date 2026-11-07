import { Router } from "express";
import { getDb } from "../lib/db.js";
import { enqueueTask } from "../lib/queue.js";
import { clientIp } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { preflightAstroResources, ASTRO_TEMPLATES, HEADLESS_CMS_PRESETS } from "../lib/stacks/astro.js";
import { rollbackAstroDeployment } from "../lib/astro-engine.js";
import { assertCanCreateWebsite } from "../lib/quotas.js";
import { deleteSite, reloadNginx } from "../lib/nginx.js";
import { run } from "../lib/exec.js";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";

const router = Router();

// GET /api/astro/templates - catalogue of templates and presets
router.get("/templates", (_req, res) => {
  res.json({
    templates: ASTRO_TEMPLATES,
    cmsPresets: HEADLESS_CMS_PRESETS,
  });
});

// GET /api/astro/projects - list projects
router.get("/projects", (req, res, next) => {
  try {
    const db = getDb();
    let projects = [];
    if (req.actor?.role === "super_admin" || req.actor?.role === "server_admin") {
      projects = db.prepare(`
        SELECT p.*, w.ssl_enabled as frontend_ssl, bw.ssl_enabled as backend_ssl
        FROM astro_projects p
        LEFT JOIN websites w ON p.website_id = w.id
        LEFT JOIN websites bw ON p.backend_website_id = bw.id
        ORDER BY p.created_at DESC
      `).all();
    } else {
      projects = db.prepare(`
        SELECT p.*, w.ssl_enabled as frontend_ssl, bw.ssl_enabled as backend_ssl
        FROM astro_projects p
        LEFT JOIN websites w ON p.website_id = w.id
        LEFT JOIN websites bw ON p.backend_website_id = bw.id
        WHERE p.organization_id = ?
        ORDER BY p.created_at DESC
      `).all(req.actor?.orgId || "org_default");
    }

    res.json({ projects });
  } catch (error) {
    next(error);
  }
});

// GET /api/astro/projects/:id - single project with deployments
router.get("/projects/:id", (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (project.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const deployments = db.prepare(`
      SELECT * FROM astro_deployments
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 25
    `).all(project.id);

    const envPath = path.join(project.docroot, ".env");
    const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

    res.json({
      project,
      deployments,
      envContent,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/astro/preflight - run resource checks for wizard
router.post("/preflight", async (req, res, next) => {
  try {
    const result = await preflightAstroResources(req.body ?? {});
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/astro/projects - create new Astro project
router.post("/projects", async (req, res, next) => {
  try {
    assertCanCreateWebsite(req.actor?.orgId, req.actor?.role);
    const body = req.body ?? {};

    const task = enqueueTask({
      organizationId: req.actor?.orgId || "org_default",
      taskType: "astro.provision",
      payload: {
        ...body,
        orgId: req.actor?.orgId || "org_default",
        userId: req.actor?.id || null,
      },
      userId: req.actor?.id || null,
    });

    audit({
      action: "astro.project.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name: body.name, domain: body.frontendDomain, cms: body.cmsType },
    });

    res.status(202).json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

// POST /api/astro/projects/:id/rebuild
router.post("/projects/:id/rebuild", async (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (project.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const task = enqueueTask({
      organizationId: project.organization_id,
      taskType: "astro.rebuild",
      payload: {
        projectId: project.id,
        userId: req.actor?.id || null,
      },
      userId: req.actor?.id || null,
    });

    audit({
      action: "astro.project.rebuild",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { projectId: project.id, taskId: task.id },
    });

    res.status(202).json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

// POST /api/astro/projects/:id/rollback
router.post("/projects/:id/rollback", async (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (project.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const result = await rollbackAstroDeployment({
      projectId: project.id,
      deploymentId: req.body?.deploymentId,
      userId: req.actor?.id || null,
    });

    audit({
      action: "astro.project.rollback",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { projectId: project.id, deploymentId: req.body?.deploymentId },
    });

    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

// GET /api/astro/projects/:id/env
router.get("/projects/:id/env", (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const envPath = path.join(project.docroot, ".env");
    const content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    res.json({ content });
  } catch (error) {
    next(error);
  }
});

// PUT /api/astro/projects/:id/env
router.put("/projects/:id/env", (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (project.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const envPath = path.join(project.docroot, ".env");
    writeFileSync(envPath, String(req.body?.content || ""), { mode: 0o600 });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/astro/projects/:id
router.delete("/projects/:id", async (req, res, next) => {
  try {
    const db = getDb();
    const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });

    if (req.actor?.role !== "super_admin" && req.actor?.role !== "server_admin") {
      if (project.organization_id !== (req.actor?.orgId || "org_default")) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    // Stop and remove systemd service if SSR
    if (project.output_mode === "ssr") {
      await run("systemctl", ["stop", `astro-${project.name}.service`]).catch(() => {});
      await run("systemctl", ["disable", `astro-${project.name}.service`]).catch(() => {});
      const unitPath = `/etc/systemd/system/astro-${project.name}.service`;
      if (existsSync(unitPath)) rmSync(unitPath, { force: true });
      await run("systemctl", ["daemon-reload"]).catch(() => {});
    }

    // Stop Directus if applicable
    if (project.cms_type === "directus") {
      await run("systemctl", ["stop", `directus-${project.name}.service`]).catch(() => {});
      await run("systemctl", ["disable", `directus-${project.name}.service`]).catch(() => {});
      const dUnitPath = `/etc/systemd/system/directus-${project.name}.service`;
      if (existsSync(dUnitPath)) rmSync(dUnitPath, { force: true });
      await run("systemctl", ["daemon-reload"]).catch(() => {});
    }

    // Delete Nginx configurations
    deleteSite(project.frontend_domain);
    if (project.backend_domain) deleteSite(project.backend_domain);
    await reloadNginx().catch(() => {});

    // Delete database records
    db.prepare("DELETE FROM astro_projects WHERE id = ?").run(project.id);
    if (project.website_id) db.prepare("DELETE FROM websites WHERE id = ?").run(project.website_id);
    if (project.backend_website_id) db.prepare("DELETE FROM websites WHERE id = ?").run(project.backend_website_id);

    audit({
      action: "astro.project.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { projectId: project.id, name: project.name },
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
