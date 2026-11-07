import { getDb } from "./db.js";

/**
 * Calculates current resource usage vs plan quotas for an organization.
 * @param {string} orgId
 * @returns {object|null}
 */
export function getOrganizationUsage(orgId) {
  if (!orgId) return null;
  const db = getDb();

  const org = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId);
  if (!org) return null;

  let plan = null;
  if (org.plan_id) {
    plan = db.prepare("SELECT * FROM hosting_plans WHERE id = ?").get(org.plan_id);
  }

  const maxWebsites = plan ? plan.max_websites : (org.max_websites || 5);
  const maxDatabases = plan ? plan.max_databases : (org.max_databases || 5);
  const maxStorageMb = plan ? plan.max_storage_mb : (org.max_storage_mb || 5120);

  const siteCountRow = db.prepare("SELECT COUNT(*) as count FROM websites WHERE organization_id = ?").get(orgId);
  const usedWebsites = siteCountRow ? siteCountRow.count : 0;

  const dbCountRow = db.prepare("SELECT COUNT(*) as count FROM databases WHERE organization_id = ?").get(orgId);
  const usedDatabases = dbCountRow ? dbCountRow.count : 0;

  return {
    orgId: org.id,
    orgName: org.name,
    planId: plan ? plan.id : null,
    planName: plan ? plan.name : "Custom",
    websites: {
      used: usedWebsites,
      max: maxWebsites,
      remaining: Math.max(0, maxWebsites - usedWebsites),
    },
    databases: {
      used: usedDatabases,
      max: maxDatabases,
      remaining: Math.max(0, maxDatabases - usedDatabases),
    },
    storageMb: {
      used: 0,
      max: maxStorageMb,
      remaining: maxStorageMb,
    },
  };
}

/**
 * Checks whether the given organization can provision a new website.
 * Super Admins and Server Admins bypass quota checks.
 * @param {string} orgId
 * @param {string} role
 */
export function assertCanCreateWebsite(orgId, role) {
  if (role === "super_admin" || role === "server_admin") {
    return true;
  }
  if (!orgId) return true;

  const usage = getOrganizationUsage(orgId);
  if (!usage) return true;

  if (usage.websites.used >= usage.websites.max) {
    const error = new Error(
      `Website quota reached (${usage.websites.used}/${usage.websites.max}) on the ${usage.planName} plan. Please upgrade your hosting plan to add more websites.`
    );
    error.status = 403;
    throw error;
  }
  return true;
}

/**
 * Checks whether the given organization can provision a new database.
 * Super Admins and Server Admins bypass quota checks.
 * @param {string} orgId
 * @param {string} role
 */
export function assertCanCreateDatabase(orgId, role) {
  if (role === "super_admin" || role === "server_admin") {
    return true;
  }
  if (!orgId) return true;

  const usage = getOrganizationUsage(orgId);
  if (!usage) return true;

  if (usage.databases.used >= usage.databases.max) {
    const error = new Error(
      `Database quota reached (${usage.databases.used}/${usage.databases.max}) on the ${usage.planName} plan. Please upgrade your hosting plan to add more databases.`
    );
    error.status = 403;
    throw error;
  }
  return true;
}
