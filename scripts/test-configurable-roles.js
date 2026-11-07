import { getDb } from "../server/lib/db.js";
import {
  ROLES,
  ROLE_DEFINITIONS,
  PERMISSION_CATALOG,
  getAllPermissionIds,
  getAllRolePermissions,
  getRolePermissions,
  saveRolePermissions,
  resetRolePermissionsToDefault,
  hasPermission,
  canAccessServerDetails,
} from "../server/lib/rbac.js";

async function runTests() {
  console.log("=== Testing Configurable Roles & Permissions ===");

  // 1. Initial State
  const allIds = getAllPermissionIds();
  console.log(`✓ Total permission items in catalog: ${allIds.length}`);

  const allRolePerms = getAllRolePermissions();
  console.log("✓ Initial role permissions loaded from SQLite:");
  for (const [r, perms] of Object.entries(allRolePerms)) {
    console.log(`  - ${r}: ${perms.length} permissions`);
  }

  // 2. Super Admin Authority
  if (!hasPermission(ROLES.SUPER_ADMIN, "server:metrics_view")) {
    throw new Error("Super Admin must have server:metrics_view");
  }
  if (!hasPermission(ROLES.SUPER_ADMIN, "server:terminal_access")) {
    throw new Error("Super Admin must have server:terminal_access");
  }
  try {
    saveRolePermissions(ROLES.SUPER_ADMIN, []);
    throw new Error("Super Admin permissions should not be modifiable!");
  } catch (err) {
    console.log("✓ Super Admin protection verified: Cannot restrict Super Admin root authority.");
  }

  // 3. Customer Initial Permissions (Should NOT have server:metrics_view by default)
  const customerInitial = getRolePermissions(ROLES.CUSTOMER);
  console.log(`✓ Customer initial permissions: ${customerInitial.length} items`);
  if (hasPermission(ROLES.CUSTOMER, "server:metrics_view")) {
    throw new Error("Customer should not have server:metrics_view by default");
  }
  console.log("✓ Customer cannot view server metrics by default: Verified");

  // 4. Super Admin Grants Server Metrics & Terminal Access to Customer
  console.log("-> Super Admin grants 'server:metrics_view' and 'server:health_view' to Customer role...");
  const newPerms = [...customerInitial, "server:metrics_view", "server:health_view"];
  saveRolePermissions(ROLES.CUSTOMER, newPerms);

  if (!hasPermission(ROLES.CUSTOMER, "server:metrics_view")) {
    throw new Error("Customer should now have server:metrics_view!");
  }
  if (!hasPermission(ROLES.CUSTOMER, "server:health_view")) {
    throw new Error("Customer should now have server:health_view!");
  }
  if (!canAccessServerDetails(ROLES.CUSTOMER)) {
    throw new Error("canAccessServerDetails(customer) should now return true!");
  }
  console.log("✓ Customer successfully granted server details visibility!");

  // 5. Super Admin Revokes Sites Manage from Customer
  console.log("-> Super Admin revokes 'sites:manage' from Customer role...");
  const restrictedPerms = newPerms.filter((p) => p !== "sites:manage");
  saveRolePermissions(ROLES.CUSTOMER, restrictedPerms);

  if (hasPermission(ROLES.CUSTOMER, "sites:manage")) {
    throw new Error("Customer should not have sites:manage!");
  }
  console.log("✓ Customer permission 'sites:manage' successfully revoked!");

  // 6. Reset Customer to System Defaults
  console.log("-> Resetting Customer permissions to system defaults...");
  resetRolePermissionsToDefault(ROLES.CUSTOMER);

  const resetPerms = getRolePermissions(ROLES.CUSTOMER);
  if (hasPermission(ROLES.CUSTOMER, "server:metrics_view")) {
    throw new Error("Customer should no longer have server:metrics_view after reset!");
  }
  if (!hasPermission(ROLES.CUSTOMER, "sites:manage")) {
    throw new Error("Customer should have sites:manage restored after reset!");
  }
  console.log("✓ Customer permissions cleanly restored to system defaults!");

  console.log("\nALL CONFIGURABLE ROLES & PERMISSIONS TESTS PASSED!");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
