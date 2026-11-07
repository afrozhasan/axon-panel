import { Router } from "express";
import path from "node:path";
import { readdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import * as mariadb from "../lib/mariadb.js";
import * as postgres from "../lib/postgres.js";
import { upload, ensureUploadDirExists } from "../lib/upload.js";
import {
  assertDatabaseName,
  assertDbUser,
  assertDbHost,
  assertSql,
  assertBackupFile,
  assertEnum,
  resolveSafePath,
} from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";
import { getDb } from "../lib/db.js";
import { randomBytes } from "node:crypto";
import { assertCanCreateDatabase } from "../lib/quotas.js";

const router = Router();

const MYSQL_SYSTEM = ["information_schema", "mysql", "performance_schema", "sys"];

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function backupPath(filename) {
  const dir = loadConfig().backupDir;
  return resolveSafePath(path.join(dir, filename), [dir]);
}

function listBackups() {
  const dir = loadConfig().backupDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .map((name) => {
      const full = path.join(dir, name);
      try {
        const info = statSync(full);
        if (!info.isFile()) return null;
        return { name, bytes: info.size, modified: info.mtime.toISOString() };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

function failure(res, result, fallback) {
  return res.status(500).json({ error: (result.stderr || result.error || fallback || "Command failed").trim() });
}

router.get("/", async (_req, res, next) => {
  try {
    const [mysqlReachable, clusters] = await Promise.all([mariadb.isReachable(), postgres.listClusters()]);
    const pgReachable = clusters.clusters.some((c) => c.status === "online")
      ? await postgres.isReachable()
      : { ok: false, error: "PostgreSQL cluster is not running" };
    res.json({
      mariadb: { reachable: mysqlReachable.ok, error: mysqlReachable.error },
      postgres: { clusters: clusters.clusters, reachable: pgReachable.ok, error: pgReachable.error },
      backupDir: loadConfig().backupDir,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/mysql", async (_req, res, next) => {
  try {
    const [reachable, databases, users] = await Promise.all([
      mariadb.isReachable(),
      mariadb.listDatabases(),
      mariadb.listUsers(),
    ]);
    res.json({
      reachable: reachable.ok,
      error: reachable.error,
      databases: databases.databases ?? [],
      users: users.users ?? [],
    });
  } catch (error) {
    next(error);
  }
});

router.get("/mysql/databases/:name/tables", async (req, res, next) => {
  try {
    const name = assertDatabaseName(req.params.name);
    const result = await mariadb.listTables(name);
    if (!result.ok) return failure(res, result);
    return res.json({ tables: result.tables });
  } catch (error) {
    return next(error);
  }
});

router.post("/mysql/databases", async (req, res, next) => {
  try {
    assertCanCreateDatabase(req.actor?.orgId, req.actor?.role);
    const { name, charset, collation } = req.body ?? {};
    const database = assertDatabaseName(name);
    const result = await mariadb.createDatabase(database, charset || "utf8mb4", collation || "utf8mb4_unicode_ci");
    audit({
      action: "db.mysql.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });

    try {
      const db = getDb();
      const dbId = `db_${randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR REPLACE INTO databases (id, organization_id, engine, db_name, db_user)
        VALUES (?, ?, 'mariadb', ?, ?)
      `).run(dbId, req.actor?.orgId || "org_default", database, req.actor?.username || "root");
    } catch {
      /* ignore */
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/mysql/databases/:name", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.params.name);
    if (MYSQL_SYSTEM.includes(database)) return res.status(400).json({ error: "System databases cannot be dropped" });
    if (req.body?.confirm !== database) {
      return res.status(400).json({ error: "Type the exact database name to confirm deletion" });
    }
    const result = await mariadb.dropDatabase(database);
    audit({
      action: "db.mysql.drop",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });

    try {
      getDb().prepare("DELETE FROM databases WHERE db_name = ? AND engine = 'mariadb'").run(database);
    } catch {
      /* ignore */
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/mysql/query", async (req, res, next) => {
  try {
    const { database } = req.body ?? {};
    const sql = assertSql(req.body?.sql);
    const db = database ? assertDatabaseName(database) : null;
    const result = await mariadb.query(sql, db);
    audit({
      action: "db.mysql.query",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database: db, sql },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });
    if (!result.ok) {
      return res.status(400).json({ error: (result.stderr || "Query failed").trim() });
    }
    const parsed = mariadb.parseRows(result.stdout);
    return res.json({ ...parsed, rowCount: parsed.rows.length, durationMs: result.durationMs });
  } catch (error) {
    return next(error);
  }
});

router.post("/mysql/users", async (req, res, next) => {
  try {
    const { password, grants } = req.body ?? {};
    const user = assertDbUser(req.body?.user);
    const host = assertDbHost(req.body?.host);
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Database password must be at least 8 characters" });
    }
    const normalizedGrants = Array.isArray(grants)
      ? grants.map((grant) => ({
          database: grant.database === "*" ? "*" : assertDatabaseName(grant.database),
          privileges: assertEnum(
            grant.privileges || "ALL PRIVILEGES",
            ["ALL PRIVILEGES", "SELECT", "SELECT, INSERT, UPDATE, DELETE", "SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, INDEX, ALTER"],
            "privileges",
          ),
        }))
      : [];

    const result = await mariadb.createUser(user, host, password, normalizedGrants);
    audit({
      action: "db.mysql.user.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { user, host, grants: normalizedGrants.map((g) => g.database) },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/mysql/users/:user/:host/grants", async (req, res, next) => {
  try {
    const user = assertDbUser(req.params.user);
    const host = assertDbHost(req.params.host);
    const result = await mariadb.userGrants(user, host);
    res.json({ grants: result.grants });
  } catch (error) {
    next(error);
  }
});

router.post("/mysql/users/password", async (req, res, next) => {
  try {
    const user = assertDbUser(req.body?.user);
    const host = assertDbHost(req.body?.host);
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Database password must be at least 8 characters" });
    }
    const result = await mariadb.setPassword(user, host, password);
    audit({
      action: "db.mysql.user.password",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { user, host },
      result: result.ok ? "ok" : "error",
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/mysql/users", async (req, res, next) => {
  try {
    const user = assertDbUser(req.body?.user);
    const host = assertDbHost(req.body?.host);
    if (req.body?.confirm !== `${user}@${host}`) {
      return res.status(400).json({ error: `Type ${user}@${host} to confirm` });
    }
    const result = await mariadb.dropUser(user, host);
    audit({
      action: "db.mysql.user.drop",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { user, host },
      result: result.ok ? "ok" : "error",
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/postgres", async (_req, res, next) => {
  try {
    const clusters = await postgres.listClusters();
    const online = clusters.clusters.some((c) => c.status === "online");
    if (!online) {
      return res.json({
        clusters: clusters.clusters,
        online: false,
        reachable: false,
        error: "No PostgreSQL cluster is running. Start one below.",
        databases: [],
        roles: [],
      });
    }
    const [reachable, databases, roles] = await Promise.all([
      postgres.isReachable(),
      postgres.listDatabases(),
      postgres.listRoles(),
    ]);
    return res.json({
      clusters: clusters.clusters,
      online: true,
      reachable: reachable.ok,
      error: reachable.error,
      databases: databases.databases ?? [],
      roles: roles.roles ?? [],
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/cluster/:action", async (req, res, next) => {
  try {
    const action = assertEnum(req.params.action, ["start", "stop", "restart"], "action");
    const { version, name } = req.body ?? {};
    const cleanVersion = String(version ?? "").trim();
    if (!/^\d{1,3}$/.test(cleanVersion)) return res.status(400).json({ error: "Invalid PostgreSQL version" });
    const cleanName = assertDbUser(name);

    const result = await postgres.controlCluster(action, cleanVersion, cleanName);
    audit({
      action: `db.postgres.cluster.${action}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { version: cleanVersion, name: cleanName },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || `Failed to ${action} cluster`).trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/postgres/databases/:name/tables", async (req, res, next) => {
  try {
    const name = assertDatabaseName(req.params.name);
    const result = await postgres.listTables(name);
    if (!result.ok) return failure(res, result);
    return res.json({ tables: result.tables });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/databases", async (req, res, next) => {
  try {
    assertCanCreateDatabase(req.actor?.orgId, req.actor?.role);
    const database = assertDatabaseName(req.body?.name);
    const owner = req.body?.owner ? assertDbUser(req.body.owner) : null;
    const result = await postgres.createDatabase(database, owner);
    audit({
      action: "db.postgres.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, owner },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });

    try {
      const db = getDb();
      const dbId = `db_${randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR REPLACE INTO databases (id, organization_id, engine, db_name, db_user)
        VALUES (?, ?, 'postgres', ?, ?)
      `).run(dbId, req.actor?.orgId || "org_default", database, owner || req.actor?.username || "postgres");
    } catch {
      /* ignore */
    }

    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/postgres/databases/:name", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.params.name);
    if (["postgres", "template0", "template1"].includes(database)) {
      return res.status(400).json({ error: "System databases cannot be dropped" });
    }
    if (req.body?.confirm !== database) {
      return res.status(400).json({ error: "Type the exact database name to confirm deletion" });
    }
    const result = await postgres.dropDatabase(database);
    audit({
      action: "db.postgres.drop",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });

    try {
      getDb().prepare("DELETE FROM databases WHERE db_name = ? AND engine = 'postgres'").run(database);
    } catch {
      /* ignore */
    }

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/query", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.body?.database);
    const sql = assertSql(req.body?.sql);
    const result = await postgres.query(sql, database);
    audit({
      action: "db.postgres.query",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, sql },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });
    if (!result.ok) return res.status(400).json({ error: (result.stderr || "Query failed").trim() });
    const parsed = postgres.parseCsv(result.stdout);
    return res.json({ ...parsed, rowCount: parsed.rows.length, durationMs: result.durationMs });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/roles", async (req, res, next) => {
  try {
    const name = assertDbUser(req.body?.name);
    const { password, superuser, createDb, canLogin } = req.body ?? {};
    if (password !== undefined && password !== null && password !== "" && typeof password !== "string") {
      return res.status(400).json({ error: "Password must be a string" });
    }
    const result = await postgres.createRole({
      name,
      password: password || null,
      superuser: Boolean(superuser),
      createDb: Boolean(createDb),
      canLogin: canLogin !== false,
    });
    audit({
      action: "db.postgres.role.create",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name, superuser: Boolean(superuser), createDb: Boolean(createDb) },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.status(201).json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/roles/password", async (req, res, next) => {
  try {
    const name = assertDbUser(req.body?.name);
    const { password } = req.body ?? {};
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const result = await postgres.alterRolePassword(name, password);
    audit({
      action: "db.postgres.role.password",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.delete("/postgres/roles/:name", async (req, res, next) => {
  try {
    const name = assertDbUser(req.params.name);
    if (name === "postgres") return res.status(400).json({ error: "The postgres superuser cannot be dropped" });
    if (req.body?.confirm !== name) {
      return res.status(400).json({ error: "Type the exact role name to confirm deletion" });
    }
    const result = await postgres.dropRole(name);
    audit({
      action: "db.postgres.role.drop",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/grant", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.body?.database);
    const role = assertDbUser(req.body?.role);
    const result = await postgres.grantDatabase(database, role);
    audit({
      action: "db.postgres.grant",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, role },
      result: result.ok ? "ok" : "error",
    });
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "").trim() });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/mysql/backup", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.body?.database);
    ensureUploadDirExists();
    const filename = `mariadb-${database}-${stamp()}.sql`;
    const target = backupPath(filename);
    const result = await mariadb.dumpToFile(database, target);
    audit({
      action: "db.mysql.backup",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, filename },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) {
      if (existsSync(target)) unlinkSync(target);
      return res.status(500).json({ error: (result.stderr || "mysqldump failed").trim() });
    }
    return res.json({ ok: true, file: filename, bytes: statSync(target).size });
  } catch (error) {
    return next(error);
  }
});

router.post("/postgres/backup", async (req, res, next) => {
  try {
    const database = assertDatabaseName(req.body?.database);
    ensureUploadDirExists();
    const filename = `postgres-${database}-${stamp()}.sql`;
    const target = backupPath(filename);
    const result = await postgres.dumpToFile(database, target);
    audit({
      action: "db.postgres.backup",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, filename },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    if (!result.ok) {
      if (existsSync(target)) unlinkSync(target);
      return res.status(500).json({ error: (result.stderr || "pg_dump failed").trim() });
    }
    return res.json({ ok: true, file: filename, bytes: statSync(target).size });
  } catch (error) {
    return next(error);
  }
});

router.post("/mysql/restore", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Select a .sql file to restore" });
    const database = req.body?.database ? assertDatabaseName(req.body.database) : null;
    const result = await mariadb.restoreFromFile(database, req.file.path);
    audit({
      action: "db.mysql.restore",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, upload: req.file.originalname },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    unlinkSync(req.file.path);
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "Restore failed").trim() });
    return res.json({ ok: true });
  } catch (error) {
    if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
    return next(error);
  }
});

router.post("/postgres/restore", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Select a .sql file to restore" });
    const database = assertDatabaseName(req.body?.database);
    const result = await postgres.restoreFromFile(database, req.file.path);
    audit({
      action: "db.postgres.restore",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { database, upload: req.file.originalname },
      result: result.ok ? "ok" : "error",
      detail: result.stderr,
    });
    unlinkSync(req.file.path);
    if (!result.ok) return res.status(500).json({ error: (result.stderr || "Restore failed").trim() });
    return res.json({ ok: true });
  } catch (error) {
    if (req.file && existsSync(req.file.path)) unlinkSync(req.file.path);
    return next(error);
  }
});

router.get("/backups", (_req, res, next) => {
  try {
    res.json({ dir: loadConfig().backupDir, backups: listBackups() });
  } catch (error) {
    next(error);
  }
});

router.get("/backups/:file/download", (req, res, next) => {
  try {
    const filename = assertBackupFile(req.params.file);
    const target = backupPath(filename);
    if (!existsSync(target)) return res.status(404).json({ error: "Backup not found" });
    return res.download(target, filename);
  } catch (error) {
    return next(error);
  }
});

router.delete("/backups/:file", (req, res, next) => {
  try {
    const filename = assertBackupFile(req.params.file);
    if (req.body?.confirm !== filename) {
      return res.status(400).json({ error: "Type the exact file name to confirm deletion" });
    }
    const target = backupPath(filename);
    if (!existsSync(target)) return res.status(404).json({ error: "Backup not found" });
    unlinkSync(target);
    audit({ action: "db.backup.delete", actor: req.actor.username, ip: clientIp(req), params: { filename } });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/backup-all", async (req, res, next) => {
  try {
    ensureUploadDirExists();
    const results = [];

    const mysqlDatabases = await mariadb.listDatabases();
    if (mysqlDatabases.ok) {
      for (const database of mysqlDatabases.databases.filter((d) => !d.system)) {
        const filename = `mariadb-${database.name}-${stamp()}.sql`;
        const target = backupPath(filename);
        const result = await mariadb.dumpToFile(database.name, target);
        if (!result.ok && existsSync(target)) unlinkSync(target);
        results.push({ engine: "mariadb", database: database.name, file: filename, ok: result.ok, error: result.ok ? null : (result.stderr || "").trim() });
      }
    }

    const clusters = await postgres.listClusters();
    if (clusters.clusters.some((c) => c.status === "online")) {
      const pgDatabases = await postgres.listDatabases();
      if (pgDatabases.ok) {
        for (const database of pgDatabases.databases) {
          const filename = `postgres-${database.name}-${stamp()}.sql`;
          const target = backupPath(filename);
          const result = await postgres.dumpToFile(database.name, target);
          if (!result.ok && existsSync(target)) unlinkSync(target);
          results.push({ engine: "postgres", database: database.name, file: filename, ok: result.ok, error: result.ok ? null : (result.stderr || "").trim() });
        }
      }
    }

    audit({
      action: "db.backup-all",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { count: results.length, failed: results.filter((r) => !r.ok).length },
      result: results.every((r) => r.ok) ? "ok" : "error",
    });
    return res.json({ ok: results.every((r) => r.ok), results });
  } catch (error) {
    return next(error);
  }
});

export default router;
