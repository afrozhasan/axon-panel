import { getDb } from "../server/lib/db.js";
import { getOrganizationUsage, assertCanCreateWebsite, assertCanCreateDatabase } from "../server/lib/quotas.js";
import { ROLES, hasPermission, PERMISSIONS } from "../server/lib/rbac.js";

async function runTests() {
  console.log("=== Testing Phase 1D: Multi-Tenancy & Customer Portal ===");
  const db = getDb();

  // Test 1: RBAC permissions
  console.log("\n1. Testing RBAC hierarchy & permissions:");
  if (hasPermission(ROLES.SUPER_ADMIN, PERMISSIONS.SERVER_MANAGE)) {
    console.log("  ok: super_admin has server:manage");
  } else {
    throw new Error("super_admin missing server:manage");
  }

  if (!hasPermission(ROLES.CUSTOMER, PERMISSIONS.SERVER_MANAGE)) {
    console.log("  ok: customer does not have server:manage");
  } else {
    throw new Error("customer should not have server:manage");
  }

  if (hasPermission(ROLES.CUSTOMER, PERMISSIONS.SITES_CREATE)) {
    console.log("  ok: customer has sites:create");
  } else {
    throw new Error("customer missing sites:create");
  }

  // Test 2: Quotas & Limits
  console.log("\n2. Testing Organization Quotas:");
  const testOrgId = "org_test_customer";
  db.prepare(`
    INSERT OR REPLACE INTO organizations (id, name, slug, plan_id, max_websites, max_databases)
    VALUES (?, 'Test Customer Workspace', 'test-customer', 'plan_starter', 1, 2)
  `).run(testOrgId);

  const usageBefore = getOrganizationUsage(testOrgId);
  console.log("  Initial usage:", usageBefore);
  if (usageBefore.websites.max !== 1) {
    throw new Error(`Expected starter plan max_websites 1, got ${usageBefore.websites.max}`);
  }

  // Can create 1st site
  assertCanCreateWebsite(testOrgId, ROLES.CUSTOMER);
  console.log("  ok: Can create 1st website under Starter quota");

  // Insert mock site for testOrgId
  const testSiteId = "site_test_01";
  db.prepare(`
    INSERT OR REPLACE INTO websites (id, organization_id, name, primary_domain, app_type, document_root)
    VALUES (?, ?, 'testsite1.local', 'testsite1.local', 'static', '/var/www/testsite1.local')
  `).run(testSiteId, testOrgId);

  const usageAfter1 = getOrganizationUsage(testOrgId);
  console.log("  Usage after 1 site:", usageAfter1.websites);
  if (usageAfter1.websites.used !== 1) {
    throw new Error("Expected 1 site used");
  }

  // Attempting 2nd site should throw 403
  let quotaBlocked = false;
  try {
    assertCanCreateWebsite(testOrgId, ROLES.CUSTOMER);
  } catch (err) {
    if (err.status === 403) {
      quotaBlocked = true;
      console.log("  ok: 2nd website correctly blocked by quota:", err.message);
    }
  }
  if (!quotaBlocked) {
    throw new Error("Expected quota limit to block 2nd website creation!");
  }

  // Super admin bypasses quota
  try {
    assertCanCreateWebsite(testOrgId, ROLES.SUPER_ADMIN);
    console.log("  ok: Super Admin successfully bypasses quota limits");
  } catch {
    throw new Error("Super Admin should bypass quota check");
  }

  // Test 3: Database Quota
  console.log("\n3. Testing Database Quotas:");
  assertCanCreateDatabase(testOrgId, ROLES.CUSTOMER);
  console.log("  ok: Can create 1st database");

  db.prepare(`
    INSERT OR REPLACE INTO databases (id, organization_id, engine, db_name, db_user)
    VALUES ('db_test_01', ?, 'mariadb', 'test_db_1', 'test_user')
  `).run(testOrgId);
  db.prepare(`
    INSERT OR REPLACE INTO databases (id, organization_id, engine, db_name, db_user)
    VALUES ('db_test_02', ?, 'mariadb', 'test_db_2', 'test_user')
  `).run(testOrgId);

  let dbQuotaBlocked = false;
  try {
    assertCanCreateDatabase(testOrgId, ROLES.CUSTOMER);
  } catch (err) {
    if (err.status === 403) {
      dbQuotaBlocked = true;
      console.log("  ok: 3rd database correctly blocked by Starter plan (max 2):", err.message);
    }
  }
  if (!dbQuotaBlocked) {
    throw new Error("Expected database quota to block 3rd DB creation!");
  }

  // Cleanup test data
  db.prepare("DELETE FROM websites WHERE id = ?").run(testSiteId);
  db.prepare("DELETE FROM databases WHERE organization_id = ?").run(testOrgId);
  db.prepare("DELETE FROM organizations WHERE id = ?").run(testOrgId);

  console.log("\n=== ALL MULTI-TENANCY & QUOTA TESTS PASSED! ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
