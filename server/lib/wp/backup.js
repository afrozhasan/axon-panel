import { existsSync, mkdirSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import path from "node:path";
import { run } from "../exec.js";
import { runWpCli } from "./security.js";
import { readSite, writeSiteValidated, reloadNginx } from "../nginx.js";
import { getDb } from "../db.js";

const BACKUP_ROOT = "/var/backups/webpanel/wp";

/**
 * List all backups for a site
 */
export function listWpBackups(siteName) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM wp_backups
    WHERE site_name = ?
    ORDER BY created_at DESC
  `).all(siteName);

  return rows.map((r) => {
    let sizeMb = "0.00";
    if (r.backup_path && existsSync(r.backup_path)) {
      try {
        let total = 0;
        const files = readdirSync(r.backup_path);
        for (const f of files) {
          total += statSync(path.join(r.backup_path, f)).size;
        }
        sizeMb = (total / (1024 * 1024)).toFixed(2);
      } catch {}
    }

    return {
      id: r.id,
      siteName: r.site_name,
      backupType: r.backup_type,
      backupPath: r.backup_path,
      filesIncluded: r.files_included,
      notes: r.notes,
      sizeMb,
      createdAt: r.created_at,
    };
  });
}

/**
 * Create a WordPress snapshot
 */
export async function createWpBackup(siteName, docroot, options = {}) {
  const { backupType = "manual", notes = "Manual WordPress snapshot" } = options;
  const timestamp = Date.now();
  const backupId = `wp_${timestamp}`;
  const backupDir = path.join(BACKUP_ROOT, siteName, backupId);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });

  // 1. Export Database
  const dbDumpPath = path.join(backupDir, `${siteName}_db.sql`);
  const exportRes = await runWpCli(docroot, ["db", "export", dbDumpPath]).catch(async () => {
    return run("mysqldump", [
      "--single-transaction",
      "--quick",
      await getWpDbName(docroot),
      `--result-file=${dbDumpPath}`,
    ]);
  });

  // 2. Backup wp-config.php
  const configPath = path.join(docroot, "wp-config.php");
  if (existsSync(configPath)) {
    writeFileSync(path.join(backupDir, "wp-config.php.bak"), readFileSync(configPath), { mode: 0o600 });
  }

  // 3. Backup Nginx vhost
  try {
    const siteObj = readSite(siteName);
    writeFileSync(path.join(backupDir, "nginx.conf.bak"), siteObj.content, { mode: 0o600 });
  } catch {}

  const filesIncluded = "database.sql,wp-config.php,nginx.conf";

  // 4. Save metadata in DB
  const db = getDb();
  db.prepare(`
    INSERT INTO wp_backups (id, site_name, backup_type, backup_path, db_dump_path, files_included, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(backupId, siteName, backupType, backupDir, dbDumpPath, filesIncluded, notes);

  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
    VALUES (?, 'backup', 'create', 'success', ?, ?)
  `).run(siteName, JSON.stringify({ backupId, notes }), backupDir);

  return {
    ok: true,
    backupId,
    backupDir,
    message: "WordPress snapshot created successfully",
  };
}

/**
 * Restore WordPress snapshot
 */
export async function restoreWpBackup(siteName, docroot, backupId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM wp_backups WHERE id = ? AND site_name = ?").get(backupId, siteName);

  if (!row || !existsSync(row.backup_path)) {
    throw new Error(`Backup ${backupId} not found on disk`);
  }

  // 1. Restore Database
  if (row.db_dump_path && existsSync(row.db_dump_path)) {
    const importRes = await runWpCli(docroot, ["db", "import", row.db_dump_path]).catch(async () => {
      const dbName = await getWpDbName(docroot);
      return run("mysql", [dbName, "-e", `source ${row.db_dump_path}`]);
    });
    if (!importRes.ok) {
      throw new Error(`Database restore failed: ${importRes.stderr || importRes.stdout}`);
    }
  }

  // 2. Restore wp-config.php
  const configBak = path.join(row.backup_path, "wp-config.php.bak");
  if (existsSync(configBak)) {
    writeFileSync(path.join(docroot, "wp-config.php"), readFileSync(configBak), { mode: 0o640 });
  }

  // 3. Restore Nginx vhost
  const nginxBak = path.join(row.backup_path, "nginx.conf.bak");
  if (existsSync(nginxBak)) {
    const vhostContent = readFileSync(nginxBak, "utf8");
    const writeRes = await writeSiteValidated(siteName, vhostContent);
    if (writeRes.ok) {
      await reloadNginx();
    }
  }

  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json, backup_ref)
    VALUES (?, 'backup', 'restore', 'success', ?, ?)
  `).run(siteName, JSON.stringify({ backupId }), row.backup_path);

  return {
    ok: true,
    backupId,
    message: "WordPress snapshot restored successfully",
  };
}

/**
 * Delete a backup
 */
export function deleteWpBackup(siteName, backupId) {
  const db = getDb();
  const row = db.prepare("SELECT backup_path FROM wp_backups WHERE id = ? AND site_name = ?").get(backupId, siteName);

  if (row?.backup_path && existsSync(row.backup_path)) {
    try {
      rmSync(row.backup_path, { recursive: true, force: true });
    } catch {}
  }

  db.prepare("DELETE FROM wp_backups WHERE id = ? AND site_name = ?").run(backupId, siteName);
  return { ok: true, message: "Backup deleted" };
}

async function getWpDbName(docroot) {
  const configPath = path.join(docroot, "wp-config.php");
  if (!existsSync(configPath)) return "";
  const content = readFileSync(configPath, "utf8");
  const match = content.match(/define\s*\(\s*['"]DB_NAME['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i);
  return match ? match[1] : "";
}
