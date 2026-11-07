import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatBytes, formatDuration } from "../lib/format";
import { Badge, Button, Card, Spinner, Tabs, useToast } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

type Metrics = {
  hostname: string;
  cpu: { percent: number; cores: number };
  memory: { percent: number; used: number; total: number };
  load: { one: number; five: number; fifteen: number };
  uptimeSeconds: number;
  disks: { mount: string; percent: number; used: number; size: number }[];
};

type SystemOverview = {
  hostname?: string;
  kernel?: string;
  os?: string;
  arch?: string;
  cpuModel?: string;
  cores?: number;
};

type ServiceUnit = {
  name: string;
  description: string;
  loadState: string;
  activeState: string;
  subState: string;
};

export default function SystemHealth({ defaultTab = "overview" }: { defaultTab?: "overview" | "metrics" | "services" }) {
  const [tab, setTab] = useState(defaultTab);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [overview, setOverview] = useState<SystemOverview | null>(null);
  const [services, setServices] = useState<ServiceUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadData = async () => {
    try {
      const [mRes, oRes, sRes] = await Promise.all([
        api.get<Metrics>("/system/metrics"),
        api.get<SystemOverview>("/system/overview").catch(() => ({})),
        api.get<{ units?: ServiceUnit[]; services?: ServiceUnit[] }>("/services").catch(() => ({ units: [] })),
      ]);
      setMetrics(mRes);
      setOverview(oRes);
      setServices(sRes.units || sRes.services || []);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const timer = setInterval(loadData, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: tab === "services" ? "Service Status" : tab === "metrics" ? "Resource Monitoring" : "System Health & Server Overview" }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)]">
            {tab === "services" ? "System Service Status" : tab === "metrics" ? "Resource Monitoring & Telemetry" : "Server Infrastructure Overview"}
          </h1>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Real-time host metrics, memory breakdown, disk volumes, and systemd service daemons.
          </p>
        </div>
        <Button variant="ghost" onClick={loadData}>
          Refresh
        </Button>
      </div>

      <Tabs
        active={tab}
        onChange={(t) => setTab(t as any)}
        tabs={[
          { id: "overview", label: "Server Overview" },
          { id: "metrics", label: "Resource Telemetry" },
          { id: "services", label: `Services (${services.length})` },
        ]}
      />

      {loading && !metrics ? (
        <div className="flex items-center justify-center p-12 text-sm text-[var(--axon-muted)]">
          <Spinner /> Loading system telemetry…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Hardware & OS Overview */}
          {(tab === "overview" || tab === "metrics") && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                <p className="text-xs text-[var(--axon-muted)]">CPU Usage</p>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-bold text-[var(--axon-text)]">{metrics?.cpu.percent}%</span>
                  <span className="text-xs text-[var(--axon-muted)]">{metrics?.cpu.cores} Cores</span>
                </div>
                <div className="mt-2.5 h-1.5 w-full bg-[var(--axon-input-bg)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      (metrics?.cpu.percent || 0) > 85 ? "bg-rose-500" : "bg-[var(--axon-primary)]"
                    }`}
                    style={{ width: `${metrics?.cpu.percent || 0}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                <p className="text-xs text-[var(--axon-muted)]">Memory Allocation</p>
                <div className="flex items-baseline justify-between mt-2">
                  <span className="text-2xl font-bold text-[var(--axon-text)]">{metrics?.memory.percent}%</span>
                  <span className="text-xs text-[var(--axon-muted)]">
                    {formatBytes(metrics?.memory.used || 0, 1)} / {formatBytes(metrics?.memory.total || 0, 1)}
                  </span>
                </div>
                <div className="mt-2.5 h-1.5 w-full bg-[var(--axon-input-bg)] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      (metrics?.memory.percent || 0) > 90 ? "bg-rose-500" : "bg-[var(--axon-primary)]"
                    }`}
                    style={{ width: `${metrics?.memory.percent || 0}%` }}
                  />
                </div>
              </div>

              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                <p className="text-xs text-[var(--axon-muted)]">System Load Averages</p>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="text-lg font-bold font-mono text-[var(--axon-text)]">{metrics?.load.one.toFixed(2)}</span>
                  <span className="text-xs text-[var(--axon-muted)]">1m</span>
                  <span className="text-lg font-bold font-mono text-[var(--axon-text)] ml-2">{metrics?.load.five.toFixed(2)}</span>
                  <span className="text-xs text-[var(--axon-muted)]">5m</span>
                  <span className="text-lg font-bold font-mono text-[var(--axon-text)] ml-2">{metrics?.load.fifteen.toFixed(2)}</span>
                  <span className="text-xs text-[var(--axon-muted)]">15m</span>
                </div>
                <p className="text-[11px] text-[var(--axon-muted)] mt-2">Optimal range: &lt; {metrics?.cpu.cores}.00</p>
              </div>

              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                <p className="text-xs text-[var(--axon-muted)]">Host Uptime</p>
                <p className="text-xl font-bold text-[var(--axon-text)] mt-2">
                  {formatDuration(metrics?.uptimeSeconds || 0)}
                </p>
                <p className="text-[11px] font-mono text-[var(--axon-muted)] mt-2 truncate">
                  Kernel: {overview?.kernel || "6.8.0-x86_64"}
                </p>
              </div>
            </div>
          )}

          {/* Storage Mounts Table */}
          {(tab === "overview" || tab === "metrics") && (
            <Card title="Disk Partitions & Mounts">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                      <th className="px-4 py-2.5">Mount Point</th>
                      <th className="px-4 py-2.5">Usage</th>
                      <th className="px-4 py-2.5">Used Space</th>
                      <th className="px-4 py-2.5">Total Size</th>
                      <th className="px-4 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--axon-border)]">
                    {metrics?.disks.map((d, i) => (
                      <tr key={i} className="hover:bg-[var(--axon-card-hover)] transition">
                        <td className="px-4 py-2.5 font-mono text-[var(--axon-text)] font-semibold">{d.mount}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-[var(--axon-input-bg)] rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-1.5 rounded-full ${d.percent > 85 ? "bg-rose-500" : "bg-[var(--axon-primary)]"}`}
                                style={{ width: `${d.percent}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-[var(--axon-muted)]">{d.percent}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">{formatBytes(d.used, 1)}</td>
                        <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">{formatBytes(d.size, 1)}</td>
                        <td className="px-4 py-2.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${d.percent > 88 ? "bg-rose-500/15 text-rose-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                            {d.percent > 88 ? "Low Space" : "Healthy"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* System Services Grid */}
          {(tab === "overview" || tab === "services") && (
            <Card title="Critical System Daemons">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                      <th className="px-4 py-2.5">Daemon Name</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5">State</th>
                      <th className="px-4 py-2.5">Sub-State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--axon-border)]">
                    {services.slice(0, 25).map((s, idx) => (
                      <tr key={idx} className="hover:bg-[var(--axon-card-hover)] transition">
                        <td className="px-4 py-2.5 font-mono font-medium text-[var(--axon-text)]">{s.name}</td>
                        <td className="px-4 py-2.5 text-[var(--axon-muted)] truncate max-w-xs">{s.description || "—"}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              s.activeState === "active"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            }`}
                          >
                            {s.activeState}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">{s.subState}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
