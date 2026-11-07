import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatBytes, formatDuration, formatUptime, statusTone } from "../lib/format";
import { Badge, Card, EmptyState, ErrorBanner, ProgressBar, Spinner } from "../components/ui";
import { useApp } from "../lib/app-context";

type Overview = {
  metrics: {
    hostname: string;
    cpu: { percent: number; cores: number };
    memory: { percent: number; used: number; total: number; swapUsed: number; swapTotal: number; swapPercent: number };
    load: { one: number; five: number; fifteen: number };
    uptimeSeconds: number;
    disks: { mount: string; percent: number; used: number; size: number }[];
  };
  services: { unit: string; active: string; enabled: string }[];
  pm2: { name: string; status: string; cpu: number; memory: number; restarts: number; uptimeMs: number | null }[];
  pm2Error: string | null;
  certificates: { total: number; expiring: { name: string; daysRemaining: number }[]; error: string | null };
  databases: {
    mariadb: { reachable: boolean; count: number };
    postgres: { clusters: { version: string; name: string; port: number; status: string }[]; online: number; total: number };
  };
  backups: string;
};

type SecuritySummary = {
  firewall: { active: boolean; rulesCount: number; defaultIncoming: string };
  fail2ban: { active: boolean; jailsCount: number; currentlyBanned: number };
  ssh: { port: number; permitRootLogin: string; passwordAuthentication: string };
  panel: { totpEnabled: boolean; ipAllowlistCount: number };
  score: { grade: string; passed: number; total: number; warnings: string[] };
};

type SiteItem = {
  name: string;
  enabled: boolean;
  ssl: boolean;
  kind?: string;
  phpVersion?: string | null;
  serverNames: string[];
  roots: string[];
  proxies: string[];
};

type QuotaInfo = {
  orgName: string;
  planName: string;
  websites: { used: number; max: number; remaining: number };
  databases: { used: number; max: number; remaining: number };
  storageMb: { used: number; max: number; remaining: number };
};

