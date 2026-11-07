import { Router } from "express";
import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db.js";
import { requireRole, ROLES } from "../lib/rbac.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";

const router = Router();

// GET /api/plans - List all hosting plans
router.get("/", (req, res, next) => {
  try {
    const db = getDb();
    const plans = db.prepare(`
      SELECT 
        hp.*,
        (SELECT COUNT(*) FROM organizations WHERE plan_id = hp.id) as organization_count
      FROM hosting_plans hp
      ORDER BY hp.max_websites ASC
    `).all();
    return res.json({ plans });
  } catch (error) {
    return next(error);
  }
});

// POST /api/plans - Create a new hosting plan (Super admin only)
router.post("/", requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  try {
    const { name, slug, maxWebsites, maxDatabases, maxStorageMb, maxBandwidthMb } = req.body ?? {};

    if (!name || typeof name !== "string" || name.trim().length < 2) {
      return res.status(400).json({ error: "Plan name must be at least 2 characters long." });
    }

    const cleanSlug = (slug || name)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 32);

    const db = getDb();
    const existing = db.prepare("SELECT id FROM hosting_plans WHERE slug = ?").get(cleanSlug);
    if (existing) {
      return res.status(409).json({ error: `A plan with slug "${cleanSlug}" already exists.` });
    }

    const id = `plan_${randomBytes(6).toString("hex")}`;
    const websites = Math.max(1, parseInt(maxWebsites, 10) || 5);
    const databases = Math.max(0, parseInt(maxDatabases, 10) || 5);
    const storage = Math.max(100, parseInt(maxStorageMb, 10) || 5120);
    const bandwidth = Math.max(100, parseInt(maxBandwidthMb, 10) || 51200);

    db.prepare(`
      INSERT INTO hosting_plans (id, name, slug, max_websites, max_databases, max_storage_mb, max_bandwidth_mb)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), cleanSlug, websites, databases, storage, bandwidth);

    audit({
      action: "plan.create",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `${name} (${cleanSlug})`,
    });

    const created = db.prepare("SELECT * FROM hosting_plans WHERE id = ?").get(id);
    return res.status(201).json({ plan: created });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/plans/:id - Update hosting plan
router.put("/:id", requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, maxWebsites, maxDatabases, maxStorageMb, maxBandwidthMb } = req.body ?? {};

    const db = getDb();
    const plan = db.prepare("SELECT * FROM hosting_plans WHERE id = ?").get(id);
    if (!plan) {
      return res.status(404).json({ error: "Hosting plan not found." });
    }

    const updatedName = name && typeof name === "string" ? name.trim() : plan.name;
    const websites = maxWebsites !== undefined ? Math.max(1, parseInt(maxWebsites, 10) || 1) : plan.max_websites;
    const databases = maxDatabases !== undefined ? Math.max(0, parseInt(maxDatabases, 10) || 0) : plan.max_databases;
    const storage = maxStorageMb !== undefined ? Math.max(100, parseInt(maxStorageMb, 10) || 100) : plan.max_storage_mb;
    const bandwidth = maxBandwidthMb !== undefined ? Math.max(100, parseInt(maxBandwidthMb, 10) || 100) : plan.max_bandwidth_mb;

    db.prepare(`
      UPDATE hosting_plans
      SET name = ?, max_websites = ?, max_databases = ?, max_storage_mb = ?, max_bandwidth_mb = ?
      WHERE id = ?
    `).run(updatedName, websites, databases, storage, bandwidth, id);

    audit({
      action: "plan.update",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: id,
    });

    const updated = db.prepare("SELECT * FROM hosting_plans WHERE id = ?").get(id);
    return res.json({ plan: updated });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/plans/:id - Delete hosting plan
router.delete("/:id", requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const plan = db.prepare("SELECT * FROM hosting_plans WHERE id = ?").get(id);
    if (!plan) {
      return res.status(404).json({ error: "Hosting plan not found." });
    }

    const inUse = db.prepare("SELECT COUNT(*) as count FROM organizations WHERE plan_id = ?").get(id);
    if (inUse && inUse.count > 0) {
      return res.status(400).json({
        error: `Cannot delete plan: ${inUse.count} organization(s) are currently assigned to this plan. Reassign them first.`,
      });
    }

    db.prepare("DELETE FROM hosting_plans WHERE id = ?").run(id);

    audit({
      action: "plan.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `${plan.name} (${id})`,
    });

    return res.json({ ok: true, deleted: id });
  } catch (error) {
    return next(error);
  }
});

export default router;
