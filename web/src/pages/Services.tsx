import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatBytes, formatUptime, statusTone } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Modal,
  Spinner,
  Tabs,
  useAsyncAction,
  useToast,
} from "../components/ui";

type Unit = {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
  enabled: string;
  protected: boolean;
};

type Pm2App = {
  name: string;
  status: string;
  cpu: number;
  memory: number;
  restarts: number;
  uptimeMs: number | null;
  script: string | null;
  cwd: string | null;
  instances: number;
};

type RedisInfo = {
  ok: boolean;
  error?: string;
  version?: string;
  uptimeSeconds?: number;
  connectedClients?: number;
  usedMemory?: number;
  totalCommands?: number;
  keyspace?: Record<string, string>;
};

export default function Services({ defaultTab = "systemd" }: { defaultTab?: "systemd" | "pm2" | "redis" }) {
  const [tab, setTab] = useState(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setTab(defaultTab);
    }
  }, [defaultTab]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [apps, setApps] = useState<Pm2App[]>([]);
  const [redis, setRedis] = useState<RedisInfo | null>(null);
  const [pm2Error, setPm2Error] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [logs, setLogs] = useState<{ title: string; lines: string[] } | null>(null);
  const [pending, setPending] = useState<{ kind: "unit" | "pm2"; name: string; action: string; message: string } | null>(null);

  const { busy, error, run } = useAsyncAction();
  const toast = useToast();

  const loadAll = async () => {
    try {
      const [unitResult, pm2Result, redisResult] = await Promise.all([
        api.get<{ units: Unit[] }>("/services"),
        api.get<{ ok: boolean; apps: Pm2App[]; error?: string }>("/services/pm2"),
        api.get<RedisInfo>("/services/redis"),
      ]);
      setUnits(unitResult.units);
      setApps(pm2Result.apps ?? []);
      setPm2Error(pm2Result.ok ? null : pm2Result.error ?? "PM2 unavailable");
      setRedis(redisResult);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    const timer = setInterval(loadAll, 10000);
    return () => clearInterval(timer);
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return units.filter((unit) => {
      if (onlyFailed && unit.active === "active") return false;
      if (!needle) return true;
      return (
        unit.unit.toLowerCase().includes(needle) ||
        unit.description.toLowerCase().includes(needle)
      );
    });
  }, [units, search, onlyFailed]);

  const controlUnit = async (unit: string, action: string) => {
    await run(async () => {
      await api.post(`/services/units/${encodeURIComponent(unit)}/${action}`);
      await loadAll();
    }, `${action} ${unit} requested`);
  };

  const controlPm2 = async (name: string, action: string, confirm?: string) => {
    await run(async () => {
      await api.post(`/services/pm2/${encodeURIComponent(name)}/${action}`, confirm ? { confirm } : undefined);
      await loadAll();
    }, `pm2 ${action} ${name} requested`);
  };

  const openLogs = async (unit: string) => {
    try {
      const result = await api.get<{ lines: string[]; error: string | null }>(
        `/services/units/${encodeURIComponent(unit)}/logs?lines=300`,
      );
      setLogs({ title: unit, lines: result.lines.filter((line) => line !== "") });
    } catch (caught) {
      toast("error", errorMessage(caught));
    }
  };

  const openPm2Logs = async (name: string) => {
    try {
      const result = await api.get<{ lines: string[] }>(`/services/pm2/${encodeURIComponent(name)}/logs?lines=300`);
      setLogs({ title: `pm2: ${name}`, lines: result.lines.filter((line) => line !== "") });
    } catch (caught) {
      toast("error", errorMessage(caught));
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const { kind, name, action } = pending;
    setPending(null);
    if (kind === "unit") await controlUnit(name, action);
    else await controlPm2(name, action, action === "delete" ? name : undefined);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading services…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Services &amp; Processes</h1>
          <p className="text-xs text-slate-500">
            {units.length} systemd units · {apps.length} PM2 processes
          </p>
        </div>
        <Button onClick={loadAll}>Refresh</Button>
      </div>

      <ErrorBanner message={error} />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "systemd", label: "Systemd", badge: units.length },
          { id: "pm2", label: "PM2", badge: apps.length },
          { id: "redis", label: "Redis" },
        ]}
      />

      {tab === "systemd" && (
        <Card
          title="Systemd units"
          subtitle="Protected units cannot be stopped from the panel"
          actions={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <input type="checkbox" checked={onlyFailed} onChange={(event) => setOnlyFailed(event.target.checked)} />
                Not running only
              </label>
              <input
                className="field w-52"
                placeholder="Filter units…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          }
          bodyClassName="p-0"
        >
          <div className="max-h-[62vh] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                <tr>
                  <th className="th">Unit</th>
                  <th className="th">State</th>
                  <th className="th">Boot</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((unit) => (
                  <tr key={unit.unit} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="mono text-xs text-slate-200">{unit.unit}</span>
                        {unit.protected && <Badge tone="neutral">locked</Badge>}
                      </div>
                      <p className="truncate text-[11px] text-slate-500">{unit.description}</p>
                    </td>
                    <td className="td">
                      <Badge tone={statusTone(unit.active)}>{unit.active}</Badge>
                      <p className="mt-1 text-[10px] text-slate-500">{unit.sub}</p>
                    </td>
                    <td className="td text-[11px] text-slate-400">{unit.enabled}</td>
                    <td className="td">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button onClick={() => openLogs(unit.unit)}>Logs</Button>
                        {!unit.protected && (
                          <>
                            {unit.active === "active" ? (
                              <>
                                <Button onClick={() => controlUnit(unit.unit, "restart")}>Restart</Button>
                                <Button
                                  onClick={() =>
                                    setPending({
                                      kind: "unit",
                                      name: unit.unit,
                                      action: "stop",
                                      message: `Stop ${unit.unit}? Anything it serves will become unavailable.`,
                                    })
                                  }
                                >
                                  Stop
                                </Button>
                              </>
                            ) : (
                              <Button variant="primary" onClick={() => controlUnit(unit.unit, "start")}>
                                Start
                              </Button>
                            )}
                            <Button onClick={() => controlUnit(unit.unit, unit.enabled === "enabled" ? "disable" : "enable")}>
                              {unit.enabled === "enabled" ? "Disable" : "Enable"}
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <EmptyState message="No units match that filter" />}
          </div>
        </Card>
      )}

      {tab === "pm2" && (
        <Card title="PM2 processes" subtitle={pm2Error ?? "Node.js processes managed by PM2"} bodyClassName="p-0">
          {apps.length === 0 ? (
            <div className="p-4"><EmptyState message={pm2Error ?? "No PM2 processes"} /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Name</th>
                    <th className="th">Status</th>
                    <th className="th">CPU</th>
                    <th className="th">Memory</th>
                    <th className="th">Restarts</th>
                    <th className="th">Uptime</th>
                    <th className="th text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {apps.map((app) => (
                    <tr key={app.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                      <td className="td">
                        <span className="mono text-xs text-[var(--axon-text)]">{app.name}</span>
                        <p className="mono truncate text-[10px] text-[var(--axon-muted)]">{app.cwd}</p>
                      </td>
                      <td className="td">
                        <Badge tone={statusTone(app.status)}>{app.status}</Badge>
                      </td>
                      <td className="td">{app.cpu}%</td>
                      <td className="td">{formatBytes(app.memory)}</td>
                      <td className="td">{app.restarts}</td>
                      <td className="td">{formatUptime(app.uptimeMs)}</td>
                      <td className="td">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button onClick={() => openPm2Logs(app.name)}>Logs</Button>
                          <Button onClick={() => controlPm2(app.name, "restart")}>Restart</Button>
                          {app.status === "online" ? (
                            <Button
                              onClick={() =>
                                setPending({
                                  kind: "pm2",
                                  name: app.name,
                                  action: "stop",
                                  message: `Stop the PM2 process ${app.name}?`,
                                })
                              }
                            >
                              Stop
                            </Button>
                          ) : (
                            <Button variant="primary" onClick={() => controlPm2(app.name, "start")}>
                              Start
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            onClick={() =>
                              setPending({
                                kind: "pm2",
                                name: app.name,
                                action: "delete",
                                message: `Remove ${app.name} from PM2? The application files are not deleted, but the process stops running.`,
                              })
                            }
                          >
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
      )}

      {tab === "redis" && (
        <Card title="Redis" subtitle={redis?.ok ? `version ${redis.version}` : redis?.error ?? "Unavailable"}>
          {!redis?.ok ? (
            <EmptyState message={redis?.error ?? "Redis is not responding"} />
          ) : (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-[11px] uppercase text-slate-500">Memory used</dt>
                <dd className="mt-1 text-lg text-slate-100">{formatBytes(redis.usedMemory ?? 0)}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-slate-500">Clients</dt>
                <dd className="mt-1 text-lg text-slate-100">{redis.connectedClients}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-slate-500">Commands</dt>
                <dd className="mt-1 text-lg text-slate-100">{redis.totalCommands?.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase text-slate-500">Uptime</dt>
                <dd className="mt-1 text-lg text-slate-100">{formatUptime(Date.now() - (redis.uptimeSeconds ?? 0) * 1000)}</dd>
              </div>
            </dl>
          )}
        </Card>
      )}

      <Modal open={Boolean(logs)} title={`Logs · ${logs?.title ?? ""}`} onClose={() => setLogs(null)} width="max-w-4xl">
        <pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--axon-input-bg)] p-3 text-[11px] leading-relaxed text-slate-300">
          {logs?.lines.join("\n") || "No log output"}
        </pre>
      </Modal>

      <ConfirmDialog
        open={Boolean(pending)}
        title="Confirm action"
        message={pending?.message ?? ""}
        confirmLabel={pending?.action === "delete" ? "Delete" : "Confirm"}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={confirmPending}
      />
    </div>
  );
}
