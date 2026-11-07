import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatBytes, relativeTime } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  Tabs,
  useAsyncAction,
  useToast,
} from "../components/ui";

type TableInfo = { name: string; engine?: string | null; rowEstimate?: number; bytes?: number; collation?: string | null; schema?: string; size?: string };

function TablesModal({
  target,
  onClose,
}: {
  target: { engine: "mysql" | "postgres"; database: string } | null;
  onClose: () => void;
}) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setTables(null);
      return;
    }
    setTables(null);
    setError(null);
    api
      .get<{ tables: TableInfo[] }>(
        `/databases/${target.engine}/databases/${encodeURIComponent(target.database)}/tables`,
      )
      .then((result) => setTables(result.tables))
      .catch((caught) => setError(errorMessage(caught)));
  }, [target]);

  return (
    <Modal
      open={Boolean(target)}
      title={`Tables · ${target?.database ?? ""}`}
      onClose={onClose}
      width="max-w-3xl"
    >
      <ErrorBanner message={error} />
      {tables === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Spinner /> Loading tables…
        </div>
      ) : tables && tables.length === 0 ? (
        <EmptyState message="This database has no tables" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Table</th>
                <th className="th">{target?.engine === "mysql" ? "Engine" : "Schema"}</th>
                <th className="th">Rows</th>
                <th className="th">Size</th>
              </tr>
            </thead>
            <tbody>
              {tables?.map((table) => (
                <tr key={`${table.schema ?? ""}${table.name}`} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="td mono text-xs text-[var(--axon-text)]">{table.name}</td>
                  <td className="td text-[11px] text-[var(--axon-muted)]">{table.engine ?? table.schema ?? "—"}</td>
                  <td className="td">{table.rowEstimate !== undefined ? table.rowEstimate.toLocaleString() : "—"}</td>
                  <td className="td">{table.size ?? formatBytes(table.bytes ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function PasswordModal({
  open,
  label,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  label: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  return (
    <Modal open={open} title={`Set password · ${label}`} onClose={onClose}>
      <Field label="New password" hint="Minimum 8 characters. Applications using this account must be updated.">
        <input
          className="field"
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          autoFocus
        />
      </Field>
      <footer className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} disabled={value.length < 8} onClick={() => onSubmit(value)}>
          Set password
        </Button>
      </footer>
    </Modal>
  );
}

type MysqlDatabase = { name: string; charset: string; collation: string; bytes: number; tables: number; system: boolean };
type MysqlUser = { user: string; host: string };
type MysqlResponse = { reachable: boolean; error: string | null; databases: MysqlDatabase[]; users: MysqlUser[] };

type Cluster = { version: string; name: string; port: number; status: string; dataDir: string };
type PgDatabase = { name: string; sizePretty: string; bytes: number; owner: string; encoding: string };
type PgRole = { name: string; superuser: boolean; createDb: boolean; canLogin: boolean };
type PgResponse = {
  clusters: Cluster[];
  online: boolean;
  reachable: boolean;
  error: string | null;
  databases: PgDatabase[];
  roles: PgRole[];
};

type Backup = { name: string; bytes: number; modified: string };
type QueryResult = { columns: string[]; rows: string[][]; rowCount: number; durationMs: number };

export default function Databases() {
  const [tab, setTab] = useState("mariadb");
  const [mysql, setMysql] = useState<MysqlResponse | null>(null);
  const [pg, setPg] = useState<PgResponse | null>(null);
  const [backups, setBackups] = useState<{ dir: string; backups: Backup[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);

  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();

  const load = async () => {
    try {
      const [mysqlResult, pgResult, backupResult] = await Promise.all([
        api.get<MysqlResponse>("/databases/mysql"),
        api.get<PgResponse>("/databases/postgres"),
        api.get<{ dir: string; backups: Backup[] }>("/databases/backups"),
      ]);
      setMysql(mysqlResult);
      setPg(pgResult);
      setBackups(backupResult);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    await run(async () => {
      await fn();
      await load();
    }, message);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading databases…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Databases</h1>
          <p className="text-xs text-slate-500">
            MariaDB and PostgreSQL administration · backups in {backups?.dir}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={load}>Refresh</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              const ok = await run(async () => {
                const result = await api.post<{ results: { engine: string; database: string; ok: boolean; error: string | null }[] }>(
                  "/databases/backup-all",
                );
                setOutput({
                  title: "Backup all databases",
                  text: result.results
                    .map((entry) => `${entry.ok ? "OK  " : "FAIL"} ${entry.engine}/${entry.database}${entry.error ? ` — ${entry.error}` : ""}`)
                    .join("\n"),
                });
                await load();
              }, "Backups finished");
              if (!ok) return;
            }}
          >
            Back up everything
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "mariadb", label: "MariaDB", badge: mysql?.databases.filter((d) => !d.system).length },
          { id: "postgres", label: "PostgreSQL", badge: pg?.databases.length },
          { id: "backups", label: "Backups & restore", badge: backups?.backups.length },
        ]}
      />

      {tab === "mariadb" && mysql && (
        <MariaDbPanel
          data={mysql}
          busy={busy}
          act={act}
          setError={setError}
          onOutput={setOutput}
        />
      )}

      {tab === "postgres" && pg && <PostgresPanel data={pg} busy={busy} act={act} onOutput={setOutput} />}

      {tab === "backups" && backups && (
        <BackupsPanel
          data={backups}
          busy={busy}
          act={act}
          onOutput={setOutput}
          mysqlDatabases={mysql?.databases.filter((d) => !d.system).map((d) => d.name) ?? []}
          pgDatabases={pg?.databases.map((d) => d.name) ?? []}
        />
      )}

      <Modal open={Boolean(output)} title={output?.title ?? ""} onClose={() => setOutput(null)} width="max-w-3xl">
        <pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--axon-input-bg)] p-3 text-[11px] text-slate-300">
          {output?.text || "No output"}
        </pre>
      </Modal>
    </div>
  );
}

function ResultTable({ result }: { result: QueryResult }) {
  if (result.columns.length === 0) {
    return <p className="text-xs text-emerald-300">Statement executed successfully in {result.durationMs} ms.</p>;
  }
  return (
    <div>
      <p className="mb-1.5 text-[11px] text-slate-500">
        {result.rowCount} row{result.rowCount === 1 ? "" : "s"} in {result.durationMs} ms
      </p>
      <div className="max-h-72 overflow-auto rounded-md border border-[var(--axon-border)]">
        <table className="w-full">
          <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
            <tr>
              {result.columns.map((column, index) => (
                <th key={`${column}-${index}`} className="th">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="td mono text-[11px]">
                    {cell === "" ? <span className="text-slate-600">NULL</span> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SqlConsole({
  databases,
  runQuery,
  defaultDatabase,
}: {
  databases: string[];
  runQuery: (database: string, sql: string) => Promise<QueryResult>;
  defaultDatabase?: string;
}) {
  const [database, setDatabase] = useState(defaultDatabase ?? databases[0] ?? "");
  const [sql, setSql] = useState("SELECT 1;");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!database && databases.length > 0) setDatabase(databases[0]);
  }, [databases, database]);

  const execute = async () => {
    setBusy(true);
    setQueryError(null);
    try {
      setResult(await runQuery(database, sql));
    } catch (caught) {
      setQueryError(errorMessage(caught));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
        <Field label="Database">
          <select className="field mono" value={database} onChange={(event) => setDatabase(event.target.value)}>
            {databases.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="SQL" hint="Ctrl/Cmd + Enter to run">
          <textarea
            className="field mono h-28 resize-y"
            spellCheck={false}
            value={sql}
            onChange={(event) => setSql(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                execute();
              }
            }}
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button variant="primary" loading={busy} onClick={execute} disabled={!database || !sql.trim()}>
          Run query
        </Button>
      </div>
      <ErrorBanner message={queryError} />
      {result && <ResultTable result={result} />}
    </div>
  );
}

function MariaDbPanel({
  data,
  busy,
  act,
  setError,
  onOutput,
}: {
  data: MysqlResponse;
  busy: boolean;
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  setError: (message: string | null) => void;
  onOutput: (value: { title: string; text: string }) => void;
}) {
  const [creatingDb, setCreatingDb] = useState(false);
  const [creatingUser, setCreatingUser] = useState(false);
  const [newDb, setNewDb] = useState("");
  const [newUser, setNewUser] = useState({ user: "", host: "localhost", password: "", database: "" });
  const [dropping, setDropping] = useState<MysqlDatabase | null>(null);
  const [droppingUser, setDroppingUser] = useState<MysqlUser | null>(null);
  const [grants, setGrants] = useState<{ title: string; grants: string[] } | null>(null);
  const [tablesFor, setTablesFor] = useState<{ engine: "mysql" | "postgres"; database: string } | null>(null);
  const [passwordFor, setPasswordFor] = useState<MysqlUser | null>(null);

  if (!data.reachable) {
    return (
      <Card title="MariaDB is not reachable">
        <p className="text-xs text-rose-300">{data.error}</p>
      </Card>
    );
  }

  const userDatabases = data.databases.filter((database) => !database.system);
  const systemDatabases = data.databases.filter((database) => database.system);

  return (
    <div className="space-y-4">
      <Card
        title="Databases"
        subtitle={`${userDatabases.length} user databases · ${formatBytes(userDatabases.reduce((sum, db) => sum + db.bytes, 0))} total`}
        actions={
          <Button variant="primary" onClick={() => { setCreatingDb(true); setError(null); }}>
            New database
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Size</th>
                <th className="th">Tables</th>
                <th className="th">Collation</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.databases.map((database) => (
                <tr key={database.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="td">
                    <span className="mono text-xs text-[var(--axon-text)]">{database.name}</span>
                    {database.system && <Badge tone="neutral">system</Badge>}
                  </td>
                <td className="td">{formatBytes(database.bytes)}</td>
                <td className="td">{database.tables}</td>
                <td className="td mono text-[11px] text-slate-500">{database.collation}</td>
                <td className="td">
                  <div className="flex justify-end gap-1.5">
                    <Button onClick={() => setTablesFor({ engine: "mysql", database: database.name })}>Tables</Button>
                    <Button
                      onClick={async () => {
                        await act(async () => {
                          const result = await api.post<{ file: string; bytes: number }>("/databases/mysql/backup", {
                            database: database.name,
                          });
                          onOutput({ title: `Backed up ${database.name}`, text: `Written to ${result.file} (${formatBytes(result.bytes)})` });
                        }, `${database.name} backed up`);
                      }}
                      disabled={busy}
                    >
                      Backup
                    </Button>
                    {!database.system && (
                      <Button variant="danger" onClick={() => setDropping(database)}>
                        Drop
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {data.databases.length === 0 && <EmptyState message="No databases" />}
      </Card>

      <Card
        title="Database users"
        subtitle={`${data.users.length} accounts`}
        actions={
          <Button variant="primary" onClick={() => { setCreatingUser(true); setError(null); }}>
            New user
          </Button>
        }
        bodyClassName="p-0"
      >
        <div className="max-h-72 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
              <tr>
                <th className="th">Account</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((user) => (
                <tr key={`${user.user}@${user.host}`} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="td mono text-xs text-slate-300">
                    {user.user}
                    <span className="text-slate-600">@{user.host}</span>
                  </td>
                  <td className="td">
                    <div className="flex justify-end gap-1.5">
                      <Button
                        onClick={async () => {
                          try {
                            const result = await api.get<{ grants: string[] }>(
                              `/databases/mysql/users/${encodeURIComponent(user.user)}/${encodeURIComponent(user.host)}/grants`,
                            );
                            setGrants({ title: `${user.user}@${user.host}`, grants: result.grants });
                          } catch (caught) {
                            setError(errorMessage(caught));
                          }
                        }}
                      >
                        Grants
                      </Button>
                      <Button variant="danger" onClick={() => setDroppingUser(user)}>
                        Drop
                      </Button>
                      <Button onClick={() => setPasswordFor(user)}>Password</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.users.length === 0 && <EmptyState message="No users" />}
      </Card>

      <Card title="SQL console" subtitle="Runs with root privileges on the selected database">
        <SqlConsole
          databases={data.databases.map((database) => database.name)}
          runQuery={(database, sql) => api.post<QueryResult>("/databases/mysql/query", { database, sql })}
        />
      </Card>

      <Modal open={creatingDb} title="Create MariaDB database" onClose={() => setCreatingDb(false)}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await (async () => {
              try {
                await api.post("/databases/mysql/databases", { name: newDb });
                return true;
              } catch (caught) {
                setError(errorMessage(caught));
                return false;
              }
            })();
            if (ok) {
              setNewDb("");
              setCreatingDb(false);
              await act(async () => {}, "Database created");
            }
          }}
          className="space-y-3"
        >
          <Field label="Database name" hint="Letters, numbers, underscore and $ only">
            <input className="field mono" value={newDb} onChange={(event) => setNewDb(event.target.value)} required autoFocus />
          </Field>
          <p className="text-[11px] text-slate-500">Created with utf8mb4 / utf8mb4_unicode_ci.</p>
          <footer className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCreatingDb(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!newDb.trim()}>
              Create
            </Button>
          </footer>
        </form>
      </Modal>

      <Modal open={creatingUser} title="Create MariaDB user" onClose={() => setCreatingUser(false)}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api.post("/databases/mysql/users", {
                user: newUser.user,
                host: newUser.host,
                password: newUser.password,
                grants: newUser.database ? [{ database: newUser.database, privileges: "ALL PRIVILEGES" }] : [],
              });
              setNewUser({ user: "", host: "localhost", password: "", database: "" });
              setCreatingUser(false);
              await act(async () => {}, "User created");
            } catch (caught) {
              setError(errorMessage(caught));
            }
          }}
          className="space-y-3"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Username">
              <input
                className="field mono"
                value={newUser.user}
                onChange={(event) => setNewUser({ ...newUser, user: event.target.value })}
                required
                autoFocus
              />
            </Field>
            <Field label="Host" hint="localhost restricts to this server">
              <input
                className="field mono"
                value={newUser.host}
                onChange={(event) => setNewUser({ ...newUser, host: event.target.value })}
                required
              />
            </Field>
          </div>
          <Field label="Password" hint="Minimum 8 characters">
            <input
              className="field"
              type="password"
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
              minLength={8}
              required
            />
          </Field>
          <Field label="Grant full access to database" hint="Leave blank to create the user with no privileges">
            <select
              className="field mono"
              value={newUser.database}
              onChange={(event) => setNewUser({ ...newUser, database: event.target.value })}
            >
              <option value="">— none —</option>
              {userDatabases.map((database) => (
                <option key={database.name} value={database.name}>
                  {database.name}
                </option>
              ))}
            </select>
          </Field>
          <footer className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCreatingUser(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!newUser.user.trim() || newUser.password.length < 8}>
              Create user
            </Button>
          </footer>
        </form>
      </Modal>

      <Modal open={Boolean(grants)} title={`Grants · ${grants?.title ?? ""}`} onClose={() => setGrants(null)}>
        <pre className="mono max-h-[50vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--axon-input-bg)] p-3 text-[11px] text-slate-300">
          {grants?.grants.join("\n\n") || "No grants"}
        </pre>
      </Modal>

      <ConfirmDialog
        open={Boolean(dropping)}
        title="Drop database"
        message={
          <>
            This permanently deletes <span className="mono text-amber-300">{dropping?.name}</span> and all of its data
            ({formatBytes(dropping?.bytes ?? 0)}). This cannot be undone. Back it up first if unsure.
          </>
        }
        requireText={dropping?.name}
        busy={busy}
        confirmLabel="Drop database"
        onCancel={() => setDropping(null)}
        onConfirm={async () => {
          const database = dropping;
          setDropping(null);
          if (!database) return;
          await act(
            () => api.del(`/databases/mysql/databases/${encodeURIComponent(database.name)}`, { confirm: database.name }),
            `${database.name} dropped`,
          );
        }}
      />

      <ConfirmDialog
        open={Boolean(droppingUser)}
        title="Drop user"
        message={
          <>
            Remove <span className="mono text-amber-300">{droppingUser?.user}@{droppingUser?.host}</span>? Applications using this
            account will lose access immediately.
          </>
        }
        requireText={droppingUser ? `${droppingUser.user}@${droppingUser.host}` : undefined}
        busy={busy}
        confirmLabel="Drop user"
        onCancel={() => setDroppingUser(null)}
        onConfirm={async () => {
          const user = droppingUser;
          setDroppingUser(null);
          if (!user) return;
          await act(
            () => api.del("/databases/mysql/users", { user: user.user, host: user.host, confirm: `${user.user}@${user.host}` }),
            "User dropped",
          );
        }}
      />

      <TablesModal target={tablesFor} onClose={() => setTablesFor(null)} />

      <PasswordModal
        open={Boolean(passwordFor)}
        label={passwordFor ? `${passwordFor.user}@${passwordFor.host}` : ""}
        busy={busy}
        onClose={() => setPasswordFor(null)}
        onSubmit={async (password) => {
          const user = passwordFor;
          if (!user) return;
          await act(
            () => api.post("/databases/mysql/users/password", { user: user.user, host: user.host, password }),
            "Password updated",
          );
          setPasswordFor(null);
        }}
      />
    </div>
  );
}

function PostgresPanel({
  data,
  busy,
  act,
  onOutput,
}: {
  data: PgResponse;
  busy: boolean;
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  onOutput: (value: { title: string; text: string }) => void;
}) {
  const [creatingDb, setCreatingDb] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);
  const [newDb, setNewDb] = useState({ name: "", owner: "" });
  const [newRole, setNewRole] = useState({ name: "", password: "", superuser: false, createDb: false });
  const [dropping, setDropping] = useState<PgDatabase | null>(null);
  const [droppingRole, setDroppingRole] = useState<PgRole | null>(null);
  const [tablesFor, setTablesFor] = useState<{ engine: "mysql" | "postgres"; database: string } | null>(null);
  const [passwordFor, setPasswordFor] = useState<PgRole | null>(null);

  return (
    <div className="space-y-4">
      <Card title="Clusters" subtitle="PostgreSQL server instances">
        {data.clusters.length === 0 ? (
          <EmptyState message="No PostgreSQL clusters found" />
        ) : (
          <ul className="space-y-3">
            {data.clusters.map((item) => (
              <li key={`${item.version}-${item.name}`} className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-slate-200">
                    <span className="mono">
                      {item.version}/{item.name}
                    </span>{" "}
                    <span className="text-slate-500">· port {item.port}</span>
                  </p>
                  <p className="mono text-[11px] text-slate-500">{item.dataDir}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={item.status === "online" ? "ok" : "bad"}>{item.status}</Badge>
                  {item.status === "online" ? (
                    <>
                      <Button
                        onClick={() =>
                          act(
                            () => api.post(`/databases/postgres/cluster/restart`, { version: item.version, name: item.name }),
                            "Cluster restarted",
                          )
                        }
                        disabled={busy}
                      >
                        Restart
                      </Button>
                      <Button
                        onClick={() =>
                          act(
                            () => api.post(`/databases/postgres/cluster/stop`, { version: item.version, name: item.name }),
                            "Cluster stopped",
                          )
                        }
                        disabled={busy}
                      >
                        Stop
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="primary"
                      onClick={() =>
                        act(
                          () => api.post(`/databases/postgres/cluster/start`, { version: item.version, name: item.name }),
                          "Cluster started",
                        )
                      }
                      disabled={busy}
                    >
                      Start
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {!data.reachable ? (
        <Card title="PostgreSQL is not reachable">
          <p className="text-xs text-amber-300">{data.error}</p>
        </Card>
      ) : (
        <>
          <Card
            title="Databases"
            subtitle={`${data.databases.length} databases`}
            actions={
              <Button variant="primary" onClick={() => setCreatingDb(true)}>
                New database
              </Button>
            }
            bodyClassName="p-0"
          >
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Size</th>
                    <th className="th">Owner</th>
                    <th className="th">Encoding</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.databases.map((database) => (
                    <tr key={database.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                      <td className="td mono text-xs text-[var(--axon-text)]">{database.name}</td>
                      <td className="td">{database.sizePretty}</td>
                      <td className="td mono text-[11px] text-[var(--axon-muted)]">{database.owner}</td>
                      <td className="td text-[11px] text-[var(--axon-muted)]">{database.encoding}</td>
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          <Button onClick={() => setTablesFor({ engine: "postgres", database: database.name })}>Tables</Button>
                          <Button
                            disabled={busy}
                            onClick={async () => {
                              await act(async () => {
                                const result = await api.post<{ file: string; bytes: number }>("/databases/postgres/backup", {
                                  database: database.name,
                                });
                                onOutput({
                                  title: `Backed up ${database.name}`,
                                  text: `Written to ${result.file} (${formatBytes(result.bytes)})`,
                                });
                              }, `${database.name} backed up`);
                            }}
                          >
                            Backup
                          </Button>
                          {!["postgres", "template0", "template1"].includes(database.name) && (
                            <Button variant="danger" onClick={() => setDropping(database)}>
                              Drop
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Roles"
            subtitle={`${data.roles.length} roles`}
            actions={
              <Button variant="primary" onClick={() => setCreatingRole(true)}>
                New role
              </Button>
            }
            bodyClassName="p-0"
          >
            <div className="max-h-72 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                  <tr>
                    <th className="th">Role</th>
                    <th className="th">Attributes</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.roles.map((role) => (
                    <tr key={role.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                      <td className="td mono text-xs text-slate-300">{role.name}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {role.superuser && <Badge tone="bad">superuser</Badge>}
                          {role.createDb && <Badge tone="warn">createdb</Badge>}
                          {!role.canLogin && <Badge tone="neutral">nologin</Badge>}
                        </div>
                      </td>
                      <td className="td">
                        <div className="flex justify-end gap-1.5">
                          <Button onClick={() => setPasswordFor(role)}>Password</Button>
                          {role.name !== "postgres" && (
                            <Button variant="danger" onClick={() => setDroppingRole(role)}>
                              Drop
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="SQL console" subtitle="Runs as the postgres superuser">
            <SqlConsole
              databases={data.databases.map((database) => database.name)}
              defaultDatabase={data.databases.find((database) => database.name !== "postgres")?.name}
              runQuery={(database, sql) => api.post<QueryResult>("/databases/postgres/query", { database, sql })}
            />
          </Card>
        </>
      )}

      <Modal open={creatingDb} title="Create PostgreSQL database" onClose={() => setCreatingDb(false)}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api.post("/databases/postgres/databases", { name: newDb.name, owner: newDb.owner || undefined });
              setNewDb({ name: "", owner: "" });
              setCreatingDb(false);
              await act(async () => {}, "Database created");
            } catch (caught) {
              onOutput({ title: "Create failed", text: errorMessage(caught) });
            }
          }}
          className="space-y-3"
        >
          <Field label="Database name">
            <input
              className="field mono"
              value={newDb.name}
              onChange={(event) => setNewDb({ ...newDb, name: event.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Owner" hint="Optional — defaults to the postgres superuser">
            <select className="field mono" value={newDb.owner} onChange={(event) => setNewDb({ ...newDb, owner: event.target.value })}>
              <option value="">— default —</option>
              {data.roles.map((role) => (
                <option key={role.name} value={role.name}>
                  {role.name}
                </option>
              ))}
            </select>
          </Field>
          <footer className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCreatingDb(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!newDb.name.trim()}>
              Create
            </Button>
          </footer>
        </form>
      </Modal>

      <Modal open={creatingRole} title="Create PostgreSQL role" onClose={() => setCreatingRole(false)}>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api.post("/databases/postgres/roles", {
                name: newRole.name,
                password: newRole.password || undefined,
                superuser: newRole.superuser,
                createDb: newRole.createDb,
                canLogin: true,
              });
              setNewRole({ name: "", password: "", superuser: false, createDb: false });
              setCreatingRole(false);
              await act(async () => {}, "Role created");
            } catch (caught) {
              onOutput({ title: "Create failed", text: errorMessage(caught) });
            }
          }}
          className="space-y-3"
        >
          <Field label="Role name">
            <input
              className="field mono"
              value={newRole.name}
              onChange={(event) => setNewRole({ ...newRole, name: event.target.value })}
              required
              autoFocus
            />
          </Field>
          <Field label="Password" hint="Optional but required to log in">
            <input
              className="field"
              type="password"
              value={newRole.password}
              onChange={(event) => setNewRole({ ...newRole, password: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={newRole.createDb}
              onChange={(event) => setNewRole({ ...newRole, createDb: event.target.checked })}
            />
            Allow this role to create databases
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={newRole.superuser}
              onChange={(event) => setNewRole({ ...newRole, superuser: event.target.checked })}
            />
            Grant superuser (full control of the cluster)
          </label>
          <footer className="flex justify-end gap-2">
            <Button type="button" onClick={() => setCreatingRole(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!newRole.name.trim()}>
              Create role
            </Button>
          </footer>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(dropping)}
        title="Drop database"
        message={
          <>
            Permanently delete <span className="mono text-amber-300">{dropping?.name}</span> ({dropping?.sizePretty})? This cannot be
            undone.
          </>
        }
        requireText={dropping?.name}
        busy={busy}
        confirmLabel="Drop database"
        onCancel={() => setDropping(null)}
        onConfirm={async () => {
          const database = dropping;
          setDropping(null);
          if (!database) return;
          await act(
            () => api.del(`/databases/postgres/databases/${encodeURIComponent(database.name)}`, { confirm: database.name }),
            `${database.name} dropped`,
          );
        }}
      />

      <ConfirmDialog
        open={Boolean(droppingRole)}
        title="Drop role"
        message={
          <>
            Remove the role <span className="mono text-amber-300">{droppingRole?.name}</span>? This fails if the role still owns
            objects.
          </>
        }
        requireText={droppingRole?.name}
        busy={busy}
        confirmLabel="Drop role"
        onCancel={() => setDroppingRole(null)}
        onConfirm={async () => {
          const role = droppingRole;
          setDroppingRole(null);
          if (!role) return;
          await act(
            () => api.del(`/databases/postgres/roles/${encodeURIComponent(role.name)}`, { confirm: role.name }),
            "Role dropped",
          );
        }}
      />

      <TablesModal target={tablesFor} onClose={() => setTablesFor(null)} />

      <PasswordModal
        open={Boolean(passwordFor)}
        label={passwordFor?.name ?? ""}
        busy={busy}
        onClose={() => setPasswordFor(null)}
        onSubmit={async (password) => {
          const role = passwordFor;
          if (!role) return;
          await act(
            () => api.post("/databases/postgres/roles/password", { name: role.name, password }),
            "Password updated",
          );
          setPasswordFor(null);
        }}
      />
    </div>
  );
}

function BackupsPanel({
  data,
  busy,
  act,
  onOutput,
  mysqlDatabases,
  pgDatabases,
}: {
  data: { dir: string; backups: Backup[] };
  busy: boolean;
  act: (fn: () => Promise<unknown>, message: string) => Promise<void>;
  onOutput: (value: { title: string; text: string }) => void;
  mysqlDatabases: string[];
  pgDatabases: string[];
}) {
  const [deleting, setDeleting] = useState<Backup | null>(null);
  const [restoring, setRestoring] = useState<{ engine: "mysql" | "postgres" } | null>(null);
  const [target, setTarget] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const restore = async (engine: "mysql" | "postgres", database: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    form.append("database", database);
    await act(() => api.postForm(`/databases/${engine}/restore`, form), "Restore finished");
    if (fileInput.current) fileInput.current.value = "";
    setRestoring(null);
  };

  return (
    <div className="space-y-4">
      <Card
        title="Backups"
        subtitle={`${data.backups.length} files in ${data.dir}`}
        bodyClassName="p-0"
      >
        {data.backups.length === 0 ? (
          <EmptyState message="No backups yet. Use the Backup buttons or 'Back up everything'." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">File</th>
                  <th className="th">Size</th>
                  <th className="th">Created</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.backups.map((backup) => (
                  <tr key={backup.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                    <td className="td mono text-[11px] text-[var(--axon-text)]">{backup.name}</td>
                    <td className="td">{formatBytes(backup.bytes)}</td>
                    <td className="td text-[11px] text-[var(--axon-muted)]">{relativeTime(backup.modified)}</td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <a className="btn btn-ghost" href={`/api/databases/backups/${encodeURIComponent(backup.name)}/download`}>
                          Download
                        </a>
                        <Button variant="danger" onClick={() => setDeleting(backup)} disabled={busy}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Restore from a SQL file" subtitle="Upload a dump and apply it to an existing database">
        <div className="flex flex-wrap items-end gap-2">
          <Button onClick={() => setRestoring({ engine: "mysql" })} disabled={mysqlDatabases.length === 0}>
            Restore into MariaDB
          </Button>
          <Button onClick={() => setRestoring({ engine: "postgres" })} disabled={pgDatabases.length === 0}>
            Restore into PostgreSQL
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Restores run with a long timeout. The target database must already exist.
        </p>
      </Card>

      <Modal
        open={Boolean(restoring)}
        title={restoring?.engine === "mysql" ? "Restore MariaDB dump" : "Restore PostgreSQL dump"}
        onClose={() => setRestoring(null)}
      >
        <div className="space-y-3">
          <Field label="Target database">
            <select className="field mono" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">— select —</option>
              {(restoring?.engine === "mysql" ? mysqlDatabases : pgDatabases).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="SQL file">
            <input ref={fileInput} className="field" type="file" accept=".sql,.txt" />
          </Field>
          <footer className="flex justify-end gap-2">
            <Button onClick={() => setRestoring(null)}>Cancel</Button>
            <Button
              variant="primary"
              loading={busy}
              disabled={!target}
              onClick={async () => {
                const file = fileInput.current?.files?.[0];
                if (!file || !restoring) {
                  onOutput({ title: "Restore", text: "Choose a .sql file first." });
                  return;
                }
                await restore(restoring.engine, target, file);
                setTarget("");
              }}
            >
              Restore
            </Button>
          </footer>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete backup"
        message={
          <>
            Delete <span className="mono text-amber-300">{deleting?.name}</span> permanently?
          </>
        }
        requireText={deleting?.name}
        busy={busy}
        confirmLabel="Delete file"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const backup = deleting;
          setDeleting(null);
          if (!backup) return;
          await act(
            () => api.del(`/databases/backups/${encodeURIComponent(backup.name)}`, { confirm: backup.name }),
            "Backup deleted",
          );
        }}
      />
    </div>
  );
}
