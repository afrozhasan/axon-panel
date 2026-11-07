import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, ConfirmDialog, ErrorBanner, Field, Modal, Spinner, useToast } from "../ui";

type AuditData = {
  siteName: string;
  domain: string;
  docroot: string;
  score: number;
  grade: string;
  currentProfile: string;
  deductions: string[];
  core: { version: string; updateAvailable: string | null; tablePrefix: string };
  vulnerabilities: {
    vulnerableCount: number;
    criticalCount: number;
    highCount: number;
    vulnerabilities: Array<{
      component: string;
      installedVersion: string;
      cve: string;
      severity: string;
      title: string;
      fixedVersion: string;
      description: string;
    }>;
  };
  permissions: Record<string, { path: string; mode: string | null; secure: boolean }>;
  wpConfig: {
    disallowFileEdit: boolean;
    disallowFileMods: boolean;
    debugEnabled: boolean;
    debugDisplay: boolean;
    debugLog: boolean;
  };
  features?: {
    tablePrefix: string;
    isDefaultPrefix: boolean;
    wpDebug: {
      enabled: boolean;
      display: boolean;
      log: boolean;
    };
    disallowFileEdit: boolean;
    disallowFileMods: boolean;
    blockXmlrpc: boolean;
    blockUploadPhp: boolean;
    blockWpConfig: boolean;
    blockSensitiveFiles: boolean;
    blockAuthorScan: boolean;
    blockVersionDisclosure: boolean;
    securityHeaders: boolean;
    blockRestApiUsers: boolean;
  };
  nginx: {
    blocksWpConfig: boolean;
    blocksXmlrpc: boolean;
    blocksUploadPhp: boolean;
    blocksSensitiveFiles: boolean;
    blocksAuthorScan?: boolean;
    blocksVersionDisclosure?: boolean;
    blocksRestApiUsers?: boolean;
    hasXFrameOptions: boolean;
    hasXContentType: boolean;
    hasReferrerPolicy: boolean;
    hasHsts: boolean;
    hasPermissionsPolicy: boolean;
    hasLoginRateLimit?: boolean;
    hasHttpsRedirect: boolean;
    hasSsl: boolean;
  };
  sensitiveFiles: Array<{ file: string; risk: string; desc: string }>;
  integrity: { checksumOk: boolean; mismatchesCount: number; mismatches: Array<{ file: string; reason?: string }> };
  malwareScanner: {
    unexpectedUploadPhpCount: number;
    unexpectedUploadPhp: Array<{ path: string; size: number }>;
    disclaimer: string;
  };
  authentication: {
    adminCount: number;
    hasDefaultAdmin: boolean;
    weakPasswordFound: boolean;
    weakPasswordUser: string | null;
    adminUsers: Array<{ id: number; login: string; email: string }>;
    restApiUserExposure: boolean;
  };
};

type PreviewData = {
  profile: string;
  changesCount: number;
  changes: Array<{ target: string; change: string }>;
  compatibilityImpact: string[];
  configDiff: { original: string; preview: string };
  vhostDiff: { original: string; preview: string };
};

