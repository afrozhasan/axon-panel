import { run, runToFile, runFromFile } from "./exec.js";

const BASE = ["--batch", "--raw", "--default-character-set=utf8mb4"];
const SYSTEM_SCHEMAS = ["information_schema", "mysql", "performance_schema", "sys"];

export function escapeSqlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function isReachable() {
  const result = await run("mysql", ["--batch", "--skip-column-names", "-e", "SELECT 1"], { timeout: 10000 });
  return { ok: result.ok, error: result.ok ? null : (result.stderr || "").trim() };
}

export async function query(sql, database) {
  const args = [...BASE];
  if (database) args.push(database);
  args.push("-e", sql);
  return run("mysql", args, { timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
}

export function parseRows(stdout) {
  const lines = stdout.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = lines[0].split("\t");
  const rows = lines.slice(1).map((line) => line.split("\t"));
  return { columns, rows };
}

export async function listDatabases() {
  const result = await query(
    `SELECT s.SCHEMA_NAME AS name,
            s.DEFAULT_CHARACTER_SET_NAME AS charset,
            s.DEFAULT_COLLATION_NAME AS collation,
            COALESCE(SUM(t.DATA_LENGTH + t.INDEX_LENGTH), 0) AS bytes,
            COUNT(t.TABLE_NAME) AS tables
       FROM information_schema.SCHEMATA s
       LEFT JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = s.SCHEMA_NAME
      GROUP BY s.SCHEMA_NAME, s.DEFAULT_CHARACTER_SET_NAME, s.DEFAULT_COLLATION_NAME
      ORDER BY s.SCHEMA_NAME`,
  );
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), databases: [] };

  const { rows } = parseRows(result.stdout);
  const databases = rows.map((row) => ({
    name: row[0],
    charset: row[1],
    collation: row[2],
    bytes: Number(row[3]) || 0,
    tables: Number(row[4]) || 0,
    system: SYSTEM_SCHEMAS.includes(row[0]),
  }));
  return { ok: true, databases };
}

export async function listUsers() {
  const result = await query("SELECT User, Host FROM mysql.user ORDER BY User, Host");
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), users: [] };
  const { rows } = parseRows(result.stdout);
  return { ok: true, users: rows.map((row) => ({ user: row[0], host: row[1] })) };
}

export async function userGrants(user, host) {
  const result = await query(`SHOW GRANTS FOR '${escapeSqlString(user)}'@'${escapeSqlString(host)}'`);
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), grants: [] };
  return { ok: true, grants: result.stdout.split("\n").filter(Boolean) };
}

export async function listTables(database) {
  const result = await query(
    `SELECT t.TABLE_NAME AS name, t.ENGINE, t.TABLE_ROWS AS row_estimate,
            (t.DATA_LENGTH + t.INDEX_LENGTH) AS bytes, t.TABLE_COLLATION
       FROM information_schema.TABLES t
      WHERE t.TABLE_SCHEMA = '${escapeSqlString(database)}'
      ORDER BY t.TABLE_NAME`,
  );
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), tables: [] };
  const { rows } = parseRows(result.stdout);
  return {
    ok: true,
    tables: rows.map((row) => ({
      name: row[0],
      engine: row[1],
      rowEstimate: Number(row[2]) || 0,
      bytes: Number(row[3]) || 0,
      collation: row[4],
    })),
  };
}

export async function createDatabase(name, charset = "utf8mb4", collation = "utf8mb4_unicode_ci") {
  return query(`CREATE DATABASE \`${name}\` CHARACTER SET ${charset} COLLATE ${collation}`);
}

export async function dropDatabase(name) {
  return query(`DROP DATABASE \`${name}\``);
}

export async function createUser(user, host, password, grants) {
  const statements = [`CREATE USER IF NOT EXISTS '${escapeSqlString(user)}'@'${escapeSqlString(host)}' IDENTIFIED BY '${escapeSqlString(password)}'`];
  if (!grants || grants.length === 0) {
    statements.push(`GRANT USAGE ON *.* TO '${escapeSqlString(user)}'@'${escapeSqlString(host)}'`);
  }
  for (const grant of grants ?? []) {
    const scope = grant.database === "*" ? "*" : `\`${grant.database}\``;
    statements.push(
      `GRANT ${grant.privileges} ON ${scope}.* TO '${escapeSqlString(user)}'@'${escapeSqlString(host)}'`,
    );
  }
  statements.push("FLUSH PRIVILEGES");
  return query(statements.join("; "));
}

export async function dropUser(user, host) {
  return query(`DROP USER '${escapeSqlString(user)}'@'${escapeSqlString(host)}'`);
}

export async function setPassword(user, host, password) {
  return query(`ALTER USER '${escapeSqlString(user)}'@'${escapeSqlString(host)}' IDENTIFIED BY '${escapeSqlString(password)}'`);
}

export function dumpToFile(database, targetPath) {
  return runToFile(
    "mysqldump",
    ["--single-transaction", "--routines", "--events", "--default-character-set=utf8mb4", "--databases", database],
    targetPath,
    { timeout: 1800000 },
  );
}

export function restoreFromFile(database, sourcePath) {
  const args = ["--default-character-set=utf8mb4"];
  if (database) args.push(database);
  return runFromFile("mysql", args, sourcePath, { timeout: 1800000 });
}
