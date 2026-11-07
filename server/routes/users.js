import { Router } from "express";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db.js";
import {
  requireRole,
  ROLES,
  ROLE_DEFINITIONS,
  PERMISSION_CATALOG,
  getAllRolePermissions,
  saveRolePermissions,
  resetRolePermissionsToDefault,
} from "../lib/rbac.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { getOrganizationUsage } from "../lib/quotas.js";

const router = Router();
const MIN_PASSWORD_LENGTH = 12;

// GET /api/users/quota - Get quota & resource usage for the currently authenticated user
router.get("/quota", (req, res, next) => {
  try {
    const orgId = req.actor?.orgId || "org_default";
    const usage = getOrganizationUsage(orgId);
    return res.json({
      role: req.actor?.role,
      usage: usage || {
        orgId,
        orgName: "Default Organization",
        planName: "Enterprise",
        websites: { used: 0, max: 9999, remaining: 9999 },
        databases: { used: 0, max: 9999, remaining: 9999 },
        storageMb: { used: 0, max: 999999, remaining: 999999 },
      },
    });
  } catch (error) {
    return next(error);
  }
});

// GET /api/users - List users (Super Admin, Server Admin, Reseller)
router.get("/", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN, ROLES.RESELLER), (req, res, next) => {
  try {
    const db = getDb();
    const isSuperOrServerAdmin = req.actor.role === ROLES.SUPER_ADMIN || req.actor.role === ROLES.SERVER_ADMIN;

    let usersQuery = `
      SELECT 
        u.id,
        u.username,
        u.email,
        u.role,
        u.status,
        u.totp_enabled,
        u.created_at,
        u.last_login_at,
        u.organization_id,
        o.name as organization_name,
        o.plan_id,
        hp.name as plan_name,
        (SELECT COUNT(*) FROM websites WHERE organization_id = u.organization_id) as website_count,
        (SELECT COUNT(*) FROM databases WHERE organization_id = u.organization_id) as database_count
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      LEFT JOIN hosting_plans hp ON o.plan_id = hp.id
    `;

    const params = [];
    if (!isSuperOrServerAdmin) {
      // Resellers only see users in their organization
      usersQuery += " WHERE u.organization_id = ?";
      params.push(req.actor.orgId);
    }

    usersQuery += " ORDER BY u.created_at DESC";

    const users = db.prepare(usersQuery).all(...params);
    return res.json({ users });
  } catch (error) {
    return next(error);
  }
});

