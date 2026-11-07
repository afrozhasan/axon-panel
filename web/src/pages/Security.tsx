import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
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

type SecurityOverview = {
  firewall: {
    active: boolean;
    rulesCount: number;
    defaultIncoming: string;
    defaultOutgoing: string;
  };
  fail2ban: {
    active: boolean;
    jailsCount: number;
    currentlyBanned: number;
    totalBanned: number;
  };
  ssh: {
    port: number;
    permitRootLogin: string;
    passwordAuthentication: string;
    pubkeyAuthentication: string;
    authorizedKeysCount: number;
  };
  panel: {
    totpEnabled: boolean;
    ipAllowlistCount: number;
    sessionHours: number;
  };
  ports: {
    total: number;
    public: number;
    localhost: number;
  };
  score: {
    grade: string;
    passed: number;
    total: number;
    warnings: string[];
  };
};

type UfwRule = {
  number: number;
  to: string;
  action: string;
  from: string;
  comment: string;
};

type FirewallData = {
  active: boolean;
  logging: string;
  defaultIncoming: string;
  defaultOutgoing: string;
  rules: UfwRule[];
};

type Fail2banJail = {
  name: string;
  currentlyFailed: number;
  totalFailed: number;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
};

type Fail2banData = {
  active: boolean;
  jails: Fail2banJail[];
};

type SshData = {
  port: number;
  permitRootLogin: string;
  passwordAuthentication: string;
  pubkeyAuthentication: string;
  maxAuthTries: number;
  loginGraceTime: number;
  authorizedKeysCount: number;
  active: boolean;
};

type PortSocket = {
  proto: string;
  port: number;
  address: string;
  process: string;
  pid: number | null;
  isPublic: boolean;
};

type AuditEntry = {
  at: string;
  actor: string;
  ip: string | null;
  action: string;
  result: string;
  params: Record<string, unknown>;
  detail: string | null;
};

type PanelData = {
  totpEnabled: boolean;
  ipAllowlist: string[];
  sessionHours: number;
  adminUser: string;
  panelDomain: string;
  rateLimitMax: number;
  rateLimitLockoutMin: number;
};

