import Database from "better-sqlite3";
import { existsSync, mkdirSync, chmodSync, readdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { CONFIG_DIR, loadConfig } from "../config.js";

export const DB_PATH = process.env.WEBPANEL_DB_PATH || `${CONFIG_DIR}/axon.db`;

let dbInstance = null;

export function getDb() {
  if (dbInstance) return dbInstance;

  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }
  } catch {
    /* ignore permission error in unprivileged test/CI environments */
  }

  let dbPath = DB_PATH;
  try {
    dbInstance = new Database(dbPath, { timeout: 10000 });
  } catch {
    dbPath = path.join("/tmp", `axon-test-${process.pid}.db`);
    dbInstance = new Database(dbPath, { timeout: 10000 });
  }

  try {
    chmodSync(DB_PATH, 0o600);
  } catch {
    /* ignore chmod failure on test/tmp paths */
  }

  // WAL mode for high concurrency & safe single-writer background tasks
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("synchronous = NORMAL");
  dbInstance.pragma("foreign_keys = ON");
  dbInstance.pragma("busy_timeout = 10000");

  initSchema(dbInstance);
  bootstrapHostingPlans(dbInstance);
  bootstrapAdminUser(dbInstance);
  syncExistingSites(dbInstance);

  return dbInstance;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS hosting_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      max_websites INTEGER DEFAULT 5,
      max_databases INTEGER DEFAULT 5,
      max_storage_mb INTEGER DEFAULT 5120,
      max_bandwidth_mb INTEGER DEFAULT 51200,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan_id TEXT REFERENCES hosting_plans(id) ON DELETE SET NULL,
      max_websites INTEGER DEFAULT 10,
      max_databases INTEGER DEFAULT 10,
      max_storage_mb INTEGER DEFAULT 10240,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
      username TEXT UNIQUE NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'server_admin', 'reseller', 'customer', 'developer', 'read_only')),
      totp_secret TEXT,
      totp_enabled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS websites (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT UNIQUE NOT NULL,
      primary_domain TEXT NOT NULL,
      app_type TEXT NOT NULL,
      runtime_mode TEXT DEFAULT 'standard',
      document_root TEXT NOT NULL,
      php_version TEXT,
      assigned_port INTEGER UNIQUE,
      supervisor_type TEXT DEFAULT 'systemd' CHECK(supervisor_type IN ('systemd', 'pm2', 'none')),
      ssl_enabled INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'maintenance')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY,
      website_id TEXT REFERENCES websites(id) ON DELETE CASCADE,
      domain TEXT UNIQUE NOT NULL,
      is_primary INTEGER DEFAULT 0,
      domain_type TEXT DEFAULT 'alias' CHECK(domain_type IN ('primary', 'subdomain', 'alias')),
      routing_type TEXT DEFAULT 'direct' CHECK(routing_type IN ('direct', 'redirect')),
      target_url TEXT,
      ssl_active INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS databases (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      website_id TEXT REFERENCES websites(id) ON DELETE SET NULL,
      engine TEXT NOT NULL CHECK(engine IN ('mariadb', 'postgres')),
      db_name TEXT NOT NULL,
      db_user TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      organization_id TEXT,
      user_id TEXT REFERENCES users(id),
      task_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
      payload_json TEXT NOT NULL,
      progress_percent INTEGER DEFAULT 0,
      logs TEXT DEFAULT '',
      error_message TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      ip_address TEXT NOT NULL,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS astro_projects (
      id TEXT PRIMARY KEY,
      organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
      website_id TEXT REFERENCES websites(id) ON DELETE CASCADE,
      backend_website_id TEXT REFERENCES websites(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      template_type TEXT NOT NULL,
      use_lumos INTEGER DEFAULT 0,
      cms_type TEXT NOT NULL,
      output_mode TEXT DEFAULT 'static' CHECK(output_mode IN ('static', 'ssr')),
      frontend_domain TEXT NOT NULL,
      backend_domain TEXT,
      docroot TEXT NOT NULL,
      backend_docroot TEXT,
      node_version TEXT DEFAULT '20',
      package_manager TEXT DEFAULT 'npm' CHECK(package_manager IN ('npm', 'pnpm', 'yarn')),
      build_command TEXT DEFAULT 'npm run build',
      git_repo TEXT,
      git_branch TEXT DEFAULT 'main',
      assigned_port INTEGER,
      backend_port INTEGER,
      env_vars_json TEXT DEFAULT '{}',
      backend_env_json TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active' CHECK(status IN ('active', 'building', 'error', 'suspended')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS astro_deployments (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES astro_projects(id) ON DELETE CASCADE,
      commit_hash TEXT,
      commit_message TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'building', 'success', 'failed', 'rolled_back')),
      output_mode TEXT NOT NULL,
      logs TEXT DEFAULT '',
      dist_backup_path TEXT,
      duration_ms INTEGER,
      deployed_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wp_security_profiles (
      site_name TEXT PRIMARY KEY,
      profile TEXT DEFAULT 'none',
      last_audit_at DATETIME,
      audit_score INTEGER DEFAULT 0,
      applied_at DATETIME,
      backup_dir TEXT,
      previous_config_json TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wp_cache_settings (
      site_name TEXT PRIMARY KEY,
      fastcgi_enabled INTEGER DEFAULT 0,
      cache_zone_size TEXT DEFAULT '256m',
      cache_ttl TEXT DEFAULT '60m',
      redis_enabled INTEGER DEFAULT 0,
      redis_db INTEGER DEFAULT 1,
      redis_prefix TEXT,
      opcache_enabled INTEGER DEFAULT 1,
      browser_cache_ttl TEXT DEFAULT '30d',
      custom_exclusions_json TEXT DEFAULT '[]',
      cloudflare_token TEXT,
      cloudflare_zone_id TEXT,
      cloudflare_dev_mode INTEGER DEFAULT 0,
      active_preset TEXT DEFAULT 'custom',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wp_operations_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_name TEXT NOT NULL,
      module TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT,
      backup_ref TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS wp_backups (
      id TEXT PRIMARY KEY,
      site_name TEXT NOT NULL,
      backup_type TEXT NOT NULL,
      backup_path TEXT NOT NULL,
      files_included TEXT,
      db_dump_path TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT NOT NULL,
      permission TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (role, permission)
    );

    CREATE TABLE IF NOT EXISTS notification_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('sent', 'failed')),
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);
    CREATE INDEX IF NOT EXISTS idx_websites_org ON websites(organization_id);
    CREATE INDEX IF NOT EXISTS idx_websites_name ON websites(name);
    CREATE INDEX IF NOT EXISTS idx_domains_website ON domains(website_id);
    CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
    CREATE INDEX IF NOT EXISTS idx_astro_org ON astro_projects(organization_id);
    CREATE INDEX IF NOT EXISTS idx_astro_deployments ON astro_deployments(project_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_wp_ops_site ON wp_operations_log(site_name);
    CREATE INDEX IF NOT EXISTS idx_wp_backups_site ON wp_backups(site_name);
    CREATE INDEX IF NOT EXISTS idx_notif_hist_created ON notification_history(created_at);
  `);

  // Migration: ensure organizations has plan_id column
  try {
    const orgCols = db.prepare("PRAGMA table_info(organizations)").all().map((c) => c.name);
    if (!orgCols.includes("plan_id")) {
      db.exec("ALTER TABLE organizations ADD COLUMN plan_id TEXT REFERENCES hosting_plans(id) ON DELETE SET NULL;");
    }
  } catch {
    /* ignore migration error if already exists */
  }

  // Migration: ensure domains has domain_type, routing_type, target_url columns
  try {
    const domCols = db.prepare("PRAGMA table_info(domains)").all().map((c) => c.name);
    if (!domCols.includes("domain_type")) {
      db.exec("ALTER TABLE domains ADD COLUMN domain_type TEXT DEFAULT 'alias';");
    }
    if (!domCols.includes("routing_type")) {
      db.exec("ALTER TABLE domains ADD COLUMN routing_type TEXT DEFAULT 'direct';");
    }
    if (!domCols.includes("target_url")) {
      db.exec("ALTER TABLE domains ADD COLUMN target_url TEXT;");
    }
  } catch {
    /* ignore migration error if already exists */
  }
}

function bootstrapHostingPlans(db) {
  const plans = [
    {
      id: "plan_starter",
      name: "Starter",
      slug: "starter",
      max_websites: 1,
      max_databases: 2,
      max_storage_mb: 2048,
      max_bandwidth_mb: 20480,
    },
    {
      id: "plan_pro",
      name: "Professional",
      slug: "pro",
      max_websites: 5,
      max_databases: 10,
      max_storage_mb: 10240,
      max_bandwidth_mb: 102400,
    },
    {
      id: "plan_business",
      name: "Business",
      slug: "business",
      max_websites: 20,
      max_databases: 50,
      max_storage_mb: 51200,
      max_bandwidth_mb: 512000,
    },
    {
      id: "plan_unlimited",
      name: "Enterprise",
      slug: "unlimited",
      max_websites: 9999,
      max_databases: 9999,
      max_storage_mb: 999999,
      max_bandwidth_mb: 999999,
    },
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO hosting_plans (id, name, slug, max_websites, max_databases, max_storage_mb, max_bandwidth_mb)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const p of plans) {
    stmt.run(p.id, p.name, p.slug, p.max_websites, p.max_databases, p.max_storage_mb, p.max_bandwidth_mb);
  }

  // Ensure default org is attached to Enterprise plan
  try {
    db.prepare("UPDATE organizations SET plan_id = 'plan_unlimited' WHERE id = 'org_default' AND (plan_id IS NULL OR plan_id = '')").run();
  } catch {
    /* ignore */
  }
}

function syncExistingSites(db) {
  const nginxAvail = "/etc/nginx/sites-available";
  if (!existsSync(nginxAvail)) return;

  try {
    const existingInDb = new Set(db.prepare("SELECT name FROM websites").all().map((r) => r.name));
    const files = readdirSync(nginxAvail).filter((f) => !f.startsWith(".") && !f.endsWith(".bak"));
    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO websites (id, organization_id, name, primary_domain, app_type, document_root)
      VALUES (?, 'org_default', ?, ?, 'standard', ?)
    `);

    for (const file of files) {
      if (!existingInDb.has(file)) {
        const id = `site_${randomBytes(6).toString("hex")}`;
        insertStmt.run(id, file, file, path.join("/var/www", file));
      }
    }

    // Auto-sync domains table from Nginx for all sites if domains is empty
    const domainCount = db.prepare("SELECT COUNT(*) as count FROM domains").get()?.count || 0;
    if (domainCount === 0) {
      const allSites = db.prepare("SELECT id, name, primary_domain FROM websites").all();
      const insertDomainStmt = db.prepare(`
        INSERT OR IGNORE INTO domains (id, website_id, domain, is_primary, domain_type, routing_type, ssl_active)
        VALUES (?, ?, ?, ?, ?, 'direct', ?)
      `);

      for (const s of allSites) {
        const filePath = path.join(nginxAvail, s.name);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf8");
          const serverNames = [...content.matchAll(/server_name\s+([^;]+);/g)]
            .flatMap((m) => m[1].trim().split(/\s+/))
            .filter((d) => d && !d.startsWith("_") && !d.startsWith("$"));
          const uniqueNames = [...new Set(serverNames)];
          const hasSsl = content.includes("ssl_certificate") ? 1 : 0;

          for (const d of uniqueNames) {
            const isPrimary = d === s.primary_domain || (uniqueNames[0] === d && !uniqueNames.includes(s.primary_domain)) ? 1 : 0;
            const isSub = d.endsWith(`.${s.primary_domain}`) || d.startsWith("*.");
            const dType = isPrimary ? "primary" : isSub ? "subdomain" : "alias";
            insertDomainStmt.run(`dom_${randomBytes(6).toString("hex")}`, s.id, d, isPrimary, dType, hasSsl);
          }
        }
      }
    }
  } catch {
    /* non-blocking background sync */
  }
}

function bootstrapAdminUser(db) {
  const existingSuperAdmin = db.prepare("SELECT id FROM users WHERE role = 'super_admin' LIMIT 1").get();
  if (existingSuperAdmin) return;

  const config = loadConfig();
  const orgId = "org_default";

  db.prepare(`
    INSERT OR IGNORE INTO organizations (id, name, slug, max_websites, max_databases, max_storage_mb)
    VALUES (?, ?, ?, 999, 999, 999999)
  `).run(orgId, "Default Organization", "default");

  const adminUser = config.adminUser || "admin";
  const passwordHash = config.passwordHash || "";
  const totpSecret = config.totpSecret || null;
  const totpEnabled = config.totpEnabled ? 1 : 0;
  const email = config.letsencryptEmail || "admin@localhost";

  const userId = `usr_${randomBytes(8).toString("hex")}`;
  db.prepare(`
    INSERT INTO users (id, organization_id, username, email, password_hash, role, totp_secret, totp_enabled, status)
    VALUES (?, ?, ?, ?, ?, 'super_admin', ?, ?, 'active')
  `).run(userId, orgId, adminUser, email, passwordHash, totpSecret, totpEnabled);
}

export function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
