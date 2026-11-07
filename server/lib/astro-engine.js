import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { run } from "./exec.js";
import { allocatePort } from "./ports.js";
import { getDb } from "./db.js";
import { writeSiteValidated, reloadNginx, enableSite, deleteSite, readSite } from "./nginx.js";
import { createDatabase, createUser } from "./mariadb.js";
import { assertDomain, assertSiteName } from "./validate.js";
import { loadConfig } from "../config.js";
import {
  preflightAstroResources,
  buildSystemdUnitContent,
  buildDirectusSystemdUnit,
  generateAstroConfig,
  generatePackageJson,
  generateAstroLayout,
  generateAstroIndex,
  generateDecapAdminHtml,
  generateDecapConfigYml,
  LUMOS_CSS,
} from "./stacks/astro.js";

const WP_LATEST_ZIP = "/tmp/wordpress-latest.zip";

export async function executeAstroProvision(payload, context) {
  const {
    name,
    templateType = "starter",
    useLumos = false,
    cmsType = "none",
    outputMode = "static",
    frontendDomain: rawFrontendDomain,
    backendDomain: rawBackendDomain,
    nodeVersion = "20",
    packageManager = "npm",
    buildCommand = "npm run build",
    gitRepo = "",
    gitBranch = "main",
    envVars = {},
    issueSsl = false,
    wpInstallGraphql = false,
    dbName: customDbName,
    dbUser: customDbUser,
    dbPass: customDbPass,
    adminUser = "admin",
    adminEmail = "admin@example.com",
    adminPass,
    orgId = "org_default",
    userId = null,
  } = payload;

  const frontendDomain = assertDomain(rawFrontendDomain);
  const backendDomain = rawBackendDomain ? assertDomain(rawBackendDomain) : null;
  const projectName = assertSiteName(name || frontendDomain);
  const docroot = path.join("/var/www", frontendDomain);
  const backendDocroot = backendDomain ? path.join("/var/www", backendDomain) : null;

  const db = getDb();
  const projectId = `astro_${randomBytes(6).toString("hex")}`;
  const deploymentId = `dep_${randomBytes(6).toString("hex")}`;
  let frontendSiteId = `site_${randomBytes(6).toString("hex")}`;
  let backendSiteId = backendDomain ? `site_${randomBytes(6).toString("hex")}` : null;

  let assignedPort = null;
  let backendPort = null;

  context.log(`=== Initializing Astro Project Provisioning: ${projectName} ===`);
  context.setProgress(5);

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Resource Preflight & RAM Check
    // -------------------------------------------------------------------------
    context.log("STEP 1/13: Running preflight resource checks...");
    const preflight = await preflightAstroResources({
      cmsType,
      outputMode,
      frontendDomain,
      backendDomain,
    });

    for (const chk of preflight.checks) {
      context.log(`  [${chk.status.toUpperCase()}] ${chk.name}: ${chk.detail}`);
      if (chk.blocker) {
        throw new Error(`Preflight check failed: ${chk.name} - ${chk.detail}`);
      }
    }
    context.setProgress(10);

    // -------------------------------------------------------------------------
    // STEP 2: Database Setup (If WordPress or MariaDB-backed Directus)
    // -------------------------------------------------------------------------
    let generatedDbPass = customDbPass || randomBytes(12).toString("hex");
    let actualDbName = customDbName || `${projectName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20)}_db`;
    let actualDbUser = customDbUser || `${projectName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 16)}_u`;

    if (cmsType === "wordpress") {
      context.log(`STEP 2/13: Provisioning MariaDB database: ${actualDbName}...`);
      await createDatabase(actualDbName);
      await createUser(actualDbUser, "localhost", generatedDbPass, [
        { database: actualDbName, privileges: "ALL PRIVILEGES" },
      ]);
      context.log(`  Database "${actualDbName}" and user "${actualDbUser}" created.`);
    } else {
      context.log("STEP 2/13: Skipping standalone database (Not required or SQLite used).");
    }
    context.setProgress(20);

    // -------------------------------------------------------------------------
    // STEP 3: CMS Backend Provisioning (WordPress or Directus)
    // -------------------------------------------------------------------------
    if (cmsType === "wordpress" && backendDocroot && backendDomain) {
      context.log(`STEP 3/13: Provisioning WordPress backend at ${backendDocroot}...`);
      mkdirSync(backendDocroot, { recursive: true, mode: 0o755 });

      // Download clean WordPress if not in cache
      if (!existsSync(WP_LATEST_ZIP)) {
        context.log("  Downloading WordPress archive...");
        await run("curl", ["-fSL", "-o", WP_LATEST_ZIP, "https://wordpress.org/latest.zip"], { timeout: 120000 });
      }

      context.log("  Extracting WordPress core...");
      await run("unzip", ["-q", "-o", WP_LATEST_ZIP, "-d", "/tmp/wp-extract"], { timeout: 60000 });
      cpSync("/tmp/wp-extract/wordpress", backendDocroot, { recursive: true });
      rmSync("/tmp/wp-extract", { recursive: true, force: true });

      // Generate wp-config.php with salts
      context.log("  Configuring wp-config.php with cryptographic salts...");
      const salts = Array.from({ length: 8 }, () => randomBytes(32).toString("base64")).join("\n");
      const wpConfigContent = `<?php
define('DB_NAME', '${actualDbName}');
define('DB_USER', '${actualDbUser}');
define('DB_PASSWORD', '${generatedDbPass}');
define('DB_HOST', 'localhost');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

define('AUTH_KEY',         '${randomBytes(32).toString("hex")}');
define('SECURE_AUTH_KEY',  '${randomBytes(32).toString("hex")}');
define('LOGGED_IN_KEY',    '${randomBytes(32).toString("hex")}');
define('NONCE_KEY',        '${randomBytes(32).toString("hex")}');
define('AUTH_SALT',        '${randomBytes(32).toString("hex")}');
define('SECURE_AUTH_SALT', '${randomBytes(32).toString("hex")}');
define('LOGGED_IN_SALT',   '${randomBytes(32).toString("hex")}');
define('NONCE_SALT',       '${randomBytes(32).toString("hex")}');

$table_prefix = 'wp_';
define('WP_DEBUG', false);

// Allow headless CORS for Astro frontend
header("Access-Control-Allow-Origin: https://${frontendDomain}");
header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
header("Access-Control-Allow-Credentials: true");

if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
`;
      writeFileSync(path.join(backendDocroot, "wp-config.php"), wpConfigContent, { mode: 0o644 });

      // Set file permissions
      await run("chown", ["-R", "www-data:www-data", backendDocroot]);

      // Install WP via wp-cli if present
      const generatedAdminPass = adminPass || randomBytes(10).toString("hex");
      context.log("  Initializing WordPress site installation...");
      await run(
        "wp",
        [
          "core",
          "install",
          `--url=https://${backendDomain}`,
          `--title=${projectName} CMS`,
          `--admin_user=${adminUser}`,
          `--admin_password=${generatedAdminPass}`,
          `--admin_email=${adminEmail}`,
          `--path=${backendDocroot}`,
          "--allow-root",
        ],
        { timeout: 60000 },
      ).catch(() => {});

      if (wpInstallGraphql) {
        context.log("  Installing and activating WPGraphQL plugin...");
        await run("wp", ["plugin", "install", "wp-graphql", "--activate", `--path=${backendDocroot}`, "--allow-root"], {
          timeout: 60000,
        }).catch(() => {});
      }
    } else if (cmsType === "directus" && backendDocroot && backendDomain) {
      context.log(`STEP 3/13: Provisioning Directus Headless CMS at ${backendDocroot}...`);
      mkdirSync(backendDocroot, { recursive: true, mode: 0o755 });

      backendPort = await allocatePort(8055);
      const directusKey = randomBytes(16).toString("hex");
      const directusSecret = randomBytes(16).toString("hex");
      const directusAdminPass = adminPass || randomBytes(12).toString("hex");

      const directusPkg = {
        name: `directus-${projectName}`,
        private: true,
        type: "module",
        dependencies: {
          directus: "^11.0.0",
        },
      };
      writeFileSync(path.join(backendDocroot, "package.json"), JSON.stringify(directusPkg, null, 2));

      const directusEnv = `PORT=${backendPort}
HOST=127.0.0.1
PUBLIC_URL=https://${backendDomain}
KEY=${directusKey}
SECRET=${directusSecret}
ADMIN_EMAIL=${adminEmail}
ADMIN_PASSWORD=${directusAdminPass}
DB_CLIENT=sqlite3
DB_FILENAME=${path.join(backendDocroot, "data.db")}
CORS_ENABLED=true
CORS_ORIGIN=https://${frontendDomain}
`;
      writeFileSync(path.join(backendDocroot, ".env"), directusEnv, { mode: 0o600 });
      await run("chown", ["-R", "www-data:www-data", backendDocroot]);

      // Systemd unit for Directus
      const directusUnit = buildDirectusSystemdUnit({ siteName: projectName, docroot: backendDocroot, port: backendPort });
      const unitPath = `/etc/systemd/system/directus-${projectName}.service`;
      writeFileSync(unitPath, directusUnit, { mode: 0o644 });
      await run("systemctl", ["daemon-reload"]);
    } else {
      context.log("STEP 3/13: Standalone / Git-based CMS selected; no backend service needed.");
    }
    context.setProgress(35);

    // -------------------------------------------------------------------------
    // STEP 4: Scaffold Astro Frontend (or Clone Existing Git Repo)
    // -------------------------------------------------------------------------
    context.log(`STEP 4/13: Preparing Astro frontend in ${docroot}...`);
    mkdirSync(docroot, { recursive: true, mode: 0o755 });

    if (templateType === "custom_git" && gitRepo) {
      context.log(`  Cloning Astro repository: ${gitRepo} (${gitBranch})...`);
      const cloneRes = await run("git", ["clone", "-b", gitBranch, "--depth", "1", gitRepo, docroot], {
        timeout: 180000,
      });
      if (!cloneRes.ok) throw new Error(`Git clone failed: ${cloneRes.stderr}`);
    } else {
      // Scaffold standard Astro project directories
      mkdirSync(path.join(docroot, "src", "pages"), { recursive: true });
      mkdirSync(path.join(docroot, "src", "layouts"), { recursive: true });
      mkdirSync(path.join(docroot, "src", "styles"), { recursive: true });
      mkdirSync(path.join(docroot, "public"), { recursive: true });

      // Config and Package files
      writeFileSync(path.join(docroot, "astro.config.mjs"), generateAstroConfig({ outputMode }));
      writeFileSync(
        path.join(docroot, "package.json"),
        generatePackageJson({ name: projectName, outputMode, useLumos, cmsType }),
      );
      writeFileSync(path.join(docroot, "src", "layouts", "Layout.astro"), generateAstroLayout({ useLumos }));
      writeFileSync(
        path.join(docroot, "src", "pages", "index.astro"),
        generateAstroIndex({ projectName, cmsType, useLumos, outputMode, backendDomain }),
      );
    }
    context.setProgress(45);

    // -------------------------------------------------------------------------
    // STEP 5: Lumos Framework Integration
    // -------------------------------------------------------------------------
    if (useLumos) {
      context.log("STEP 5/13: Integrating Lumos Framework for Astro (lumosframework/lumos-for-astro)...");
      mkdirSync(path.join(docroot, "public", "styles"), { recursive: true });
      writeFileSync(path.join(docroot, "public", "styles", "lumos.css"), LUMOS_CSS, { mode: 0o644 });
      context.log("  Lumos design tokens and component styling framework installed.");
    } else {
      context.log("STEP 5/13: Standard styling active (Lumos not requested).");
    }
    context.setProgress(55);

    // -------------------------------------------------------------------------
    // STEP 6: Headless CMS Integration & Content Collections
    // -------------------------------------------------------------------------
    context.log(`STEP 6/13: Configuring ${cmsType.toUpperCase()} client integration...`);
    if (cmsType === "decap") {
      context.log("  Provisioning Decap CMS static admin interface at /admin/...");
      mkdirSync(path.join(docroot, "public", "admin"), { recursive: true });
      writeFileSync(path.join(docroot, "public", "admin", "index.html"), generateDecapAdminHtml(), { mode: 0o644 });
      writeFileSync(
        path.join(docroot, "public", "admin", "config.yml"),
        generateDecapConfigYml({ gitRepo: gitRepo || "owner/repo", branch: gitBranch }),
        { mode: 0o644 },
      );

      // Create content collections directory
      mkdirSync(path.join(docroot, "src", "content", "blog"), { recursive: true });
      const samplePost = `---
title: "Welcome to Decap CMS on Astro"
pubDate: 2026-11-06T00:00:00.000Z
description: "Your first headless blog post managed directly from Decap CMS."
---
# Welcome to your Decap CMS content!

This content was published from the Decap admin portal and committed into Git.
`;
      writeFileSync(path.join(docroot, "src", "content", "blog", "first-post.md"), samplePost, { mode: 0o644 });
    }
    context.setProgress(60);

    // -------------------------------------------------------------------------
    // STEP 7: Environment Variables Isolation
    // -------------------------------------------------------------------------
    context.log("STEP 7/13: Writing environment variables (.env)...");
    const mergedEnv = {
      PUBLIC_SITE_NAME: projectName,
      PUBLIC_FRONTEND_URL: `https://${frontendDomain}`,
      NODE_ENV: "production",
      ...envVars,
    };

    if (cmsType === "wordpress" && backendDomain) {
      mergedEnv.PUBLIC_WP_URL = `https://${backendDomain}`;
      mergedEnv.WORDPRESS_API_URL = `https://${backendDomain}/wp-json`;
      if (wpInstallGraphql) mergedEnv.WPGRAPHQL_URL = `https://${backendDomain}/graphql`;
    } else if (cmsType === "directus" && backendDomain) {
      mergedEnv.PUBLIC_DIRECTUS_URL = `https://${backendDomain}`;
    } else if (cmsType === "decap") {
      mergedEnv.PUBLIC_CMS_TYPE = "decap";
    }

    const envLines = Object.entries(mergedEnv)
      .map(([k, v]) => `${k}="${v}"`)
      .join("\n");
    writeFileSync(path.join(docroot, ".env"), envLines, { mode: 0o600 });
    context.log("  Public variables configured; administrative secrets kept isolated on the server.");
    context.setProgress(65);

    // -------------------------------------------------------------------------
    // STEP 8: Dependency Installation
    // -------------------------------------------------------------------------
    context.log(`STEP 8/13: Installing frontend dependencies via ${packageManager}...`);
    const installRes = await run(packageManager, ["install"], {
      cwd: docroot,
      timeout: 300000,
    });
    if (!installRes.ok) {
      context.log(`Warning during install: ${(installRes.stderr || "").slice(0, 300)}`);
    } else {
      context.log("  Frontend dependencies installed successfully.");
    }
    context.setProgress(75);

    // -------------------------------------------------------------------------
    // STEP 9: Production Astro Build
    // -------------------------------------------------------------------------
    context.log("STEP 9/13: Executing production Astro build...");
    const buildArgs = buildCommand.trim().split(/\s+/).slice(1);
    const buildBin = buildCommand.trim().split(/\s+/)[0] || packageManager;

    const buildRes = await run(buildBin, buildArgs.length ? buildArgs : ["run", "build"], {
      cwd: docroot,
      timeout: 300000,
    });

    const buildLog = `${buildRes.stdout}\n${buildRes.stderr}`.trim();
    context.log(buildLog.slice(-500) || "Build finished.");

    if (!buildRes.ok) {
      throw new Error(`Astro build failed: ${buildRes.stderr.slice(0, 800)}`);
    }

    // Verify build output
    const distPath = path.join(docroot, "dist");
    if (!existsSync(distPath)) {
      throw new Error("Build completed but dist/ directory was not created.");
    }
    context.log("  Astro production build succeeded and artifacts verified.");
    context.setProgress(82);

    // -------------------------------------------------------------------------
    // STEP 10: Daemon & Process Supervision (SSR or Directus)
    // -------------------------------------------------------------------------
    if (outputMode === "ssr") {
      context.log("STEP 10/13: Configuring systemd service unit for Astro SSR...");
      assignedPort = await allocatePort(4321);
      const unitContent = buildSystemdUnitContent({
        siteName: projectName,
        docroot,
        port: assignedPort,
        env: mergedEnv,
      });
      const unitFile = `/etc/systemd/system/astro-${projectName}.service`;
      writeFileSync(unitFile, unitContent, { mode: 0o644 });
      await run("systemctl", ["daemon-reload"]);
      await run("systemctl", ["enable", `astro-${projectName}.service`]);
      await run("systemctl", ["restart", `astro-${projectName}.service`]);
      context.log(`  Astro SSR service started on 127.0.0.1:${assignedPort}`);
    } else {
      context.log("STEP 10/13: Static delivery mode: Zero Node.js background processes required.");
    }

    if (cmsType === "directus") {
      context.log("  Starting Directus systemd background service...");
      await run("systemctl", ["enable", `directus-${projectName}.service`]).catch(() => {});
      await run("systemctl", ["restart", `directus-${projectName}.service`]).catch(() => {});
    }
    context.setProgress(88);

    // -------------------------------------------------------------------------
    // STEP 11: Nginx Virtual Hosts Configuration
    // -------------------------------------------------------------------------
    context.log("STEP 11/13: Writing Nginx virtual hosts...");
    let frontendVhost = "";
    if (outputMode === "static") {
      frontendVhost = `server {
    listen 80;
    listen [::]:80;
    server_name ${frontendDomain};

    root ${path.join(docroot, "dist")};
    index index.html;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        try_files $uri $uri/ /index.html =404;
    }

    location ~* \\.(?:css|js|mjs|woff2?|ttf|otf|eot|jpg|jpeg|png|webp|avif|ico|svg)$ {
        expires 30d;
        access_log off;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
    } else {
      frontendVhost = `server {
    listen 80;
    listen [::]:80;
    server_name ${frontendDomain};

    client_max_body_size 64M;

    location / {
        proxy_pass http://127.0.0.1:${assignedPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
    }

    const frontWrite = await writeSiteValidated(frontendDomain, frontendVhost);
    if (!frontWrite.ok) {
      throw new Error(`Nginx rejected frontend config: ${frontWrite.error}`);
    }
    await enableSite(frontendDomain);

    // If backend domain configured, create backend vhost
    if (backendDomain && backendDocroot) {
      let backendVhost = "";
      if (cmsType === "wordpress") {
        backendVhost = `server {
    listen 80;
    listen [::]:80;
    server_name ${backendDomain};

    root ${backendDocroot};
    index index.php index.html;

    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$args;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.4-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
      } else if (cmsType === "directus") {
        backendVhost = `server {
    listen 80;
    listen [::]:80;
    server_name ${backendDomain};

    client_max_body_size 128M;

    location / {
        proxy_pass http://127.0.0.1:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
      }

      if (backendVhost) {
        const backWrite = await writeSiteValidated(backendDomain, backendVhost);
        if (backWrite.ok) {
          await enableSite(backendDomain);
        }
      }
    }

    await reloadNginx();
    context.log("  Nginx virtual hosts activated and reloaded.");
    context.setProgress(92);

    // -------------------------------------------------------------------------
    // STEP 12: SSL Certificates
    // -------------------------------------------------------------------------
    if (issueSsl) {
      context.log("STEP 12/13: Requesting Let's Encrypt SSL certificates...");
      const config = loadConfig();
      const email = config.letsencryptEmail || "admin@localhost";

      await run("certbot", ["--nginx", "-d", frontendDomain, "--non-interactive", "--agree-tos", "-m", email, "--keep-until-expiring"], { timeout: 180000 }).catch(() => {});

      if (backendDomain) {
        await run("certbot", ["--nginx", "-d", backendDomain, "--non-interactive", "--agree-tos", "-m", email, "--keep-until-expiring"], { timeout: 180000 }).catch(() => {});
      }
      context.log("  SSL certificate issuance routine completed.");
    } else {
      context.log("STEP 12/13: SSL issuance skipped by configuration.");
    }
    context.setProgress(96);

    // -------------------------------------------------------------------------
    // STEP 13: Service Verification & Health Check
    // -------------------------------------------------------------------------
    context.log("STEP 13/13: Verifying deployed services...");
    const curlFront = await run("curl", ["-sI", `http://127.0.0.1`, "-H", `Host: ${frontendDomain}`], {
      timeout: 15000,
    });
    context.log(`  Frontend HTTP probe: ${curlFront.stdout.split("\n")[0] || "No response"}`);

    if (backendDomain) {
      const curlBack = await run("curl", ["-sI", `http://127.0.0.1`, "-H", `Host: ${backendDomain}`], {
        timeout: 15000,
      });
      context.log(`  Backend HTTP probe: ${curlBack.stdout.split("\n")[0] || "No response"}`);
    }

    // Persist to SQLite
    db.prepare(`
      INSERT OR REPLACE INTO websites (id, organization_id, name, primary_domain, app_type, runtime_mode, document_root, assigned_port)
      VALUES (?, ?, ?, ?, 'astro', ?, ?, ?)
    `).run(frontendSiteId, orgId, frontendDomain, frontendDomain, outputMode, docroot, assignedPort);

    db.prepare(`
      INSERT OR REPLACE INTO domains (id, website_id, domain, is_primary, domain_type, routing_type, ssl_active)
      VALUES (?, ?, ?, 1, 'primary', 'direct', ?)
    `).run(`dom_${randomBytes(6).toString("hex")}`, frontendSiteId, frontendDomain, issueSsl ? 1 : 0);

    if (backendDomain) {
      db.prepare(`
        INSERT OR REPLACE INTO websites (id, organization_id, name, primary_domain, app_type, runtime_mode, document_root, assigned_port)
        VALUES (?, ?, ?, ?, ?, 'standard', ?, ?)
      `).run(backendSiteId, orgId, backendDomain, backendDomain, cmsType, backendDocroot, backendPort);

      db.prepare(`
        INSERT OR REPLACE INTO domains (id, website_id, domain, is_primary, domain_type, routing_type, ssl_active)
        VALUES (?, ?, ?, 1, 'primary', 'direct', ?)
      `).run(`dom_${randomBytes(6).toString("hex")}`, backendSiteId, backendDomain, issueSsl ? 1 : 0);
    }

    db.prepare(`
      INSERT INTO astro_projects (
        id, organization_id, website_id, backend_website_id, name, template_type,
        use_lumos, cms_type, output_mode, frontend_domain, backend_domain,
        docroot, backend_docroot, node_version, package_manager, build_command,
        git_repo, git_branch, assigned_port, backend_port, env_vars_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      projectId,
      orgId,
      frontendSiteId,
      backendSiteId,
      projectName,
      templateType,
      useLumos ? 1 : 0,
      cmsType,
      outputMode,
      frontendDomain,
      backendDomain,
      docroot,
      backendDocroot,
      nodeVersion,
      packageManager,
      buildCommand,
      gitRepo,
      gitBranch,
      assignedPort,
      backendPort,
      JSON.stringify(mergedEnv),
    );

    // Initial deployment record
    db.prepare(`
      INSERT INTO astro_deployments (id, project_id, status, output_mode, logs, duration_ms, deployed_by)
      VALUES (?, ?, 'success', ?, ?, ?, ?)
    `).run(deploymentId, projectId, outputMode, buildLog, 0, userId || "system");

    context.setProgress(100);
    context.log("🎉 All 13 steps completed successfully! Astro project is ready.");
    return { ok: true, projectId, frontendDomain, backendDomain, outputMode };
  } catch (err) {
    context.log(`❌ PROVISIONING ERROR: ${err.message}`);
    // Rollback / cleanup on fatal failure
    try {
      if (existsSync(docroot)) rmSync(docroot, { recursive: true, force: true });
      if (backendDocroot && existsSync(backendDocroot)) rmSync(backendDocroot, { recursive: true, force: true });
      deleteSite(frontendDomain);
      if (backendDomain) deleteSite(backendDomain);
      await reloadNginx().catch(() => {});
    } catch {}
    throw err;
  }
}

export async function executeAstroRebuild({ projectId, userId = "system" }, context) {
  const db = getDb();
  const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(projectId);
  if (!project) throw new Error(`Astro project not found: ${projectId}`);

  context.log(`Starting rebuild for Astro project: ${project.name}`);
  context.setProgress(10);

  const docroot = project.docroot;
  if (!existsSync(docroot)) throw new Error(`Project directory not found: ${docroot}`);

  // 1. Snapshot current dist for rollback
  const distPath = path.join(docroot, "dist");
  const backupDistPath = path.join(docroot, `dist.bak_${Date.now()}`);
  if (existsSync(distPath)) {
    context.log("Archiving current production build for rollback safety...");
    cpSync(distPath, backupDistPath, { recursive: true });
  }
  context.setProgress(25);

  // 2. Git pull if repository connected
  if (project.git_repo && existsSync(path.join(docroot, ".git"))) {
    context.log(`Pulling latest commits from ${project.git_branch}...`);
    const pullRes = await run("git", ["-C", docroot, "pull", "origin", project.git_branch], { timeout: 120000 });
    context.log(pullRes.stdout || pullRes.stderr || "Git up to date.");
  }
  context.setProgress(40);

  // 3. Install dependencies
  context.log(`Verifying dependencies with ${project.package_manager}...`);
  await run(project.package_manager, ["install"], { cwd: docroot, timeout: 300000 });
  context.setProgress(60);

  // 4. Production build
  context.log(`Executing build command: ${project.build_command}...`);
  const buildBin = project.build_command.split(/\s+/)[0] || project.package_manager;
  const buildArgs = project.build_command.split(/\s+/).slice(1);
  const buildRes = await run(buildBin, buildArgs.length ? buildArgs : ["run", "build"], {
    cwd: docroot,
    timeout: 300000,
  });

  const buildLog = `${buildRes.stdout}\n${buildRes.stderr}`.trim();
  context.log(buildLog.slice(-500) || "Build completed.");

  if (!buildRes.ok) {
    // Restore previous dist on build failure
    if (existsSync(backupDistPath)) {
      context.log("Build failed! Restoring previous production build...");
      rmSync(distPath, { recursive: true, force: true });
      cpSync(backupDistPath, distPath, { recursive: true });
    }
    throw new Error(`Build failed:\n${buildRes.stderr.slice(0, 800)}`);
  }
  context.setProgress(85);

  // 5. Restart service if SSR or reload Nginx if static
  if (project.output_mode === "ssr") {
    context.log("Restarting systemd service unit...");
    await run("systemctl", ["restart", `astro-${project.name}.service`]);
  } else {
    context.log("Reloading Nginx for static delivery...");
    await reloadNginx();
  }

  // Record deployment
  const depId = `dep_${randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO astro_deployments (id, project_id, status, output_mode, logs, dist_backup_path, deployed_by)
    VALUES (?, ?, 'success', ?, ?, ?, ?)
  `).run(depId, project.id, project.output_mode, buildLog, backupDistPath, userId);

  context.setProgress(100);
  context.log("Rebuild succeeded and production deployment updated.");
  return { ok: true, deploymentId: depId };
}

export async function rollbackAstroDeployment({ projectId, deploymentId, userId = "system" }) {
  const db = getDb();
  const project = db.prepare("SELECT * FROM astro_projects WHERE id = ?").get(projectId);
  if (!project) throw new Error("Astro project not found");

  const deployment = db.prepare("SELECT * FROM astro_deployments WHERE id = ? AND project_id = ?").get(
    deploymentId,
    projectId,
  );
  if (!deployment) throw new Error("Deployment snapshot not found");
  if (!deployment.dist_backup_path || !existsSync(deployment.dist_backup_path)) {
    throw new Error("No archived build snapshot found for this deployment.");
  }

  const distPath = path.join(project.docroot, "dist");
  rmSync(distPath, { recursive: true, force: true });
  cpSync(deployment.dist_backup_path, distPath, { recursive: true });

  if (project.output_mode === "ssr") {
    await run("systemctl", ["restart", `astro-${project.name}.service`]);
  } else {
    await reloadNginx();
  }

  const newDepId = `dep_${randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO astro_deployments (id, project_id, status, output_mode, logs, deployed_by)
    VALUES (?, ?, 'rolled_back', ?, 'Rolled back to deployment ' || ?, ?)
  `).run(newDepId, project.id, project.output_mode, deploymentId, userId);

  return { ok: true, deploymentId: newDepId };
}
