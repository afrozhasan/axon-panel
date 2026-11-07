import { run } from "../exec.js";
import { runWpCli } from "./security.js";
import { getDb } from "../db.js";

/**
 * Fetch detailed database tables information
 */
export async function getWpDatabaseInfo(docroot) {
  const evalScript = `
    global $wpdb;
    $tables = $wpdb->get_results("SELECT table_name AS name, engine, table_rows AS rows_count, data_length AS data_bytes, index_length AS index_bytes, data_free AS overhead_bytes FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY (data_length + index_length) DESC");
    $dbName = $wpdb->dbname;
    $prefix = $wpdb->prefix;
    echo json_encode(compact('dbName', 'prefix', 'tables'));
  `;

  const res = await runWpCli(docroot, ["eval", evalScript]).catch(() => ({ stdout: "{}" }));
  let data = {};
  try {
    data = JSON.parse(res.stdout.trim() || "{}");
  } catch {}

  const rawTables = data.tables || [];
  let totalDataBytes = 0;
  let totalIndexBytes = 0;
  let totalOverheadBytes = 0;

  const tables = rawTables.map((t) => {
    const dataBytes = parseInt(t.data_bytes, 10) || 0;
    const indexBytes = parseInt(t.index_bytes, 10) || 0;
    const overheadBytes = parseInt(t.overhead_bytes, 10) || 0;
    totalDataBytes += dataBytes;
    totalIndexBytes += indexBytes;
    totalOverheadBytes += overheadBytes;

    return {
      name: t.name,
      engine: t.engine || "InnoDB",
      rows: parseInt(t.rows_count, 10) || 0,
      dataSizeMb: (dataBytes / (1024 * 1024)).toFixed(2),
      indexSizeMb: (indexBytes / (1024 * 1024)).toFixed(2),
      totalSizeMb: ((dataBytes + indexBytes) / (1024 * 1024)).toFixed(2),
      overheadMb: (overheadBytes / (1024 * 1024)).toFixed(2),
    };
  });

  return {
    databaseName: data.dbName || "unknown",
    tablePrefix: data.prefix || "wp_",
    totalTables: tables.length,
    totalDataSizeMb: (totalDataBytes / (1024 * 1024)).toFixed(2),
    totalIndexSizeMb: (totalIndexBytes / (1024 * 1024)).toFixed(2),
    totalSizeMb: ((totalDataBytes + totalIndexBytes) / (1024 * 1024)).toFixed(2),
    totalOverheadMb: (totalOverheadBytes / (1024 * 1024)).toFixed(2),
    tables,
  };
}

/**
 * Optimize all tables or a specific table
 */
export async function optimizeWpTables(docroot, siteName, tableName = null) {
  let res;
  if (tableName) {
    res = await runWpCli(docroot, ["eval", `global $wpdb; echo json_encode($wpdb->query("OPTIMIZE TABLE ${tableName.replace(/[^a-zA-Z0-9_]/g, '')}"));`]);
  } else {
    res = await runWpCli(docroot, ["db", "optimize"]);
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json)
    VALUES (?, 'database', 'optimize', ?, ?)
  `).run(siteName, res.ok ? "success" : "error", JSON.stringify({ tableName, output: res.stdout || res.stderr }));

  return {
    ok: res.ok,
    output: (res.stdout || res.stderr || "").trim(),
    message: tableName ? `Table ${tableName} optimized` : "All WordPress tables optimized successfully",
  };
}

/**
 * Repair tables
 */
export async function repairWpTables(docroot, siteName) {
  const res = await runWpCli(docroot, ["db", "repair"]);

  const db = getDb();
  db.prepare(`
    INSERT INTO wp_operations_log (site_name, module, action, status, details_json)
    VALUES (?, 'database', 'repair', ?, ?)
  `).run(siteName, res.ok ? "success" : "error", JSON.stringify({ output: res.stdout || res.stderr }));

  return {
    ok: res.ok,
    output: (res.stdout || res.stderr || "").trim(),
    message: "WordPress database tables repair completed",
  };
}