function Toggle({
  checked,
  onChange,
  disabled = false,
  loading = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled || loading}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden disabled:opacity-50 disabled:cursor-not-allowed ${
        checked ? "bg-emerald-500" : "bg-slate-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
          checked ? "translate-x-4" : "translate-x-0"
        } ${loading ? "opacity-50 animate-pulse" : ""}`}
      />
    </button>
  );
}

export default function WpSecurityTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Granular feature toggling
  const [togglingFeature, setTogglingFeature] = useState<string | null>(null);

  // Database Prefix Modal
  const [prefixModalOpen, setPrefixModalOpen] = useState(false);
  const [newPrefix, setNewPrefix] = useState("");
  const [changingPrefix, setChangingPrefix] = useState(false);

  // Salt Keys Modal
  const [saltsConfirmOpen, setSaltsConfirmOpen] = useState(false);
  const [regeneratingSalts, setRegeneratingSalts] = useState(false);

  // Hardening preview & modal
  const [selectedProfile, setSelectedProfile] = useState<"basic" | "advanced" | "strict">("advanced");
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);

  // Rollback confirmation
  const [confirmRollback, setConfirmRollback] = useState(false);

  // Malware scan state
  const [malwareScan, setMalwareScan] = useState<any>(null);
  const [scanningMalware, setScanningMalware] = useState(false);

  const toast = useToast();

  const loadAudit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<AuditData>(`/wp/${encodeURIComponent(siteName)}/security/audit`);
      setAudit(res);
      if (res.core?.tablePrefix) {
        setNewPrefix(res.core.tablePrefix);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, [siteName]);

  const handleToggleFeature = async (feature: string, enabled: boolean) => {
    setTogglingFeature(feature);
    try {
      const res = await api.post<{ ok: boolean; message: string; audit: AuditData }>(
        `/wp/${encodeURIComponent(siteName)}/security/toggle`,
        { feature, enabled }
      );
      toast("ok", res.message || `Feature updated successfully`);
      if (res.audit) setAudit(res.audit);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setTogglingFeature(null);
    }
  };

  const generateRandomPrefix = () => {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let rand = "";
    for (let i = 0; i < 6; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewPrefix(`wp_${rand}_`);
  };

  const handleChangePrefix = async () => {
    if (!newPrefix.trim()) return;
    setChangingPrefix(true);
    try {
      const res = await api.post<{ ok: boolean; message: string; audit: AuditData }>(
        `/wp/${encodeURIComponent(siteName)}/security/database-prefix`,
        { newPrefix: newPrefix.trim() }
      );
      toast("ok", res.message || "Database table prefix changed successfully");
      setPrefixModalOpen(false);
      if (res.audit) setAudit(res.audit);
      else await loadAudit();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setChangingPrefix(false);
    }
  };

  const handleRegenerateSalts = async () => {
    setRegeneratingSalts(true);
    try {
      const res = await api.post<{ ok: boolean; message: string; audit: AuditData }>(
        `/wp/${encodeURIComponent(siteName)}/security/regenerate-salts`,
        {}
      );
      toast("ok", res.message || "Security salt keys regenerated successfully");
      setSaltsConfirmOpen(false);
      if (res.audit) setAudit(res.audit);
      else await loadAudit();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setRegeneratingSalts(false);
    }
  };

  const handlePreview = async (profile: "basic" | "advanced" | "strict") => {
    setSelectedProfile(profile);
    setPreviewLoading(true);
    try {
      const res = await api.post<PreviewData>(`/wp/${encodeURIComponent(siteName)}/security/preview`, { profile });
      setPreview(res);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApply = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; backupId: string; audit: AuditData }>(
        `/wp/${encodeURIComponent(siteName)}/security/harden`,
        { profile: selectedProfile, confirmed: true }
      );
      toast("ok", `Security Hardening '${selectedProfile}' applied successfully! Backup created.`);
      setPreview(null);
      setConfirmApply(false);
      if (res.audit) setAudit(res.audit);
      else await loadAudit();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string; audit: AuditData }>(
        `/wp/${encodeURIComponent(siteName)}/security/rollback`,
        {}
      );
      toast("ok", res.message || "Hardening changes rolled back successfully");
      setConfirmRollback(false);
      if (res.audit) setAudit(res.audit);
      else await loadAudit();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRunMalwareScan = async () => {
    setScanningMalware(true);
    try {
      const res = await api.get(`/wp/${encodeURIComponent(siteName)}/security/scan`);
      setMalwareScan(res);
      toast("ok", "Malware & core file checksum scan completed");
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setScanningMalware(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--axon-muted)]">
        <Spinner className="h-6 w-6 mb-2" />
        Running real WordPress security audit (WP-CLI, filesystem, PHP, Nginx)...
      </div>
    );
  }

  const scoreColor =
    (audit?.score || 0) >= 80 ? "text-emerald-400" : (audit?.score || 0) >= 60 ? "text-amber-400" : "text-rose-400";
  const scoreBorder =
    (audit?.score || 0) >= 80 ? "border-emerald-500/40" : (audit?.score || 0) >= 60 ? "border-amber-500/40" : "border-rose-500/40";

  const feat = audit?.features || {
    tablePrefix: audit?.core.tablePrefix || "wp_",
    isDefaultPrefix: (audit?.core.tablePrefix || "wp_") === "wp_",
    wpDebug: {
      enabled: Boolean(audit?.wpConfig.debugEnabled),
      display: Boolean(audit?.wpConfig.debugDisplay),
      log: Boolean(audit?.wpConfig.debugLog),
    },
    disallowFileEdit: Boolean(audit?.wpConfig.disallowFileEdit),
    disallowFileMods: Boolean(audit?.wpConfig.disallowFileMods),
    blockXmlrpc: Boolean(audit?.nginx.blocksXmlrpc),
    blockUploadPhp: Boolean(audit?.nginx.blocksUploadPhp),
    blockWpConfig: Boolean(audit?.nginx.blocksWpConfig),
    blockSensitiveFiles: Boolean(audit?.nginx.blocksSensitiveFiles),
    blockAuthorScan: Boolean(audit?.nginx.blocksAuthorScan),
    blockVersionDisclosure: Boolean(audit?.nginx.blocksVersionDisclosure),
    securityHeaders: Boolean(audit?.nginx.hasXFrameOptions && audit?.nginx.hasXContentType),
    blockRestApiUsers: Boolean(audit?.nginx.blocksRestApiUsers),
  };

  return (
    <div className="space-y-6 pt-1">
      <ErrorBanner message={error} />

      {/* Header Health & Hardening Profiles */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Score Card */}
        <div className={`rounded-xl border ${scoreBorder} bg-[var(--axon-card)] p-4 flex items-center gap-4`}>
          <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-current text-center font-bold">
            <span className={`text-xl ${scoreColor}`}>{audit?.score}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--axon-text)]">Security Grade {audit?.grade}</h3>
              <Badge tone={(audit?.score || 0) >= 80 ? "ok" : (audit?.score || 0) >= 60 ? "warn" : "bad"}>
                {audit?.currentProfile !== "none" ? `${audit?.currentProfile.toUpperCase()} PROFILE ACTIVE` : "UNHARDENED"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--axon-muted)]">
              Core {audit?.core.version} · Prefix <span className="mono font-semibold text-[var(--axon-text)]">{feat.tablePrefix}</span>
            </p>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="ghost" className="text-xs py-0.5 px-2" onClick={loadAudit}>
                ↻ Re-audit
              </Button>
              {audit?.currentProfile !== "none" && (
                <Button variant="danger" className="text-xs py-0.5 px-2" onClick={() => setConfirmRollback(true)}>
                  ↺ Rollback
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Hardening Profiles Card */}
        <div className="md:col-span-2 rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">Hardening Profiles</h4>
              <p className="text-[11px] text-[var(--axon-muted)]">
                One-click bundled profiles. You can also toggle individual features granularly below.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button
              onClick={() => handlePreview("basic")}
              disabled={previewLoading}
              className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-2.5 text-left transition hover:border-[var(--axon-primary)]/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-text)]">1. Basic</span>
                <span className="text-[10px] text-emerald-400">Zero Risk</span>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)] mt-1 line-clamp-2">
                Disallow file editing, disable debug display, protect wp-config.php & sensitive files.
              </p>
            </button>

            <button
              onClick={() => handlePreview("advanced")}
              disabled={previewLoading}
              className="rounded-lg border border-[var(--axon-primary)]/30 bg-[var(--axon-primary)]/5 p-2.5 text-left transition hover:border-[var(--axon-primary)]"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-primary)]">2. Advanced</span>
                <Badge tone="ok">Recommended</Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)] mt-1 line-clamp-2">
                Block upload PHP execution, restrict XML-RPC, rate limit wp-login, strict headers & permissions.
              </p>
            </button>

            <button
              onClick={() => handlePreview("strict")}
              disabled={previewLoading}
              className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-2.5 text-left transition hover:border-amber-500/50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-text)]">3. Strict</span>
                <span className="text-[10px] text-amber-400">High Lockdown</span>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)] mt-1 line-clamp-2">
                Block author enumeration, conceal version files, strict CSP frame protection.
              </p>
            </button>
          </div>
        </div>
      </div>

      {/* Vulnerabilities Alert Banner */}
      {audit && audit.vulnerabilities.vulnerableCount > 0 && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
            <span>⚠️</span> Known Component Vulnerabilities Detected ({audit.vulnerabilities.vulnerableCount})
          </div>
          <p className="text-xs text-rose-200/80 mt-1">
            The following installed components have known security advisories in our maintained vulnerability database:
          </p>
          <div className="mt-3 space-y-2">
            {audit.vulnerabilities.vulnerabilities.map((v, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded bg-black/20 p-2 text-xs">
                <div>
                  <span className="font-semibold text-white capitalize">{v.component}</span> (v{v.installedVersion}) ·{" "}
                  <span className="text-amber-300 font-mono">{v.cve}</span>: {v.title}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={v.severity === "critical" ? "bad" : "warn"}>{v.severity.toUpperCase()}</Badge>
                  <span className="text-[11px] text-slate-300">Fixed in v{v.fixedVersion}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 1 & 2: Database Prefix & Salt Keys Action Grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 1. Database Prefix Change Card */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">
                1. Database Table Prefix
              </span>
              <Badge tone={feat.isDefaultPrefix ? "bad" : "ok"}>
                {feat.isDefaultPrefix ? "Default (wp_)" : "Custom & Hardened"}
              </Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-lg font-bold font-mono text-[var(--axon-primary)]">{feat.tablePrefix}</span>
              <span className="text-xs text-[var(--axon-muted)]">active prefix in MySQL & wp-config.php</span>
            </div>
            <p className="text-xs text-[var(--axon-muted)] mt-1.5 leading-relaxed">
              Default <code className="mono text-white">wp_</code> prefixes make your database predictable and targetable by automated SQL injection exploits. Changing it renames all database tables, updates usermeta permissions, and modifies <code className="mono text-white">wp-config.php</code>.
            </p>
          </div>
          <div className="pt-2">
            <Button
              variant="secondary"
              className="w-full text-xs"
              onClick={() => {
                generateRandomPrefix();
                setPrefixModalOpen(true);
              }}
            >
              🛠 Change Database Prefix
            </Button>
          </div>
        </div>

        {/* 2. Salt Keys Change Card */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">
                2. Authentication Salt Keys
              </span>
              <Badge tone="ok">8 Secret Keys Configured</Badge>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-sm font-semibold text-[var(--axon-text)]">WordPress Security Keys & Salts</span>
            </div>
            <p className="text-xs text-[var(--axon-muted)] mt-1.5 leading-relaxed">
              Cryptographic keys (<code className="mono text-[11px] text-slate-300">AUTH_KEY</code>, <code className="mono text-[11px] text-slate-300">NONCE_KEY</code>, etc.) encrypt user sessions and passwords. Regenerating them invalidates all active cookies and forces all logged-in users to re-authenticate immediately.
            </p>
          </div>
          <div className="pt-2">
            <Button
              variant="secondary"
              className="w-full text-xs"
              onClick={() => setSaltsConfirmOpen(true)}
              loading={regeneratingSalts}
            >
              🔄 Regenerate Salt Keys (Logout All Users)
            </Button>
          </div>
        </div>
      </div>

      {/* Granular Security Features Management Table */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] overflow-hidden">
        <header className="border-b border-[var(--axon-border)] px-4 py-3 bg-[var(--axon-card-hover)] flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-text)]">
              Security Features & Protection Toggles
            </h4>
            <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
              Enable or disable individual WordPress core constants and Nginx server rules in real-time.
            </p>
          </div>
          <span className="text-[11px] text-[var(--axon-muted)]">Real-time live synchronization</span>
        </header>

        <div className="divide-y divide-[var(--axon-border)] text-xs">
          {/* Feature 3: WP Debug Mode */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">3. WordPress Debug Mode (WP_DEBUG)</span>
                <Badge tone={feat.wpDebug.enabled ? "warn" : "ok"}>
                  {feat.wpDebug.enabled ? "Debug Active (Dev)" : "Disabled (Production Clean)"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Controls PHP error reporting. In production, error display should be disabled so database credentials or server paths aren't leaked to visitors.
              </p>
              {feat.wpDebug.enabled && (
                <div className="flex flex-wrap items-center gap-4 pt-1.5 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={feat.wpDebug.log}
                      disabled={togglingFeature === "wp_debug_log"}
                      onChange={(e) => handleToggleFeature("wp_debug_log", e.target.checked)}
                      className="rounded border-[var(--axon-border)]"
                    />
                    <span>Log to <code className="mono text-amber-300">/wp-content/debug.log</code> (WP_DEBUG_LOG)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                    <input
                      type="checkbox"
                      checked={feat.wpDebug.display}
                      disabled={togglingFeature === "wp_debug_display"}
                      onChange={(e) => handleToggleFeature("wp_debug_display", e.target.checked)}
                      className="rounded border-[var(--axon-border)]"
                    />
                    <span>Display errors in HTML (WP_DEBUG_DISPLAY)</span>
                  </label>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.wpDebug.enabled}
                loading={togglingFeature === "wp_debug"}
                onChange={(checked) => handleToggleFeature("wp_debug", checked)}
              />
            </div>
          </div>

          {/* Feature 4: File Edit Mode */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">4. Block Dashboard File Editing (DISALLOW_FILE_EDIT)</span>
                <Badge tone={feat.disallowFileEdit ? "ok" : "bad"}>
                  {feat.disallowFileEdit ? "Blocked (Secure)" : "Editing Allowed (Risky)"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Disables the built-in theme and plugin code editor in the WordPress dashboard. Prevents attackers who gain admin access from writing webshells.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.disallowFileEdit}
                loading={togglingFeature === "file_edit"}
                onChange={(checked) => handleToggleFeature("file_edit", checked)}
              />
            </div>
          </div>

          {/* Feature 5: XML-RPC */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">5. Block XML-RPC (/xmlrpc.php)</span>
                <Badge tone={feat.blockXmlrpc ? "ok" : "warn"}>
                  {feat.blockXmlrpc ? "Blocked (Secure)" : "Publicly Open"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Denies all incoming requests to <code className="mono text-white">/xmlrpc.php</code> in Nginx. Completely eliminates XML-RPC pingback DDoS amplification and brute-force password guessing.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockXmlrpc}
                loading={togglingFeature === "xmlrpc"}
                onChange={(checked) => handleToggleFeature("xmlrpc", checked)}
              />
            </div>
          </div>

          {/* Feature 6: PHP Execution in Uploads */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">6. Block PHP Execution in Uploads (/wp-content/uploads/)</span>
                <Badge tone={feat.blockUploadPhp ? "ok" : "bad"}>
                  {feat.blockUploadPhp ? "Execution Blocked (Secure)" : "Execution Allowed (Vulnerable)"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Nginx rule that denies direct execution of any <code className="mono text-white">.php</code> files located inside <code className="mono text-white">/wp-content/uploads/</code> or <code className="mono text-white">/files/</code>. Even if a rogue plugin permits file upload, execution is completely blocked.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockUploadPhp}
                loading={togglingFeature === "upload_php"}
                onChange={(checked) => handleToggleFeature("upload_php", checked)}
              />
            </div>
          </div>

          {/* Feature 7: Direct Access to wp-config.php */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">Protect wp-config.php in Nginx</span>
                <Badge tone={feat.blockWpConfig ? "ok" : "warn"}>
                  {feat.blockWpConfig ? "Deny All (Protected)" : "Default Handling"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Explicitly denies all direct HTTP requests to <code className="mono text-white">/wp-config.php</code> in Nginx configuration, preventing source code exposure.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockWpConfig}
                loading={togglingFeature === "wp_config_protection"}
                onChange={(checked) => handleToggleFeature("wp_config_protection", checked)}
              />
            </div>
          </div>

          {/* Feature 8: Block Sensitive Files */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">Block Sensitive Files (.env, .sql, .bak, .log, .sh)</span>
                <Badge tone={feat.blockSensitiveFiles ? "ok" : "bad"}>
                  {feat.blockSensitiveFiles ? "Blocked (Secure)" : "Exposed"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Nginx pattern block denying public download of database dumps, backup configurations, git metadata, and environment secrets.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockSensitiveFiles}
                loading={togglingFeature === "sensitive_files"}
                onChange={(checked) => handleToggleFeature("sensitive_files", checked)}
              />
            </div>
          </div>

          {/* Feature 9: Block Author Username Enumeration */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">Block Author Username Enumeration (?author=N)</span>
                <Badge tone={feat.blockAuthorScan ? "ok" : "neutral"}>
                  {feat.blockAuthorScan ? "Enumeration Blocked" : "Open to Query Scans"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Blocks queries like <code className="mono text-white">/?author=1</code> which automated botnets use to scrape administrator logins and prepare brute-force campaigns.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockAuthorScan}
                loading={togglingFeature === "author_enumeration"}
                onChange={(checked) => handleToggleFeature("author_enumeration", checked)}
              />
            </div>
          </div>

          {/* Feature 10: Conceal Distribution & Version Files */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">Conceal Version Files (readme.html, license.txt)</span>
                <Badge tone={feat.blockVersionDisclosure ? "ok" : "neutral"}>
                  {feat.blockVersionDisclosure ? "Concealed (403 Forbidden)" : "Publicly Readable"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Blocks access to default WordPress distribution files that reveal exact version numbers to reconnaissance scanners.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockVersionDisclosure}
                loading={togglingFeature === "version_disclosure"}
                onChange={(checked) => handleToggleFeature("version_disclosure", checked)}
              />
            </div>
          </div>

          {/* Feature 11: HTTP Security Headers */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">HTTP Security Headers (OWASP Recommended)</span>
                <Badge tone={feat.securityHeaders ? "ok" : "warn"}>
                  {feat.securityHeaders ? "Active (SAMEORIGIN, nosniff)" : "Missing Headers"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Injects <code className="mono text-white">X-Frame-Options: SAMEORIGIN</code> (prevents clickjacking), <code className="mono text-white">X-Content-Type-Options: nosniff</code> (prevents MIME sniffing), and Referrer-Policy headers.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.securityHeaders}
                loading={togglingFeature === "security_headers"}
                onChange={(checked) => handleToggleFeature("security_headers", checked)}
              />
            </div>
          </div>

          {/* Feature 12: Block REST API User Enumeration */}
          <div className="flex items-center justify-between p-4 hover:bg-[var(--axon-card-hover)] transition">
            <div className="space-y-1 pr-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-[var(--axon-text)]">Block REST API User Enumeration (/wp-json/wp/v2/users)</span>
                <Badge tone={feat.blockRestApiUsers ? "ok" : "neutral"}>
                  {feat.blockRestApiUsers ? "REST Users Blocked" : "REST Users Queryable"}
                </Badge>
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Denies requests to the WordPress REST API users endpoint, preventing scrapers from gathering full author user lists.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={feat.blockRestApiUsers}
                loading={togglingFeature === "rest_api_users"}
                onChange={(checked) => handleToggleFeature("rest_api_users", checked)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Malware & Core Integrity Deep Scanner */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--axon-text)]">Malware & Suspicious File Scanner</h4>
            <p className="text-xs text-[var(--axon-muted)]">
              Scans wp-content, uploads, and core files for unauthorized PHP scripts and known webshell patterns.
            </p>
          </div>
          <Button variant="primary" loading={scanningMalware} onClick={handleRunMalwareScan}>
            🔍 Run Deep Malware Scan
          </Button>
        </div>

        {malwareScan && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-[var(--axon-border)] p-3">
                <p className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Core Checksums</p>
                <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
                  {malwareScan.checksumPass ? "✅ All Core Files Clean" : `⚠️ ${malwareScan.checksumMismatches?.length} Mismatches`}
                </p>
              </div>
              <div className="rounded-lg border border-[var(--axon-border)] p-3">
                <p className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Suspicious Patterns</p>
                <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
                  {malwareScan.suspiciousFilesCount === 0 ? "✅ No Suspicious Patterns Found" : `🚨 ${malwareScan.suspiciousFilesCount} Suspicious Files`}
                </p>
              </div>
            </div>

            {malwareScan.suspiciousFiles?.length > 0 && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs">
                <p className="font-semibold text-rose-300 mb-2">Flagged Files:</p>
                <ul className="list-disc list-inside space-y-1 text-rose-200">
                  {malwareScan.suspiciousFiles.map((f: any, i: number) => (
                    <li key={i} className="mono">
                      {f.path} - <span className="text-white">{f.label}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-[11px] text-slate-400">
              <span className="font-bold text-slate-300">Scanner Disclaimer: </span>
              {malwareScan.disclaimer}
            </div>
          </div>
        )}
      </div>

      {/* Modal 1: Change Database Prefix Modal */}
      <Modal
        open={prefixModalOpen}
        title={`Change Database Table Prefix · ${siteName}`}
        onClose={() => setPrefixModalOpen(false)}
        width="max-w-md"
      >
        <div className="space-y-4">
          <p className="text-xs text-[var(--axon-muted)]">
            Changing your database table prefix enhances security by mitigating automated SQL injections. Axon Panel will rename all existing tables, update user permissions in usermeta and options, and adjust <code className="mono text-white">wp-config.php</code>.
          </p>

          <div className="rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] p-3 space-y-1">
            <span className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Current Database Prefix</span>
            <p className="font-mono text-sm font-bold text-[var(--axon-text)]">{feat.tablePrefix}</p>
          </div>

          <Field label="New Table Prefix" hint="Must end with an underscore (e.g. wp_x9k2_)">
            <div className="flex items-center gap-2">
              <input
                className="field mono text-xs flex-1"
                placeholder="wp_sec7_"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value)}
                required
              />
              <Button variant="ghost" onClick={generateRandomPrefix} type="button" className="text-xs whitespace-nowrap">
                🎲 Random
              </Button>
            </div>
          </Field>

          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-[11px] text-amber-200 space-y-1">
            <p className="font-semibold">⚠️ Safety Notice:</p>
            <p>
              An automated backup of <code className="mono">wp-config.php</code> is stored before execution. Do not interrupt this operation while running.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button onClick={() => setPrefixModalOpen(false)} disabled={changingPrefix}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={changingPrefix}
              onClick={handleChangePrefix}
              disabled={!newPrefix.trim() || newPrefix.trim() === feat.tablePrefix}
            >
              Rename Tables & Update Prefix
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal 2: Salt Keys Confirmation Dialog */}
      <ConfirmDialog
        open={saltsConfirmOpen}
        title="Regenerate WordPress Security Salt Keys?"
        message={
          <>
            Regenerating secret keys and salts in <span className="mono text-amber-300">wp-config.php</span> will immediately <strong>invalidate all active sessions, authentication cookies, and API tokens</strong> for <span className="mono text-amber-300">{siteName}</span>.
            <br /><br />
            All logged-in users (including administrators) will be logged out and will need to sign in again.
          </>
        }
        confirmLabel="Regenerate Keys & Logout Sessions"
        busy={regeneratingSalts}
        onCancel={() => setSaltsConfirmOpen(false)}
        onConfirm={handleRegenerateSalts}
      />

      {/* Preview Changes Modal */}
      {preview && (
        <Modal
          open={Boolean(preview)}
          title={`Preview Hardening Changes: ${preview.profile.toUpperCase()} Profile`}
          onClose={() => setPreview(null)}
          width="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--axon-primary)]/30 bg-[var(--axon-primary)]/10 p-3 text-xs text-[var(--axon-primary)]">
              <p className="font-semibold">Compatibility Analysis:</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px]">
                {preview.compatibilityImpact.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-2">
                Proposed Changes ({preview.changesCount}):
              </h5>
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] divide-y divide-[var(--axon-border)] text-xs">
                {preview.changes.map((c, i) => (
                  <div key={i} className="p-2.5 flex items-center justify-between">
                    <span className="text-[var(--axon-text)] font-medium">{c.change}</span>
                    <Badge tone="info">{c.target}</Badge>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-[var(--axon-muted)]">
              Before applying, Axon Panel automatically creates a timestamped configuration backup in{" "}
              <span className="mono">/var/backups/axon-panel/wp-security/</span>. If Nginx validation fails, changes are
              automatically rolled back.
            </p>

            <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
              <Button onClick={() => setPreview(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => setConfirmApply(true)}>
                Confirm & Apply Profile
              </Button>
            </footer>
          </div>
        </Modal>
      )}

      {/* Confirmation Dialogs for Hardening Profiles */}
      <ConfirmDialog
        open={confirmApply}
        title={`Apply ${selectedProfile.toUpperCase()} Security Hardening?`}
        message={`This will update wp-config.php and Nginx site configuration for ${siteName}. An automated rollback point will be created.`}
        confirmLabel="Apply Hardening Now"
        busy={busy}
        onCancel={() => setConfirmApply(false)}
        onConfirm={handleApply}
      />

      <ConfirmDialog
        open={confirmRollback}
        title="Rollback Security Hardening?"
        message="This will restore the previous wp-config.php and Nginx virtual host configurations from the pre-hardening backup and reload Nginx."
        confirmLabel="Rollback to Previous Config"
        busy={busy}
        onCancel={() => setConfirmRollback(false)}
        onConfirm={handleRollback}
      />
    </div>
  );
}
