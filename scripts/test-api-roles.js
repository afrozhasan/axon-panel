import { signSession } from "../server/middleware/auth.js";
import { loadConfig } from "../server/config.js";

async function testApi() {
  console.log("=== Testing Configurable Roles & Permissions API Endpoints ===");
  const cfg = loadConfig();

  // 1. Sign admin session directly
  const token = signSession({
    id: "usr_admin_test",
    username: cfg.adminUser || "admin",
    role: "super_admin",
    orgId: "org_default",
  });
  const cookie = `webpanel_token=${token}`;

  // 2. Test GET /api/users/roles/permissions
  const rolesRes = await fetch("http://127.0.0.1:9090/api/users/roles/permissions", {
    headers: {
      cookie,
      "x-requested-with": "webpanel",
    },
  });
  console.log("GET /api/users/roles/permissions status:", rolesRes.status);
  const rolesBody = await rolesRes.json();
  console.log("Configurable roles returned:", rolesBody.roles?.map((r) => r.id).join(", "));
  console.log("Catalog categories count:", rolesBody.catalog?.length);
  console.log("Can edit permissions:", rolesBody.canEdit);

  if (rolesRes.status !== 200 || !rolesBody.roles) {
    throw new Error("Failed to get roles and permissions catalog");
  }

  // 3. Test PUT /api/users/roles/permissions/developer
  const updateRes = await fetch("http://127.0.0.1:9090/api/users/roles/permissions/developer", {
    method: "PUT",
    headers: {
      cookie,
      "Content-Type": "application/json",
      "x-requested-with": "webpanel",
    },
    body: JSON.stringify({
      permissions: ["sites:deploy", "server:metrics_view", "astro:manage"],
    }),
  });
  console.log("PUT /api/users/roles/permissions/developer status:", updateRes.status);
  const updateBody = await updateRes.json();
  console.log("Updated developer permissions:", updateBody.permissions);

  if (updateRes.status !== 200 || !updateBody.permissions.includes("server:metrics_view")) {
    throw new Error("Failed to update developer permissions");
  }

  // 4. Test Customer Token without server:metrics_view
  const customerToken = signSession({
    id: "usr_cust_test",
    username: "testcust",
    role: "customer",
    orgId: "org_default",
  });
  const customerCookie = `webpanel_token=${customerToken}`;

  const custMetricsRes = await fetch("http://127.0.0.1:9090/api/system/metrics", {
    headers: {
      cookie: customerCookie,
      "x-requested-with": "webpanel",
    },
  });
  console.log("Customer GET /api/system/metrics status:", custMetricsRes.status, "(Expected 403 Forbidden)");
  if (custMetricsRes.status !== 403) {
    throw new Error("Customer should have received 403 Forbidden for server:metrics_view!");
  }

  // 5. Reset developer permissions
  const resetRes = await fetch("http://127.0.0.1:9090/api/users/roles/permissions/developer/reset", {
    method: "POST",
    headers: {
      cookie,
      "x-requested-with": "webpanel",
    },
  });
  console.log("POST reset developer status:", resetRes.status);

  // 6. Test GET /api/system/overview
  const overviewRes = await fetch("http://127.0.0.1:9090/api/system/overview", {
    headers: {
      cookie,
      "x-requested-with": "webpanel",
    },
  });
  console.log("GET /api/system/overview status:", overviewRes.status);
  const overviewBody = await overviewRes.json();
  console.log("Overview hostname:", overviewBody.metrics?.hostname, "Services count:", overviewBody.services?.length);

  console.log("=== API Endpoints Test Completed Successfully ===");
}

testApi().catch((err) => {
  console.error(err);
  process.exit(1);
});