// POST /api/users - Create a new user
router.post("/", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN, ROLES.RESELLER), async (req, res, next) => {
  try {
    const { username, email, password, role, planId, orgName } = req.body ?? {};

    if (!username || typeof username !== "string" || !/^[a-zA-Z0-9_\-\.]{3,32}$/.test(username.trim())) {
      return res.status(400).json({ error: "Username must be 3-32 characters (letters, numbers, dashes, underscores, dots)." });
    }

    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ error: "A valid email address is required." });
    }

    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }

    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();

    // Role validation & hierarchy
    const validRoles = [ROLES.SERVER_ADMIN, ROLES.RESELLER, ROLES.CUSTOMER, ROLES.DEVELOPER, ROLES.READ_ONLY];
    if (req.actor.role === ROLES.SUPER_ADMIN) {
      validRoles.push(ROLES.SUPER_ADMIN);
    }

    const targetRole = role || ROLES.CUSTOMER;
    if (!validRoles.includes(targetRole)) {
      return res.status(400).json({ error: `Invalid role selected. Allowed: ${validRoles.join(", ")}` });
    }

    if (req.actor.role === ROLES.RESELLER && (targetRole === ROLES.SUPER_ADMIN || targetRole === ROLES.SERVER_ADMIN)) {
      return res.status(403).json({ error: "Resellers cannot create administrative accounts." });
    }

    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE username = ? OR email = ?").get(cleanUsername, cleanEmail);
    if (existing) {
      return res.status(409).json({ error: "A user with this username or email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = `usr_${randomBytes(8).toString("hex")}`;

    // Organization setup
    let orgId = "org_default";
    if (targetRole === ROLES.CUSTOMER || targetRole === ROLES.DEVELOPER || orgName) {
      orgId = `org_${randomBytes(6).toString("hex")}`;
      const name = orgName && typeof orgName === "string" ? orgName.trim() : `${cleanUsername}'s Workspace`;
      const slug = cleanUsername.replace(/[^a-z0-9]/g, "-");
      const assignedPlan = planId || "plan_starter";

      db.prepare(`
        INSERT INTO organizations (id, name, slug, plan_id)
        VALUES (?, ?, ?, ?)
      `).run(orgId, name, slug, assignedPlan);
    }

    db.prepare(`
      INSERT INTO users (id, organization_id, username, email, password_hash, role, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(userId, orgId, cleanUsername, cleanEmail, passwordHash, targetRole);

    audit({
      action: "user.create",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Created user ${cleanUsername} (${targetRole}) in org ${orgId}`,
    });

    const created = db.prepare(`
      SELECT u.id, u.username, u.email, u.role, u.status, u.organization_id, o.name as organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = ?
    `).get(userId);

    return res.status(201).json({ user: created });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/users/:id - Update user details
router.put("/:id", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN, ROLES.RESELLER), (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, role, status, planId } = req.body ?? {};

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Protect last super admin
    if (user.role === ROLES.SUPER_ADMIN) {
      if (status === "suspended" || (role && role !== ROLES.SUPER_ADMIN)) {
        const superCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin' AND status = 'active'").get().count;
        if (superCount <= 1) {
          return res.status(400).json({ error: "Cannot suspend or demote the last active Super Admin." });
        }
      }
    }

    const updatedEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? email.trim().toLowerCase() : user.email;
    const updatedRole = role && Object.values(ROLES).includes(role) ? role : user.role;
    const updatedStatus = status && ["active", "suspended"].includes(status) ? status : user.status;

    // Resellers cannot elevate to super_admin or server_admin
    if (req.actor.role === ROLES.RESELLER && (updatedRole === ROLES.SUPER_ADMIN || updatedRole === ROLES.SERVER_ADMIN)) {
      return res.status(403).json({ error: "Resellers cannot promote users to administrator roles." });
    }

    db.prepare(`
      UPDATE users
      SET email = ?, role = ?, status = ?
      WHERE id = ?
    `).run(updatedEmail, updatedRole, updatedStatus, id);

    // If planId provided and user has an organization, update org plan
    if (planId && user.organization_id) {
      db.prepare("UPDATE organizations SET plan_id = ? WHERE id = ?").run(planId, user.organization_id);
    }

    audit({
      action: "user.update",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Updated user ${user.username} (${updatedRole}, ${updatedStatus})`,
    });

    const updated = db.prepare(`
      SELECT u.id, u.username, u.email, u.role, u.status, u.organization_id, o.name as organization_name, o.plan_id
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.id = ?
    `).get(id);

    return res.json({ user: updated });
  } catch (error) {
    return next(error);
  }
});

// POST /api/users/:id/password - Reset user password
router.post("/:id/password", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN, ROLES.RESELLER), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body ?? {};

    if (!password || typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.` });
    }

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);

    audit({
      action: "user.password_reset",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Password reset for user ${user.username}`,
    });

    return res.json({ ok: true, message: "Password updated successfully." });
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/users/:id - Delete user
router.delete("/:id", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN, ROLES.RESELLER), (req, res, next) => {
  try {
    const { id } = req.params;

    const db = getDb();
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    if (user.username === req.actor.username || user.id === req.actor.id) {
      return res.status(400).json({ error: "You cannot delete your own account." });
    }

    if (user.role === ROLES.SUPER_ADMIN) {
      const superCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'super_admin' AND status = 'active'").get().count;
      if (superCount <= 1) {
        return res.status(400).json({ error: "Cannot delete the only Super Admin account." });
      }
    }

    db.prepare("DELETE FROM users WHERE id = ?").run(id);

    audit({
      action: "user.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Deleted user ${user.username} (${id})`,
    });

    return res.json({ ok: true, deleted: id });
  } catch (error) {
    return next(error);
  }
});

// GET /api/users/roles/permissions - Get configurable roles and permissions catalog
router.get("/roles/permissions", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN), (req, res, next) => {
  try {
    const isSuperAdmin = req.actor?.role === ROLES.SUPER_ADMIN;
    return res.json({
      roles: ROLE_DEFINITIONS,
      catalog: PERMISSION_CATALOG,
      permissions: getAllRolePermissions(),
      canEdit: isSuperAdmin,
    });
  } catch (error) {
    return next(error);
  }
});

// PUT /api/users/roles/permissions/:role - Update permissions for a specific role (Super Admin only)
router.put("/roles/permissions/:role", requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  try {
    const { role } = req.params;
    const { permissions } = req.body ?? {};

    if (!Array.isArray(permissions)) {
      return res.status(400).json({ error: "Permissions must be an array of permission IDs." });
    }

    if (role === ROLES.SUPER_ADMIN) {
      return res.status(400).json({ error: "Super Admin permissions are fixed with full root authority." });
    }

    if (!Object.values(ROLES).includes(role)) {
      return res.status(400).json({ error: `Invalid role specified: ${role}` });
    }

    const updated = saveRolePermissions(role, permissions);

    audit({
      action: "rbac.permissions.update",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Updated permissions for role ${role} (${updated.length} active permissions)`,
    });

    return res.json({
      ok: true,
      role,
      permissions: updated,
      allPermissions: getAllRolePermissions(),
    });
  } catch (error) {
    return next(error);
  }
});

// POST /api/users/roles/permissions/:role/reset - Reset role permissions to system defaults (Super Admin only)
router.post("/roles/permissions/:role/reset", requireRole(ROLES.SUPER_ADMIN), (req, res, next) => {
  try {
    const { role } = req.params;
    const updated = resetRolePermissionsToDefault(role);

    audit({
      action: "rbac.permissions.reset",
      actor: req.actor.username,
      ip: clientIp(req),
      detail: `Reset permissions to defaults for role ${role}`,
    });

    return res.json({
      ok: true,
      role,
      permissions: updated,
      allPermissions: getAllRolePermissions(),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