export default function Dashboard() {
  const { user } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [security, setSecurity] = useState<SecuritySummary | null>(null);
  const [sites, setSites] = useState<SiteItem[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [overview, sec, sitesRes, quotaRes] = await Promise.all([
          api.get<Overview>("/system/overview").catch(() => null),
          api.get<SecuritySummary>("/security/overview").catch(() => null),
          api.get<{ sites: SiteItem[] }>("/sites").catch(() => ({ sites: [] })),
          api.get<{ usage: QuotaInfo }>("/users/quota").catch(() => null),
        ]);
        if (!cancelled) {
          if (overview) setData(overview);
          if (sec) setSecurity(sec);
          if (sitesRes?.sites) setSites(sitesRes.sites);
          if (quotaRes?.usage) setQuota(quotaRes.usage);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };

    load();
    const timer = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!data && !quota && sites.length === 0) {
    return (
      <div className="flex items-center gap-3 text-sm text-[var(--axon-muted)]">
        {error ? <ErrorBanner message={error} /> : <><Spinner /> Loading Axon Panel dashboard…</>}
      </div>
    );
  }

  const metrics = data?.metrics;
  const rootDisk = metrics?.disks?.find((disk) => disk.mount === "/");
  const failed = data?.services?.filter((service) => service.active !== "active" && service.active !== "unknown") || [];
  const activeSites = sites.filter((s) => s.name !== "default");

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      {/* Hero Header */}
      {metrics ? (
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold tracking-tight text-[var(--axon-text)]">{metrics.hostname}</h1>
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Online
                </span>
                {failed.length > 0 && (
                  <Badge tone="bad">{failed.length} service issue{failed.length === 1 ? "" : "s"}</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--axon-muted)]">
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--axon-muted)]">IP:</span>
                  <span className="mono font-semibold text-[var(--axon-text)]">{(metrics as any)?.ip || (typeof window !== "undefined" ? window.location.hostname : "localhost")}</span>
                </span>
                <span>·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--axon-muted)]">OS:</span>
                  <span className="text-[var(--axon-text)]">Ubuntu 24.04 LTS (x86_64)</span>
                </span>
                <span>·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--axon-muted)]">Cores:</span>
                  <span className="text-[var(--axon-text)]">{metrics.cpu.cores} vCPUs</span>
                </span>
                <span>·</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--axon-muted)]">Uptime:</span>
                  <span className="text-[var(--axon-text)]">{formatDuration(metrics.uptimeSeconds)}</span>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/sites"
                className="flex items-center gap-1.5 rounded-lg bg-[var(--axon-primary)] px-3.5 py-2 text-xs font-semibold text-[var(--axon-primary-fg)] shadow-sm shadow-blue-500/20 transition hover:bg-[var(--axon-primary-hover)]"
              >
                <span>+</span>
                <span>Add Website</span>
              </Link>
              <Link
                to="/security"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] px-3.5 py-2 text-xs font-medium text-[var(--axon-text)] transition hover:bg-[var(--axon-card-hover)]"
              >
                <span>Security Center</span>
              </Link>
              <Link
                to="/terminal"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] px-3.5 py-2 text-xs font-medium text-[var(--axon-text)] transition hover:bg-[var(--axon-card-hover)]"
              >
                <span>Terminal</span>
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-bold tracking-tight text-[var(--axon-text)]">
                Welcome back, @{user?.username}!
              </h1>
              <p className="text-xs text-[var(--axon-muted)]">
                {quota ? `${quota.orgName} • ${quota.planName} Plan` : "Manage your websites, applications, and databases."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/sites"
                className="flex items-center gap-1.5 rounded-lg bg-[var(--axon-primary)] px-3.5 py-2 text-xs font-semibold text-[var(--axon-primary-fg)] shadow-sm shadow-blue-500/20 transition hover:bg-[var(--axon-primary-hover)]"
              >
                <span>+</span>
                <span>Add Website</span>
              </Link>
              <Link
                to="/files"
                className="flex items-center gap-1.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] px-3.5 py-2 text-xs font-medium text-[var(--axon-text)] transition hover:bg-[var(--axon-card-hover)]"
              >
                <span>File Manager</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Organization Quotas Widget (Multi-Tenancy) */}
      {quota && (
        <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[var(--axon-border)] gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--axon-primary)]">Workspace Resource Quotas</p>
              <h2 className="text-sm font-bold text-[var(--axon-text)]">{quota.orgName} • {quota.planName} Plan</h2>
            </div>
            <Link to="/sites" className="text-xs text-[var(--axon-primary)] hover:underline font-semibold">
              Manage Websites →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-3 text-xs">
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[var(--axon-muted)]">Websites Provisioned</span>
                <span className="font-mono font-bold text-[var(--axon-text)]">
                  {quota.websites.used} / {quota.websites.max >= 999 ? "∞" : quota.websites.max}
                </span>
              </div>
              <ProgressBar
                percent={quota.websites.max >= 999 ? 5 : Math.min(100, Math.round((quota.websites.used / quota.websites.max) * 100))}
                tone={quota.websites.used >= quota.websites.max ? "bad" : "good"}
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[var(--axon-muted)]">Databases Created</span>
                <span className="font-mono font-bold text-[var(--axon-text)]">
                  {quota.databases.used} / {quota.databases.max >= 999 ? "∞" : quota.databases.max}
                </span>
              </div>
              <ProgressBar
                percent={quota.databases.max >= 999 ? 5 : Math.min(100, Math.round((quota.databases.used / quota.databases.max) * 100))}
                tone={quota.databases.used >= quota.databases.max ? "bad" : "good"}
              />
            </div>
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[var(--axon-muted)]">Storage Limit</span>
                <span className="font-mono font-bold text-[var(--axon-text)]">
                  {quota.storageMb.max >= 99999 ? "Unlimited" : formatBytes(quota.storageMb.max * 1024 * 1024, 0)}
                </span>
              </div>
              <ProgressBar
                percent={quota.storageMb.max >= 99999 ? 5 : Math.min(100, Math.round((quota.storageMb.used / quota.storageMb.max) * 100))}
                tone="good"
              />
            </div>
          </div>
        </Card>
      )}

      {/* Resource Metrics Cards (Only visible if role has server metrics permission) */}
      {metrics && (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
          {/* CPU Usage Card */}
          <div className="card p-4 transition hover:border-[var(--axon-primary)]/50">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">CPU Utilization</p>
              <span className="rounded bg-[var(--axon-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)]">
                {metrics.cpu.cores} Cores
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="text-2xl font-bold tracking-tight text-[var(--axon-text)]">{metrics.cpu.percent}%</p>
              <span className="text-[11px] text-[var(--axon-muted)] font-mono">
                load {metrics.load.one.toFixed(2)}
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar
                percent={metrics.cpu.percent}
                tone={metrics.cpu.percent > 85 ? "bad" : metrics.cpu.percent > 65 ? "warn" : "ok"}
              />
            </div>
            <p className="mt-2 text-[10px] text-[var(--axon-muted)]">
              5m: {metrics.load.five.toFixed(2)} · 15m: {metrics.load.fifteen.toFixed(2)}
            </p>
          </div>

          {/* Memory Usage Card */}
          <div className="card p-4 transition hover:border-[var(--axon-primary)]/50">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Memory (RAM)</p>
              <span className="rounded bg-[var(--axon-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)]">
                {formatBytes(metrics.memory.total)}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="text-2xl font-bold tracking-tight text-[var(--axon-text)]">{metrics.memory.percent}%</p>
              <span className="text-[11px] text-[var(--axon-muted)]">
                {formatBytes(metrics.memory.used)} used
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar
                percent={metrics.memory.percent}
                tone={metrics.memory.percent > 90 ? "bad" : metrics.memory.percent > 75 ? "warn" : "ok"}
              />
            </div>
            <p className="mt-2 text-[10px] text-[var(--axon-muted)]">
              Swap: {metrics.memory.swapPercent}% ({formatBytes(metrics.memory.swapUsed)} / {formatBytes(metrics.memory.swapTotal)})
            </p>
          </div>

          {/* Disk Space Card */}
          <div className="card p-4 transition hover:border-[var(--axon-primary)]/50">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Disk Storage</p>
              <span className="rounded bg-[var(--axon-primary)]/15 px-2 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)]">
                Mount /
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="text-2xl font-bold tracking-tight text-[var(--axon-text)]">{rootDisk ? `${rootDisk.percent}%` : "—"}</p>
              <span className="text-[11px] text-[var(--axon-muted)]">
                {rootDisk ? `${formatBytes(rootDisk.used)} / ${formatBytes(rootDisk.size)}` : "—"}
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar
                percent={rootDisk?.percent ?? 0}
                tone={rootDisk && rootDisk.percent > 88 ? "bad" : rootDisk && rootDisk.percent > 70 ? "warn" : "ok"}
              />
            </div>
            <p className="mt-2 text-[10px] text-[var(--axon-muted)]">
              Free space: {rootDisk ? formatBytes(rootDisk.size - rootDisk.used) : "—"}
            </p>
          </div>

          {/* Services & PM2 Health Card */}
          <div className="card p-4 transition hover:border-[var(--axon-primary)]/50">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">System Services</p>
              <Badge tone={failed.length === 0 ? "ok" : "bad"}>
                {failed.length === 0 ? "All Online" : `${failed.length} Degraded`}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <p className="text-2xl font-bold tracking-tight text-[var(--axon-text)]">
                {data?.services ? data.services.filter((s) => s.active === "active").length : 0}/{data?.services?.length || 0}
              </p>
              <span className="text-[11px] text-[var(--axon-muted)]">
                {data?.pm2?.length || 0} PM2 App{(data?.pm2?.length || 0) === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3">
              <ProgressBar
                percent={Math.round(
                  ((data?.services?.filter((s) => s.active === "active").length || 0) / Math.max(1, data?.services?.length || 1)) * 100
                )}
                tone={failed.length === 0 ? "ok" : "warn"}
              />
            </div>
            <p className="mt-2 text-[10px] text-[var(--axon-muted)]">
              Nginx, MariaDB, Redis, PHP-FPM, Fail2ban
            </p>
          </div>
        </div>
      )}

      {/* Hosted Websites */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>Websites</span>
            <span className="rounded-full bg-[var(--axon-primary)]/20 px-2 py-0.5 text-[11px] font-semibold text-[var(--axon-primary)]">
              {activeSites.length}
            </span>
          </div>
        }
        subtitle="Active websites and applications managed by Nginx"
        actions={
          <div className="flex items-center gap-2">
            <Link
              to="/sites"
              className="text-xs font-semibold text-[var(--axon-primary)] hover:opacity-80"
            >
              Manage All Sites →
            </Link>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] text-[11px] uppercase tracking-wider text-[var(--axon-muted)]">
                <th className="th">Domain Name</th>
                <th className="th">Site Type</th>
                <th className="th">PHP / Runtime</th>
                <th className="th">SSL Status</th>
                <th className="th">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {activeSites.map((site) => {
                const primaryDomain = site.serverNames[0] || site.name;
                const isHttps = site.ssl;
                const siteUrl = `${isHttps ? "https" : "http"}://${primaryDomain}`;
                const siteType = site.kind === "php" ? "PHP / Laravel" : site.kind === "proxy" ? "Node.js Reverse Proxy" : "Static Web";

                return (
                  <tr key={site.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                    <td className="td">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--axon-primary)]/10 text-[var(--axon-primary)] border border-[var(--axon-primary)]/20">
                          🌐
                        </div>
                        <div>
                          <Link
                            to="/sites"
                            className="font-semibold text-[var(--axon-text)] hover:text-[var(--axon-primary)] text-xs"
                          >
                            {primaryDomain}
                          </Link>
                          {site.roots[0] && (
                            <p className="mono text-[10px] text-[var(--axon-muted)] truncate max-w-xs">{site.roots[0]}</p>
                          )}
                          {site.proxies[0] && (
                            <p className="mono text-[10px] text-[var(--axon-muted)] truncate max-w-xs">proxy → {site.proxies[0]}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    <td className="td">
                      <span className="rounded bg-[var(--axon-card)] px-2 py-0.5 text-[11px] text-[var(--axon-text)] border border-[var(--axon-border)]">
                        {siteType}
                      </span>
                    </td>

                    <td className="td mono text-[11px] text-[var(--axon-muted)]">
                      {site.phpVersion ? `PHP ${site.phpVersion}` : site.kind === "proxy" ? "Node.js :9090" : "Static"}
                    </td>

                    <td className="td">
                      <div className="flex items-center gap-1.5">
                        {site.ssl ? (
                          <Badge tone="ok">🔒 Let's Encrypt</Badge>
                        ) : (
                          <Badge tone="warn">No SSL</Badge>
                        )}
                      </div>
                    </td>

                    <td className="td">
                      <Badge tone={site.enabled ? "ok" : "neutral"}>
                        {site.enabled ? "Active" : "Disabled"}
                      </Badge>
                    </td>

                    <td className="td text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          to="/sites"
                          className="rounded border border-[var(--axon-border)] bg-[var(--axon-card)] px-2.5 py-1 text-[11px] font-medium text-[var(--axon-text)] hover:bg-[var(--axon-card-hover)]"
                        >
                          Manage
                        </Link>
                        <a
                          href={siteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-[var(--axon-border)] bg-[var(--axon-card)] px-2 py-1 text-[11px] font-medium text-[var(--axon-primary)] hover:bg-[var(--axon-card-hover)]"
                          title="Open in new tab"
                        >
                          ↗
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Security Posture Widget */}
      {security && (
        <Card
          title="Security & Firewall Posture"
          subtitle={`Overall Server Protection: Grade ${security.score.grade} (${security.score.passed}/${security.score.total} checks passed)`}
          actions={
            <Link
              to="/security"
              className="text-xs font-semibold text-[var(--axon-primary)] hover:opacity-80"
            >
              Security Settings →
            </Link>
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              to="/security"
              className="rounded-lg border border-[var(--axon-border)] p-3 transition hover:border-[var(--axon-primary)]/50 bg-[var(--axon-card)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--axon-text)]">UFW Firewall</p>
                <Badge tone={security.firewall.active ? "ok" : "bad"}>
                  {security.firewall.active ? "Active" : "Disabled"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-[var(--axon-muted)]">
                {security.firewall.rulesCount} rules · incoming {security.firewall.defaultIncoming}
              </p>
            </Link>

            <Link
              to="/security"
              className="rounded-lg border border-[var(--axon-border)] p-3 transition hover:border-[var(--axon-primary)]/50 bg-[var(--axon-card)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--axon-text)]">Fail2Ban Service</p>
                <Badge tone={security.fail2ban.active ? "ok" : "bad"}>
                  {security.fail2ban.active ? "Active" : "Offline"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-[var(--axon-muted)]">
                {security.fail2ban.currentlyBanned} IPs banned across {security.fail2ban.jailsCount} jails
              </p>
            </Link>

            <Link
              to="/security"
              className="rounded-lg border border-[var(--axon-border)] p-3 transition hover:border-[var(--axon-primary)]/50 bg-[var(--axon-card)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--axon-text)]">SSH Hardening</p>
                <Badge tone={security.ssh.permitRootLogin === "yes" ? "warn" : "ok"}>
                  Port {security.ssh.port}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-[var(--axon-muted)]">
                Root login: {security.ssh.permitRootLogin} · pass: {security.ssh.passwordAuthentication}
              </p>
            </Link>

            <Link
              to="/security"
              className="rounded-lg border border-[var(--axon-border)] p-3 transition hover:border-[var(--axon-primary)]/50 bg-[var(--axon-card)]"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-[var(--axon-text)]">Panel 2FA & Access</p>
                <Badge tone={security.panel.totpEnabled ? "ok" : "warn"}>
                  {security.panel.totpEnabled ? "2FA Enabled" : "2FA Disabled"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-[var(--axon-muted)]">
                {security.panel.ipAllowlistCount > 0 ? `${security.panel.ipAllowlistCount} IP(s) allowlisted` : "Open IP Access"}
              </p>
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
