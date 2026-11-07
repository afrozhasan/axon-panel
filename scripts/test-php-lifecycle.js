#!/usr/bin/env node
import assert from "node:assert";
import { isForbiddenPhpVersion, PHP83_COMPONENTS } from "../server/routes/php.js";
import { signSession } from "../server/middleware/auth.js";
import { loadConfig } from "../server/config.js";

console.log("=== Testing PHP Lifecycle & Deprecation Protection ===");

// 1. Forbidden versions test
console.log("1. Testing PHP 7.4 & older version blocking...");
assert.strictEqual(isForbiddenPhpVersion("7.4"), true, "PHP 7.4 must be forbidden");
assert.strictEqual(isForbiddenPhpVersion("7.3"), true, "PHP 7.3 must be forbidden");
assert.strictEqual(isForbiddenPhpVersion("7.0"), true, "PHP 7.0 must be forbidden");
assert.strictEqual(isForbiddenPhpVersion("5.6"), true, "PHP 5.6 must be forbidden");
assert.strictEqual(isForbiddenPhpVersion("8.0"), true, "PHP 8.0 must be forbidden");
assert.strictEqual(isForbiddenPhpVersion("8.1"), false, "PHP 8.1 should be allowed");
assert.strictEqual(isForbiddenPhpVersion("8.3"), false, "PHP 8.3 should be allowed");
assert.strictEqual(isForbiddenPhpVersion("8.4"), false, "PHP 8.4 should be allowed");
console.log("  ✓ PHP 7.4 and legacy versions (< 8.1) strictly blocked.");

// 2. PHP 8.3 components completeness
console.log("2. Testing PHP 8.3 required components list...");
const requiredNames = ["fpm", "cli", "common", "mysql", "curl", "gd", "mbstring", "xml", "zip", "bcmath", "intl", "opcache", "sqlite3", "redis", "soap"];
for (const name of requiredNames) {
  assert(
    PHP83_COMPONENTS.includes(`php8.3-${name}`),
    `PHP 8.3 component list must include php8.3-${name}`
  );
}
console.log(`  ✓ All ${requiredNames.length} critical PHP 8.3 components verified.`);

// 3. API-level enforcement (when live daemon is active)
async function testApiEnforcement() {
  const cfg = loadConfig();
  const port = cfg.port || 9090;
  const baseUrl = `http://127.0.0.1:${port}`;

  let serverRunning = false;
  try {
    const probe = await fetch(`${baseUrl}/api/auth/session`, { signal: AbortSignal.timeout(1500) });
    serverRunning = probe.status > 0;
  } catch {
    serverRunning = false;
  }

  if (process.env.CI || !serverRunning) {
    console.log("  (Live daemon not active; skipping live HTTP tests)");
    return;
  }

  const token = signSession({
    id: "usr_admin_test",
    username: cfg.adminUser || "admin",
    role: "super_admin",
    orgId: "org_default",
  });
  const headers = {
    cookie: `webpanel_token=${token}`,
    "Content-Type": "application/json",
    "x-requested-with": "webpanel",
  };

  // Test installing PHP 7.4 is rejected
  const install74 = await fetch(`${baseUrl}/api/php/install`, {
    method: "POST",
    headers,
    body: JSON.stringify({ version: "7.4" }),
  });
  assert.strictEqual(install74.status, 400, "POST /api/php/install with 7.4 must return 400");
  const install74Body = await install74.json();
  assert(install74Body.error.includes("PHP 7.4"), "Error message must mention PHP 7.4 prohibition");
  console.log("  ✓ API POST /api/php/install with 7.4 correctly rejected (400 Bad Request).");

  // Test switching a site to PHP 7.4 is rejected
  const switch74 = await fetch(`${baseUrl}/api/php/switch-site`, {
    method: "POST",
    headers,
    body: JSON.stringify({ site: "testsite.local", version: "7.4" }),
  });
  assert.strictEqual(switch74.status, 400, "POST /api/php/switch-site with 7.4 must return 400");
  const switch74Body = await switch74.json();
  assert(switch74Body.error.includes("PHP 7.4"), "Error message must mention PHP 7.4 prohibition");
  console.log("  ✓ API POST /api/php/switch-site with 7.4 correctly rejected (400 Bad Request).");

  // Test GET /api/php returns standardization metadata
  const phpGet = await fetch(`${baseUrl}/api/php`, { headers });
  assert.strictEqual(phpGet.status, 200, "GET /api/php must return 200");
  const phpData = await phpGet.json();
  assert("hasOlderInstalled" in phpData, "GET /api/php must include hasOlderInstalled flag");
  assert("isPhp83Installed" in phpData, "GET /api/php must include isPhp83Installed flag");
  console.log("  ✓ GET /api/php returns modernization metadata.");
}

await testApiEnforcement();
console.log("=== ALL PHP LIFECYCLE TESTS PASSED ===");
