import { run, runToFile, runFromFile } from "./exec.js";

const AS_POSTGRES = ["-u", "postgres", "--"];
const PSQL_BASE = ["-X", "--no-psqlrc"];

export function quoteIdent(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export function escapeSqlString(value) {
  return String(value).replace(/'/g, "''");
}

export function psql(args, options = {}) {
  return run("runuser", [...AS_POSTGRES, "psql", ...args], { timeout: 120000, maxBuffer: 32 * 1024 * 1024, ...options });
}

export async function isReachable() {
  const result = await psql([...PSQL_BASE, "-tAc", "SELECT 1"], { timeout: 10000 });
  return { ok: result.ok && result.stdout.trim() === "1", error: result.ok ? null : (result.stderr || "").trim() };
}

export async function query(sql, database, { csv = true } = {}) {
  const args = [...PSQL_BASE];
  if (database) args.push("-d", database);
  if (csv) args.push("--csv");
  args.push("-q", "-c", sql);
  return psql(args);
}

export function parseCsv(stdout) {
  const text = stdout.trim();
  if (!text) return { columns: [], rows: [] };
  const lines = splitCsvLines(text);
  if (lines.length === 0) return { columns: [], rows: [] };
  const columns = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { columns, rows };
}

function splitCsvLines(text) {
  const lines = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    if (char === "\n" && !inQuotes) {
      lines.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) lines.push(current);
  return lines;
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

export async function listClusters() {
  const result = await run("pg_lsclusters", ["-h"], { timeout: 10000 });
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), clusters: [] };
  const clusters = result.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      return {
        version: cols[0],
        name: cols[1],
        port: Number(cols[2]),
        status: cols[3],
        owner: cols[4],
        dataDir: cols[5],
        logFile: cols[6],
      };
    });
  return { ok: true, clusters };
}

export function controlCluster(action, version, name) {
  return run("pg_ctlcluster", [String(version), String(name), action], { timeout: 120000 });
}

export async function listDatabases() {
  const result = await query(
    `SELECT datname AS name,
            pg_size_pretty(pg_database_size(datname)) AS size_pretty,
            pg_database_size(datname) AS bytes,
            pg_get_userbyid(datdba) AS owner,
            datallowconn AS allow_conn,
            pg_encoding_to_char(encoding) AS encoding
       FROM pg_database
      WHERE datistemplate = false
      ORDER BY datname`,
    "postgres",
  );
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), databases: [] };
  const { rows } = parseCsv(result.stdout);
  return {
    ok: true,
    databases: rows.map((row) => ({
      name: row[0],
      sizePretty: row[1],
      bytes: Number(row[2]) || 0,
      owner: row[3],
      allowConnections: row[4] === "t",
      encoding: row[5],
    })),
  };
}

export async function listRoles() {
  const result = await query(
    `SELECT rolname AS name, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin, rolreplication,
            COALESCE(rolvaliduntil::text, '') AS valid_until
       FROM pg_roles
      WHERE rolname NOT LIKE 'pg%'
      ORDER BY rolname`,
    "postgres",
  );
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), roles: [] };
  const { rows } = parseCsv(result.stdout);
  return {
    ok: true,
    roles: rows.map((row) => ({
      name: row[0],
      superuser: row[1] === "t",
      createDb: row[2] === "t",
      createRole: row[3] === "t",
      canLogin: row[4] === "t",
      replication: row[5] === "t",
      validUntil: row[6] || null,
    })),
  };
}

export async function listTables(database) {
  const result = await query(
    `SELECT schemaname AS schema, tablename AS name, pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, tablename))) AS size
       FROM pg_tables
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename`,
    database,
  );
  if (!result.ok) return { ok: false, error: (result.stderr || "").trim(), tables: [] };
  const { rows } = parseCsv(result.stdout);
  return { ok: true, tables: rows.map((row) => ({ schema: row[0], name: row[1], size: row[2] })) };
}

export async function createDatabase(name, owner) {
  const sql = owner
    ? `CREATE DATABASE ${quoteIdent(name)} OWNER ${quoteIdent(owner)}`
    : `CREATE DATABASE ${quoteIdent(name)}`;
  return query(sql, "postgres", { csv: false });
}

export async function dropDatabase(name) {
  return query(`DROP DATABASE ${quoteIdent(name)}`, "postgres", { csv: false });
}

export async function createRole({ name, password, superuser, createDb, canLogin = true }) {
  const options = [canLogin ? "LOGIN" : "NOLOGIN"];
  if (superuser) options.push("SUPERUSER");
  if (createDb) options.push("CREATEDB");
  const passwordClause = password ? `PASSWORD '${escapeSqlString(password)}'` : "";
  return query(`CREATE ROLE ${quoteIdent(name)} WITH ${options.join(" ")} ${passwordClause}`, "postgres", { csv: false });
}

export async function alterRolePassword(name, password) {
  return query(`ALTER ROLE ${quoteIdent(name)} WITH PASSWORD '${escapeSqlString(password)}'`, "postgres", { csv: false });
}

export async function dropRole(name) {
  return query(`DROP ROLE ${quoteIdent(name)}`, "postgres", { csv: false });
}

export async function grantDatabase(database, role, privileges = "ALL PRIVILEGES") {
  return query(`GRANT ${privileges} ON DATABASE ${quoteIdent(database)} TO ${quoteIdent(role)}`, "postgres", { csv: false });
}

export function dumpToFile(database, targetPath) {
  return runToFile("runuser", [...AS_POSTGRES, "pg_dump", "--no-owner", "--no-acl", "-d", database], targetPath, {
    timeout: 1800000,
  });
}

export function restoreFromFile(database, sourcePath) {
  return runFromFile("runuser", [...AS_POSTGRES, "psql", ...PSQL_BASE, "-q", "-d", database], sourcePath, {
    timeout: 1800000,
  });
}