export default function Security({ defaultTab = "overview" }: { defaultTab?: string }) {
  const [tab, setTab] = useState(defaultTab);

  useEffect(() => {
    if (defaultTab) {
      setTab(defaultTab);
    }
  }, [defaultTab]);

  // Security Scanner
  const [scanResults, setScanResults] = useState<any | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fixing, setFixing] = useState(false);

  // Overview
  const [overview, setOverview] = useState<SecurityOverview | null>(null);
  const [ports, setPorts] = useState<PortSocket[]>([]);

  // Firewall
  const [firewall, setFirewall] = useState<FirewallData | null>(null);
  const [ruleSearch, setRuleSearch] = useState("");
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [newRule, setNewRule] = useState({
    port: "",
    proto: "tcp",
    action: "allow",
    from: "",
    comment: "",
  });
  const [ruleToDelete, setRuleToDelete] = useState<UfwRule | null>(null);

  // Fail2ban
  const [fail2ban, setFail2ban] = useState<Fail2banData | null>(null);
  const [bannedSearch, setBannedSearch] = useState("");
  const [banModalOpen, setBanModalOpen] = useState(false);
  const [manualBan, setManualBan] = useState({ ip: "", jail: "sshd" });

  // SSH
  const [ssh, setSsh] = useState<SshData | null>(null);
  const [sshForm, setSshForm] = useState({
    port: 22,
    permitRootLogin: "yes",
    passwordAuthentication: "yes",
    pubkeyAuthentication: "yes",
    maxAuthTries: 3,
    loginGraceTime: 30,
  });

  // Panel
  const [panel, setPanel] = useState<PanelData | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);

  const [loading, setLoading] = useState(true);
  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();

  const loadOverview = async () => {
    try {
      const [ov, pts] = await Promise.all([
        api.get<SecurityOverview>("/security/overview"),
        api.get<{ ports: PortSocket[] }>("/security/ports"),
      ]);
      setOverview(ov);
      setPorts(pts.ports);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const loadFirewall = async () => {
    try {
      const res = await api.get<FirewallData>("/security/firewall");
      setFirewall(res);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const loadFail2ban = async () => {
    try {
      const res = await api.get<Fail2banData>("/security/fail2ban");
      setFail2ban(res);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const loadSsh = async () => {
    try {
      const res = await api.get<SshData>("/security/ssh");
      setSsh(res);
      setSshForm({
        port: res.port,
        permitRootLogin: res.permitRootLogin,
        passwordAuthentication: res.passwordAuthentication,
        pubkeyAuthentication: res.pubkeyAuthentication,
        maxAuthTries: res.maxAuthTries,
        loginGraceTime: res.loginGraceTime,
      });
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  const loadPanel = async () => {
    try {
      const [pnl, aud] = await Promise.all([
        api.get<PanelData>("/security/panel"),
        api.get<{ entries: AuditEntry[] }>("/security/audit?limit=40"),
      ]);
      setPanel(pnl);
      setAuditEntries(aud.entries);
    } catch (e) {
      toast("error", errorMessage(e));
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await loadOverview();
      setLoading(false);
    };
    init();
  }, []);

  useEffect(() => {
    setError(null);
    if (tab === "overview") loadOverview();
    if (tab === "firewall") loadFirewall();
    if (tab === "fail2ban") loadFail2ban();
    if (tab === "ssh") loadSsh();
    if (tab === "panel") loadPanel();
    if (tab === "scanner" && !scanResults && !scanning) loadScan();
  }, [tab]);

  const loadScan = async () => {
    try {
      const res = await api.get<any>("/security/scan");
      setScanResults(res);
    } catch {}
  };

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await api.post<any>("/security/scan/run");
      setScanResults(res);
      toast("ok", `Security scan complete: Grade ${res.score.grade}`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setScanning(false);
    }
  };

  const autoFix = async () => {
    setFixing(true);
    try {
      const res = await api.post<any>("/security/scan/fix");
      toast("ok", `Security fixes applied: ${res.actions?.join(", ") || "All clean"}`);
      await runScan();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setFixing(false);
    }
  };

  if (loading && !overview) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading security settings…
      </div>
    );
  }

  const applyPortPreset = (preset: string) => {
    switch (preset) {
      case "http":
        setNewRule({ ...newRule, port: "80", proto: "tcp", action: "allow", comment: "HTTP web" });
        break;
      case "https":
        setNewRule({ ...newRule, port: "443", proto: "tcp", action: "allow", comment: "HTTPS web" });
        break;
      case "ssh":
        setNewRule({ ...newRule, port: "22", proto: "tcp", action: "limit", comment: "SSH rate-limit" });
        break;
      case "panel":
        setNewRule({ ...newRule, port: "9090", proto: "tcp", action: "allow", comment: "Webpanel GUI" });
        break;
      case "mysql":
        setNewRule({ ...newRule, port: "3306", proto: "tcp", action: "allow", comment: "MySQL/MariaDB" });
        break;
      case "postgres":
        setNewRule({ ...newRule, port: "5432", proto: "tcp", action: "allow", comment: "PostgreSQL" });
        break;
      case "redis":
        setNewRule({ ...newRule, port: "6379", proto: "tcp", action: "allow", comment: "Redis" });
        break;
    }
  };

  const filteredRules = (firewall?.rules || []).filter((r) => {
    if (!ruleSearch.trim()) return true;
    const q = ruleSearch.toLowerCase();
    return (
      r.to.toLowerCase().includes(q) ||
      r.action.toLowerCase().includes(q) ||
      r.from.toLowerCase().includes(q) ||
      r.comment.toLowerCase().includes(q) ||
      String(r.number).includes(q)
    );
  });

  const allBanned = (fail2ban?.jails || []).flatMap((j) =>
    j.bannedIps.map((ip) => ({ ip, jail: j.name }))
  );

  const filteredBanned = allBanned.filter((item) => {
    if (!bannedSearch.trim()) return true;
    const q = bannedSearch.toLowerCase();
    return item.ip.toLowerCase().includes(q) || item.jail.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Security Settings</h1>
          <p className="text-xs text-slate-500">
            System firewall, intrusion prevention (Fail2ban), SSH hardening, and panel access control
          </p>
        </div>
        {overview && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Security Grade:</span>
            <span
              className={`rounded px-2.5 py-0.5 text-xs font-bold ${
                overview.score.grade === "A"
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : overview.score.grade.startsWith("B")
                  ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                  : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              }`}
            >
              {overview.score.grade} ({overview.score.passed}/{overview.score.total} passed)
            </span>
          </div>
        )}
      </div>

      <ErrorBanner message={error} />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Security Posture" },
          {
            id: "scanner",
            label: "Security Scanner",
            badge: (
              <span className="rounded bg-[var(--axon-primary)]/20 px-1.5 py-0.2 text-[10px] font-semibold text-[var(--axon-primary)]">
                Audit
              </span>
            ),
          },
          {
            id: "firewall",
            label: "Firewall (UFW)",
            badge: firewall?.active ? (
              <Badge tone="ok">On</Badge>
            ) : overview?.firewall.active ? (
              <Badge tone="ok">On</Badge>
            ) : (
              <Badge tone="bad">Off</Badge>
            ),
          },
          {
            id: "fail2ban",
            label: "Intrusion Prevention (Fail2ban)",
            badge:
              overview && overview.fail2ban.currentlyBanned > 0 ? (
                <span className="rounded bg-rose-500/20 px-1.5 py-0.2 text-[10px] text-rose-300">
                  {overview.fail2ban.currentlyBanned} banned
                </span>
              ) : undefined,
          },
          { id: "ssh", label: "SSH Hardening" },
          { id: "panel", label: "Panel Access & Audit" },
        ]}
      />

      {/* -------------------- TAB: OVERVIEW -------------------- */}
      {tab === "overview" && overview && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Firewall (UFW)</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-100">
                  {overview.firewall.active ? "Active" : "Disabled"}
                </p>
                <Badge tone={overview.firewall.active ? "ok" : "bad"}>
                  {overview.firewall.active ? "Protected" : "Vulnerable"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {overview.firewall.rulesCount} rules · default: incoming {overview.firewall.defaultIncoming}
              </p>
            </div>

            <div className="card p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Fail2Ban Service</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-100">
                  {overview.fail2ban.active ? "Running" : "Stopped"}
                </p>
                <Badge tone={overview.fail2ban.active ? "ok" : "warn"}>
                  {overview.fail2ban.jailsCount} jails
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {overview.fail2ban.currentlyBanned} active bans ({overview.fail2ban.totalBanned} total)
              </p>
            </div>

            <div className="card p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">SSH Security</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-100">Port {overview.ssh.port}</p>
                <Badge tone={overview.ssh.permitRootLogin === "yes" ? "warn" : "ok"}>
                  Root: {overview.ssh.permitRootLogin}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {overview.ssh.authorizedKeysCount} public key(s) · pass auth: {overview.ssh.passwordAuthentication}
              </p>
            </div>

            <div className="card p-3.5">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">Panel 2FA & Access</p>
              <div className="mt-1 flex items-center justify-between">
                <p className="text-xl font-semibold text-slate-100">
                  {overview.panel.totpEnabled ? "2FA Enabled" : "2FA Off"}
                </p>
                <Badge tone={overview.panel.totpEnabled ? "ok" : "warn"}>
                  {overview.panel.totpEnabled ? "Protected" : "Recommended"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">
                {overview.panel.ipAllowlistCount > 0
                  ? `${overview.panel.ipAllowlistCount} allowed IP(s)`
                  : "All IPs permitted"}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Checklist */}
            <Card
              title="Security Checklist"
              subtitle="Essential server and dashboard security measures"
            >
              <ul className="divide-y divide-[#161d2b]">
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">UFW Firewall Status</p>
                    <p className="text-[11px] text-slate-500">Blocks unexpected incoming traffic</p>
                  </div>
                  <Badge tone={overview.firewall.active ? "ok" : "bad"}>
                    {overview.firewall.active ? "Pass" : "Disabled"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">Fail2Ban Intrusion Prevention</p>
                    <p className="text-[11px] text-slate-500">Bans brute-force attack sources automatically</p>
                  </div>
                  <Badge tone={overview.fail2ban.active ? "ok" : "bad"}>
                    {overview.fail2ban.active ? "Pass" : "Inactive"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">SSH Root Login Policy</p>
                    <p className="text-[11px] text-slate-500">
                      Restrict direct password logins as root (use keys or sudo)
                    </p>
                  </div>
                  <Badge
                    tone={
                      overview.ssh.permitRootLogin === "prohibit-password" ||
                      overview.ssh.permitRootLogin === "no"
                        ? "ok"
                        : "warn"
                    }
                  >
                    {overview.ssh.permitRootLogin}
                  </Badge>
                </li>
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">Panel Two-Factor Authentication</p>
                    <p className="text-[11px] text-slate-500">Authenticator app TOTP code required at login</p>
                  </div>
                  <Badge tone={overview.panel.totpEnabled ? "ok" : "warn"}>
                    {overview.panel.totpEnabled ? "Active" : "Off"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">Panel IP Allowlist</p>
                    <p className="text-[11px] text-slate-500">Restricts dashboard access to your IP address</p>
                  </div>
                  <Badge tone={overview.panel.ipAllowlistCount > 0 ? "ok" : "neutral"}>
                    {overview.panel.ipAllowlistCount > 0 ? `${overview.panel.ipAllowlistCount} configured` : "Open"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between py-2 text-xs">
                  <div>
                    <p className="font-medium text-slate-200">Public Exposed Ports</p>
                    <p className="text-[11px] text-slate-500">
                      {overview.ports.public} ports exposed to the public internet
                    </p>
                  </div>
                  <Badge tone={overview.ports.public <= 4 ? "ok" : "warn"}>
                    {overview.ports.public} Public
                  </Badge>
                </li>
              </ul>

              {overview.score.warnings.length > 0 && (
                <div className="mt-4 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200">
                  <p className="font-semibold text-amber-300">Action Recommendations:</p>
                  <ul className="mt-1 list-inside list-disc space-y-1 text-[11px]">
                    {overview.score.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>

            {/* Open Listening Ports Scanner */}
            <Card
              title="Listening Ports & Services"
              subtitle="Live scan from ss socket statistics"
              actions={
                <Button size="sm" onClick={loadOverview} loading={busy}>
                  Rescan
                </Button>
              }
            >
              <div className="max-h-[360px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                    <tr>
                      <th className="th">Port</th>
                      <th className="th">Proto</th>
                      <th className="th">Process</th>
                      <th className="th">Interface</th>
                      <th className="th">Exposure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ports.map((p, idx) => (
                      <tr key={idx} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="td mono font-semibold text-slate-200">{p.port}</td>
                        <td className="td text-slate-400">{p.proto}</td>
                        <td className="td mono text-[11px] text-slate-300">
                          {p.process} {p.pid ? `(${p.pid})` : ""}
                        </td>
                        <td className="td mono text-[11px] text-slate-400">{p.address}</td>
                        <td className="td">
                          <Badge tone={p.isPublic ? "warn" : "ok"}>
                            {p.isPublic ? "Public" : "Localhost"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* -------------------- TAB: SCANNER & INTEGRITY AUDIT -------------------- */}
      {tab === "scanner" && (
        <div className="space-y-4">
          {/* Scanner Hero */}
          <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2.5">
                  <h3 className="text-lg font-bold text-[var(--axon-text)]">Security & Integrity Scanner</h3>
                  {scanResults && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-0.5 text-xs font-bold text-emerald-400">
                      Grade {scanResults.score.grade} ({scanResults.score.passed}/{scanResults.score.total} Passed)
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--axon-muted)]">
                  Audits website directories for world-writable permissions, exposed .env/.git files, webshells in upload directories, and credential security.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="primary" loading={scanning} onClick={runScan}>
                  🛡️ Run Security Scan
                </Button>
                <Button variant="ghost" loading={fixing} onClick={autoFix}>
                  ⚡ Auto-Fix Permissions
                </Button>
              </div>
            </div>
          </div>

          {/* Scanner Checks & Issues */}
          {scanResults ? (
            <div className="space-y-4">
              {/* Checks Overview */}
              <Card title="Security Baseline Verifications" subtitle="Automated checks executed against server directories and services">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {scanResults.checks?.map((check: any, idx: number) => (
                    <div key={idx} className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-[var(--axon-text)]">{check.name}</p>
                        <Badge tone={check.status === "pass" ? "ok" : check.status === "warn" ? "warn" : "bad"}>
                          {check.status === "pass" ? "PASSED" : check.status === "warn" ? "WARNING" : "FAILED"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--axon-muted)]">
                        {check.status === "pass" ? "No issues detected" : `${check.count || 1} item(s) flagged`}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Detected Issues */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span>Detected Vulnerabilities & Issues</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      scanResults.issues?.length > 0 ? "bg-rose-500/20 text-rose-300" : "bg-emerald-500/20 text-emerald-300"
                    }`}>
                      {scanResults.issues?.length || 0}
                    </span>
                  </div>
                }
                subtitle="Remediation steps for detected security issues"
              >
                {scanResults.issues?.length === 0 ? (
                  <EmptyState message="All security integrity checks passed! Zero critical issues found." />
                ) : (
                  <div className="space-y-3">
                    {scanResults.issues?.map((issue: any) => (
                      <div
                        key={issue.id}
                        className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold text-[var(--axon-text)]">{issue.title}</p>
                          <div className="flex items-center gap-2">
                            {issue.canAutoFix && (
                              <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                                Auto-Fixable
                              </span>
                            )}
                            <Badge tone={issue.severity === "critical" ? "bad" : issue.severity === "high" ? "warn" : "neutral"}>
                              {issue.severity.toUpperCase()}
                            </Badge>
                          </div>
                        </div>
                        <p className="text-xs text-[var(--axon-muted)]">{issue.description}</p>
                        {issue.items && (
                          <div className="mt-2 rounded bg-[#080F19] p-2 text-[11px] mono text-[var(--axon-muted)] max-h-28 overflow-y-auto border border-[var(--axon-border)]">
                            {issue.items.map((item: string, i: number) => (
                              <div key={i}>{item}</div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          ) : (
            <div className="py-12 text-center text-sm text-[var(--axon-muted)]">
              Click &quot;Run Security Scan&quot; above to audit the server filesystem, permissions, and network exposure.
            </div>
          )}
        </div>
      )}

      {/* -------------------- TAB: FIREWALL -------------------- */}
      {tab === "firewall" && (
        <div className="space-y-4">
          <Card
            title="Uncomplicated Firewall (UFW)"
            subtitle={
              firewall?.active
                ? "Firewall is active and filtering incoming connections"
                : "Firewall is currently inactive"
            }
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant={firewall?.active ? "danger" : "primary"}
                  loading={busy}
                  onClick={() => {
                    run(async () => {
                      const res = await api.post<{ ok: boolean; active: boolean }>(
                        "/security/firewall/toggle",
                        { enable: !firewall?.active }
                      );
                      toast(
                        "ok",
                        res.active ? "Firewall enabled" : "Firewall disabled"
                      );
                      await loadFirewall();
                    }, "Firewall updated");
                  }}
                >
                  {firewall?.active ? "Disable Firewall" : "Enable Firewall"}
                </Button>
                <Button variant="primary" onClick={() => setRuleModalOpen(true)}>
                  + Add Rule
                </Button>
              </div>
            }
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--axon-border)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Status</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={firewall?.active ? "ok" : "bad"}>
                    {firewall?.active ? "Active" : "Disabled"}
                  </Badge>
                  <span className="text-xs text-slate-400">Logging: {firewall?.logging}</span>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--axon-border)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Default Incoming</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="mono text-sm font-semibold uppercase text-slate-200">
                    {firewall?.defaultIncoming || "deny"}
                  </span>
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() => {
                      const next = firewall?.defaultIncoming === "deny" ? "allow" : "deny";
                      run(async () => {
                        await api.post("/security/firewall/default", {
                          direction: "incoming",
                          policy: next,
                        });
                        await loadFirewall();
                      }, `Incoming policy set to ${next}`);
                    }}
                  >
                    Switch to {firewall?.defaultIncoming === "deny" ? "ALLOW" : "DENY"}
                  </Button>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--axon-border)] p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Default Outgoing</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="mono text-sm font-semibold uppercase text-slate-200">
                    {firewall?.defaultOutgoing || "allow"}
                  </span>
                  <span className="text-[11px] text-slate-500">Standard for servers</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Firewall Rules ({firewall?.rules.length || 0})
              </h3>
              <input
                type="text"
                className="field max-w-xs"
                placeholder="Search rules (port, action, IP)..."
                value={ruleSearch}
                onChange={(e) => setRuleSearch(e.target.value)}
              />
            </div>

            <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--axon-border)]">
              {filteredRules.length === 0 ? (
                <EmptyState message="No firewall rules match your filter" />
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--axon-card)]">
                    <tr>
                      <th className="th w-12">#</th>
                      <th className="th">To (Destination / Port)</th>
                      <th className="th">Action</th>
                      <th className="th">From (Source)</th>
                      <th className="th">Comment</th>
                      <th className="th text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRules.map((rule) => (
                      <tr key={rule.number} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="td text-slate-500">[{rule.number}]</td>
                        <td className="td mono font-semibold text-slate-200">{rule.to}</td>
                        <td className="td">
                          <Badge
                            tone={
                              rule.action.includes("ALLOW")
                                ? "ok"
                                : rule.action.includes("LIMIT")
                                ? "warn"
                                : "bad"
                            }
                          >
                            {rule.action}
                          </Badge>
                        </td>
                        <td className="td mono text-[11px] text-slate-300">{rule.from}</td>
                        <td className="td text-slate-400">{rule.comment || "—"}</td>
                        <td className="td text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={busy}
                            onClick={() => setRuleToDelete(rule)}
                          >
                            Delete
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Add Rule Modal */}
          <Modal
            open={ruleModalOpen}
            title="Add Firewall Rule"
            onClose={() => setRuleModalOpen(false)}
          >
            <div className="space-y-3">
              <div>
                <p className="mb-1 text-xs text-slate-400">Quick Presets:</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPortPreset("http")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    HTTP (80)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("https")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    HTTPS (443)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("ssh")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    SSH Limit (22)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("panel")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    Panel (9090)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("mysql")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    MySQL (3306)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("postgres")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    Postgres (5432)
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPortPreset("redis")}
                    className="rounded border border-[var(--axon-border)] bg-[#111823] px-2 py-1 text-[11px] text-slate-300 hover:border-indigo-500"
                  >
                    Redis (6379)
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Port or Port Range" hint="e.g. 80, 443, 8000:9000">
                  <input
                    className="field mono"
                    placeholder="8080"
                    value={newRule.port}
                    onChange={(e) => setNewRule({ ...newRule, port: e.target.value })}
                  />
                </Field>
                <Field label="Protocol">
                  <select
                    className="field"
                    value={newRule.proto}
                    onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="any">Any (TCP + UDP)</option>
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Action">
                  <select
                    className="field"
                    value={newRule.action}
                    onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                  >
                    <option value="allow">ALLOW (Permit traffic)</option>
                    <option value="deny">DENY (Silently drop)</option>
                    <option value="limit">LIMIT (Rate limit brute force)</option>
                    <option value="reject">REJECT (Send reject packet)</option>
                  </select>
                </Field>
                <Field label="Source IP / Subnet" hint="Leave empty for Anywhere">
                  <input
                    className="field mono"
                    placeholder="Anywhere or 192.168.1.100"
                    value={newRule.from}
                    onChange={(e) => setNewRule({ ...newRule, from: e.target.value })}
                  />
                </Field>
              </div>

              <Field label="Comment" hint="Optional description max 40 chars">
                <input
                  className="field"
                  placeholder="e.g. Microservice backend"
                  value={newRule.comment}
                  onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })}
                />
              </Field>

              <footer className="mt-4 flex justify-end gap-2">
                <Button onClick={() => setRuleModalOpen(false)}>Cancel</Button>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!newRule.port.trim()}
                  onClick={() => {
                    run(async () => {
                      await api.post("/security/firewall/rules", {
                        port: newRule.port.trim(),
                        proto: newRule.proto,
                        action: newRule.action,
                        from: newRule.from.trim() || undefined,
                        comment: newRule.comment.trim() || undefined,
                      });
                      setRuleModalOpen(false);
                      setNewRule({ port: "", proto: "tcp", action: "allow", from: "", comment: "" });
                      await loadFirewall();
                    }, "Firewall rule created");
                  }}
                >
                  Create Rule
                </Button>
              </footer>
            </div>
          </Modal>

          {/* Delete Rule Confirm Dialog */}
          <ConfirmDialog
            open={Boolean(ruleToDelete)}
            title="Delete Firewall Rule"
            message={`Are you sure you want to delete Rule #[${ruleToDelete?.number}]: ${ruleToDelete?.action} ${ruleToDelete?.to} from ${ruleToDelete?.from}?`}
            confirmLabel="Delete Rule"
            busy={busy}
            onCancel={() => setRuleToDelete(null)}
            onConfirm={() => {
              if (!ruleToDelete) return;
              run(async () => {
                await api.del(`/security/firewall/rules/${ruleToDelete.number}`);
                setRuleToDelete(null);
                await loadFirewall();
              }, "Rule deleted");
            }}
          />
        </div>
      )}

      {/* -------------------- TAB: FAIL2BAN -------------------- */}
      {tab === "fail2ban" && (
        <div className="space-y-4">
          <Card
            title="Fail2Ban Intrusion Prevention"
            subtitle="Scans log files for repeated authentication failures and bans offensive IP addresses"
            actions={
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  loading={busy}
                  onClick={() => {
                    run(async () => {
                      await api.post("/security/fail2ban/service", { action: "restart" });
                      await loadFail2ban();
                    }, "Fail2ban restarted");
                  }}
                >
                  Restart Service
                </Button>
                <Button variant="primary" onClick={() => setBanModalOpen(true)}>
                  + Ban IP Manually
                </Button>
              </div>
            }
          >
            {/* Jails Cards */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(fail2ban?.jails || []).map((jail) => (
                <div key={jail.name} className="rounded-lg border border-[var(--axon-border)] p-3.5 bg-[#0a0d14]">
                  <div className="flex items-center justify-between">
                    <span className="mono text-xs font-bold text-indigo-300">jail: {jail.name}</span>
                    <Badge tone={jail.currentlyBanned > 0 ? "bad" : "ok"}>
                      {jail.currentlyBanned} banned
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                    <div>
                      <span className="text-slate-500">Currently failed:</span>{" "}
                      <span className="font-semibold text-slate-200">{jail.currentlyFailed}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Total failed:</span>{" "}
                      <span className="font-semibold text-slate-200">{jail.totalFailed}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Active bans:</span>{" "}
                      <span className="font-semibold text-rose-300">{jail.currentlyBanned}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Total banned:</span>{" "}
                      <span className="font-semibold text-slate-200">{jail.totalBanned}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Banned IPs List */}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Currently Banned IP Addresses ({allBanned.length})
                </h3>
                <p className="text-[11px] text-slate-500">
                  IPs blocked by iptables firewall due to repeated failed login attempts
                </p>
              </div>
              <input
                type="text"
                className="field max-w-xs"
                placeholder="Filter banned IPs..."
                value={bannedSearch}
                onChange={(e) => setBannedSearch(e.target.value)}
              />
            </div>

            <div className="mt-3 max-h-[420px] overflow-auto rounded-lg border border-[var(--axon-border)]">
              {filteredBanned.length === 0 ? (
                <EmptyState message="No banned IP addresses found" />
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                    <tr>
                      <th className="th">Banned IP Address</th>
                      <th className="th">Triggered Jail</th>
                      <th className="th">Action</th>
                      <th className="th text-right">Quick Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBanned.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="td mono font-semibold text-rose-300">{item.ip}</td>
                        <td className="td mono text-[11px] text-indigo-300">{item.jail}</td>
                        <td className="td">
                          <Badge tone="bad">DROP / REJECT</Badge>
                        </td>
                        <td className="td text-right">
                          <Button
                            size="sm"
                            loading={busy}
                            onClick={() => {
                              run(async () => {
                                await api.post("/security/fail2ban/unban", {
                                  ip: item.ip,
                                  jail: item.jail,
                                });
                                await loadFail2ban();
                              }, `IP ${item.ip} unbanned`);
                            }}
                          >
                            Unban IP
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>

          {/* Manual Ban Modal */}
          <Modal
            open={banModalOpen}
            title="Manually Ban IP Address"
            onClose={() => setBanModalOpen(false)}
          >
            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Immediately block an offensive IP address using Fail2Ban and system firewall rules.
              </p>
              <Field label="IP Address to Ban" hint="e.g. 195.178.110.228">
                <input
                  className="field mono"
                  placeholder="203.0.113.10"
                  value={manualBan.ip}
                  onChange={(e) => setManualBan({ ...manualBan, ip: e.target.value })}
                />
              </Field>
              <Field label="Select Jail">
                <select
                  className="field"
                  value={manualBan.jail}
                  onChange={(e) => setManualBan({ ...manualBan, jail: e.target.value })}
                >
                  {(fail2ban?.jails || []).map((j) => (
                    <option key={j.name} value={j.name}>
                      {j.name}
                    </option>
                  ))}
                </select>
              </Field>
              <footer className="mt-4 flex justify-end gap-2">
                <Button onClick={() => setBanModalOpen(false)}>Cancel</Button>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={!manualBan.ip.trim()}
                  onClick={() => {
                    run(async () => {
                      await api.post("/security/fail2ban/ban", {
                        ip: manualBan.ip.trim(),
                        jail: manualBan.jail,
                      });
                      setBanModalOpen(false);
                      setManualBan({ ip: "", jail: "sshd" });
                      await loadFail2ban();
                    }, "IP address banned");
                  }}
                >
                  Ban IP
                </Button>
              </footer>
            </div>
          </Modal>
        </div>
      )}

      {/* -------------------- TAB: SSH HARDENING -------------------- */}
      {tab === "ssh" && ssh && (
        <Card
          title="SSH Server Hardening"
          subtitle="Configure OpenSSH daemon security settings, port, and authentication restrictions"
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs text-indigo-200">
              <p className="font-semibold text-indigo-300">Lockout Safety Guard Active:</p>
              <p className="mt-0.5 text-[11px] text-slate-300">
                Current SSH root key status:{" "}
                <span className="mono font-bold text-emerald-300">
                  {ssh.authorizedKeysCount} public key(s) installed
                </span>{" "}
                in /root/.ssh/authorized_keys. If you change the SSH port, UFW will automatically allow
                the new port before reloading the SSH server so you are never locked out.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="SSH Port"
                hint="Default is 22. Changing this reduces automated brute-force scans."
              >
                <input
                  type="number"
                  min={1}
                  max={65535}
                  className="field mono"
                  value={sshForm.port}
                  onChange={(e) => setSshForm({ ...sshForm, port: Number(e.target.value) })}
                />
              </Field>

              <Field
                label="Permit Root Login"
                hint="prohibit-password is recommended: allows key-based login, prevents password guessing."
              >
                <select
                  className="field"
                  value={sshForm.permitRootLogin}
                  onChange={(e) => setSshForm({ ...sshForm, permitRootLogin: e.target.value })}
                >
                  <option value="prohibit-password">prohibit-password (Keys only - Recommended)</option>
                  <option value="no">no (Disabled completely)</option>
                  <option value="yes">yes (Password + keys allowed)</option>
                </select>
              </Field>

              <Field
                label="Password Authentication"
                hint="Set to 'no' to enforce SSH key pairs and eliminate password brute force."
              >
                <select
                  className="field"
                  value={sshForm.passwordAuthentication}
                  onChange={(e) => setSshForm({ ...sshForm, passwordAuthentication: e.target.value })}
                >
                  <option value="yes">yes (Allow password login)</option>
                  <option value="no">no (Keys only - Disallow passwords)</option>
                </select>
              </Field>

              <Field
                label="Public Key Authentication"
                hint="Required for SSH key pair authentication."
              >
                <select
                  className="field"
                  value={sshForm.pubkeyAuthentication}
                  onChange={(e) => setSshForm({ ...sshForm, pubkeyAuthentication: e.target.value })}
                >
                  <option value="yes">yes (Enabled - Recommended)</option>
                  <option value="no">no (Disabled)</option>
                </select>
              </Field>

              <Field
                label="Max Authentication Tries"
                hint="Number of failed attempts allowed per connection (1 to 10)."
              >
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="field"
                  value={sshForm.maxAuthTries}
                  onChange={(e) => setSshForm({ ...sshForm, maxAuthTries: Number(e.target.value) })}
                />
              </Field>

              <Field
                label="Login Grace Time (seconds)"
                hint="Time disconnected if login is not completed (5 to 300s)."
              >
                <input
                  type="number"
                  min={5}
                  max={300}
                  className="field"
                  value={sshForm.loginGraceTime}
                  onChange={(e) => setSshForm({ ...sshForm, loginGraceTime: Number(e.target.value) })}
                />
              </Field>
            </div>

            <footer className="mt-4 flex items-center justify-between border-t border-[var(--axon-border)] pt-4">
              <span className="text-xs text-slate-500">
                Tests syntax with <code className="mono">sshd -t</code> and restarts socket/service
              </span>
              <Button
                variant="primary"
                loading={busy}
                onClick={() => {
                  run(async () => {
                    await api.post("/security/ssh", sshForm);
                    await loadSsh();
                  }, "SSH security configuration applied and reloaded");
                }}
              >
                Save & Apply SSH Hardening
              </Button>
            </footer>
          </div>
        </Card>
      )}

      {/* -------------------- TAB: PANEL ACCESS & AUDIT -------------------- */}
      {tab === "panel" && (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card
              title="Panel Access Protection"
              subtitle="Protects the Axon Panel administrative dashboard"
            >
              <ul className="divide-y divide-[#161d2b] text-xs">
                <li className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-semibold text-slate-200">Two-Factor Authentication (TOTP)</p>
                    <p className="text-[11px] text-slate-500">
                      Requires Google Authenticator or 1Password code to log in
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={panel?.totpEnabled ? "ok" : "warn"}>
                      {panel?.totpEnabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Link to="/settings?tab=security" className="text-indigo-400 hover:text-indigo-300">
                      Manage →
                    </Link>
                  </div>
                </li>

                <li className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-semibold text-slate-200">Nginx Layer IP Allowlist</p>
                    <p className="text-[11px] text-slate-500">
                      {panel?.ipAllowlist.length || 0} IP / CIDR entries configured
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={panel && panel.ipAllowlist.length > 0 ? "ok" : "neutral"}>
                      {panel && panel.ipAllowlist.length > 0 ? "Enforced" : "Open"}
                    </Badge>
                    <Link to="/settings" className="text-indigo-400 hover:text-indigo-300">
                      Manage →
                    </Link>
                  </div>
                </li>

                <li className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-semibold text-slate-200">Brute-Force Lockout Policy</p>
                    <p className="text-[11px] text-slate-500">
                      5 failed password attempts triggers automatic 15-minute lockout per IP
                    </p>
                  </div>
                  <Badge tone="ok">Active</Badge>
                </li>

                <li className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="font-semibold text-slate-200">Session Cookie Security</p>
                    <p className="text-[11px] text-slate-500">
                      httpOnly, Secure, SameSite=Strict with CSRF header enforcement
                    </p>
                  </div>
                  <Badge tone="ok">Active</Badge>
                </li>
              </ul>
            </Card>

            <Card
              title="Recent Security Audit Log"
              subtitle="Latest security and authentication events recorded"
              actions={
                <Link to="/settings" className="text-xs text-indigo-400 hover:text-indigo-300">
                  Full log →
                </Link>
              }
            >
              <div className="max-h-[280px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                    <tr>
                      <th className="th">When</th>
                      <th className="th">Action</th>
                      <th className="th">IP</th>
                      <th className="th">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditEntries.slice(0, 15).map((entry, idx) => (
                      <tr key={idx} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="td whitespace-nowrap text-[11px] text-slate-500">
                          {formatDate(entry.at)}
                        </td>
                        <td className="td mono text-[11px] text-slate-300">{entry.action}</td>
                        <td className="td mono text-[11px] text-slate-400">{entry.ip || "—"}</td>
                        <td className="td">
                          <Badge tone={entry.result === "ok" ? "ok" : "bad"}>{entry.result}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
