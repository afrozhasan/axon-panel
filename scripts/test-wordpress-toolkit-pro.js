import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { auditSecurity, previewHardening, scanMalwareAndFiles } from "../server/lib/wp/security.js";
import { getCacheStatus, previewCachePreset } from "../server/lib/wp/cache.js";

console.log("=== Testing WordPress Toolkit Pro ===");

const TEST_DIR = path.join(os.tmpdir(), `wp-toolkit-test-${Date.now()}`);
const SITE_NAME = `wp-test-${Date.now()}.example.test`;
const NGINX_AVAILABLE = "/etc/nginx/sites-available";
const MOCK_VHOST_FILE = path.join(NGINX_AVAILABLE, SITE_NAME);

function setupMockWp(dir) {
  mkdirSync(path.join(dir, "wp-admin"), { recursive: true });
  mkdirSync(path.join(dir, "wp-includes"), { recursive: true });
  mkdirSync(path.join(dir, "wp-content", "uploads"), { recursive: true });
  mkdirSync(path.join(dir, "wp-content", "plugins"), { recursive: true });
  mkdirSync(path.join(dir, "wp-content", "themes"), { recursive: true });

  writeFileSync(path.join(dir, "wp-config.php"), `<?php
define('DB_NAME', 'mock_db');
define('DB_USER', 'mock_user');
define('DB_PASSWORD', 'mock_pass');
define('DB_HOST', 'localhost');
$table_prefix = 'wp_test_';
define('WP_DEBUG', false);
`);
  writeFileSync(path.join(dir, "wp-includes", "version.php"), `<?php
$wp_version = '6.7.1';
`);
  writeFileSync(path.join(dir, "index.php"), `<?php // Mock WP entry`);
}

function trySetupMockVhost() {
  try {
    if (existsSync(NGINX_AVAILABLE)) {
      writeFileSync(MOCK_VHOST_FILE, `server {
    listen 80;
    server_name ${SITE_NAME};
    root ${TEST_DIR};
    index index.php index.html;
    location / {
        try_files $uri $uri/ /index.php?$args;
    }
}
`);
      return true;
    }
  } catch {
    // If not root or directory doesn't exist, skip vhost file creation
  }
  return false;
}

async function runMockTests() {
  console.log(`\n[1] Preparing isolated WordPress mock environment in: ${TEST_DIR}`);
  setupMockWp(TEST_DIR);
  const hasVhost = trySetupMockVhost();

  try {
    console.log("\n[2] WordPress Security Hardening Module Tests");
    const audit = await auditSecurity(TEST_DIR, SITE_NAME, SITE_NAME);
    assert.ok(audit.score >= 0 && audit.score <= 100, "Audit score must be between 0 and 100");
    assert.ok(audit.core.version, "WordPress core version field must exist");
    assert.equal(audit.core.tablePrefix, "wp_test_", "Prefix must match wp-config.php");
    console.log(`  ✓ Security audit successful: Score ${audit.score} (${audit.grade})`);

    // Preview Hardening Profiles (if vhost was created)
    if (hasVhost) {
      for (const profile of ["basic", "advanced", "strict"]) {
        const preview = await previewHardening(TEST_DIR, SITE_NAME, profile);
        assert.equal(preview.profile, profile);
        assert.ok(Array.isArray(preview.compatibilityImpact), "Compatibility explanation must be present");
      }
      console.log("  ✓ Basic, Advanced, and Strict profile previews generated");
    } else {
      console.log("  ℹ VHost preview skipped (not running as root or /etc/nginx unavailable)");
    }

    // Malware Scanner on Mock
    const scanRes = await scanMalwareAndFiles(TEST_DIR);
    assert.ok(scanRes.disclaimer.includes("Notice:"), "Scanner limitation disclaimer must be explicit");
    assert.ok(Array.isArray(scanRes.suspiciousFiles), "Suspicious files array must exist");
    console.log(`  ✓ Malware & Core Checksum scanner executed cleanly (${scanRes.suspiciousFilesCount} suspicious files)`);

    console.log("\n[3] Advanced Cache Management Module Tests");
    const cacheStatus = await getCacheStatus(SITE_NAME, TEST_DIR);
    assert.ok(cacheStatus.layers, "Cache layers status must be returned");
    console.log("  ✓ Cache layers inspected successfully");

    if (hasVhost) {
      for (const preset of ["safe", "performance", "woocommerce"]) {
        const preview = await previewCachePreset(SITE_NAME, TEST_DIR, preset);
        assert.equal(preview.preset, preset);
        assert.ok(preview.changes.length > 0, "Preset must declare changes");
      }
      console.log("  ✓ SAFE WORDPRESS, HIGH PERFORMANCE, and WOOCOMMERCE SAFE presets previewed");
    }

    console.log("\n=== ALL WORDPRESS TOOLKIT PRO UNIT TESTS PASSED! ===");
  } finally {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true });
    } catch {}
    try {
      if (hasVhost && existsSync(MOCK_VHOST_FILE)) {
        unlinkSync(MOCK_VHOST_FILE);
      }
    } catch {}
  }
}

runMockTests().catch((err) => {
  console.error("\n❌ Test failed:", err);
  process.exit(1);
});
