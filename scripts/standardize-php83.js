#!/usr/bin/env node
// ==============================================================================
// Axon Panel — Standardize on PHP 8.3 & Remove Older Versions
// ==============================================================================

import { standardizePhp83 } from "../server/routes/php.js";

async function main() {
  console.log("=== Axon Panel: Standardizing on PHP 8.3 Runtime ===");
  console.log("1. Ensuring Ondřej Surý PHP repository is registered");
  console.log("2. Installing PHP 8.3 & all components (FPM, CLI, MySQL, cURL, GD, XML, Zip, BCMath, Intl, OPcache, Redis, SQLite, SOAP, bz2)");
  console.log("3. Migrating any sites on older PHP (< 8.3) to PHP 8.3");
  console.log("4. Removing older PHP versions from the system");
  console.log("-----------------------------------------------------");

  try {
    const result = await standardizePhp83({ migrateSites: true, purgeOlder: true });
    console.log("✓ Status: OK");
    console.log("Steps completed:");
    for (const step of result.steps) {
      console.log(`  - ${step}`);
    }
    if (result.migratedSites.length > 0) {
      console.log(`✓ Migrated ${result.migratedSites.length} site(s):`, result.migratedSites);
    }
    if (result.removedVersions.length > 0) {
      console.log(`✓ Removed older PHP versions:`, result.removedVersions.join(", "));
    }
    console.log("=== PHP 8.3 Standardization Completed Successfully ===");
    process.exit(0);
  } catch (err) {
    console.error("✗ Failed to standardize on PHP 8.3:", err.message);
    process.exit(1);
  }
}

main();
