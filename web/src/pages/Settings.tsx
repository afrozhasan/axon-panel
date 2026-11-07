import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { useApp } from "../lib/app-context";
import { formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBanner,
  Field,
  Spinner,
  Tabs,
  useAsyncAction,
  useToast,
} from "../components/ui";

type AuditEntry = {
  at: string;
  actor: string;
  ip: string | null;
  action: string;
  result: string;
  params: Record<string, unknown>;
  detail: string | null;
};

type SettingsResponse = {
  config: {
    panelDomain: string;
    adminUser: string;
    sessionHours: number;
    ipAllowlist: string[];
    allowedRoots: string[];
    backupDir: string;
    letsencryptEmail: string;
    phpFpmSocket: string;
    port: number;
    totpEnabled: boolean;
    maxUploadMb: number;
  };
  runtime: { node: string; uptimeSeconds: number; memoryBytes: number; pid: number };
  allowlistSnippet: boolean;
  backupDirExists: boolean;
};

type TwoFactorSetup = {
  secret: string;
  uri: string;
  qrCode?: string;
};

export default function Settings() {
  const location = useLocation();
  const searchTab = new URLSearchParams(location.search).get("tab");
  const [tab, setTab] = useState(searchTab && ["panel", "security", "access", "audit"].includes(searchTab) ? searchTab : "panel");
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    panelDomain: "",
    letsencryptEmail: "",
    sessionHours: 12,
    phpFpmSocket: "",
    backupDir: "",
    maxUploadMb: 512,
    adminUser: "",
  });
  const [allowlist, setAllowlist] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [twoFactor, setTwoFactor] = useState<TwoFactorSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();
  const app = useApp();

  const load = async () => {
    try {
      const result = await api.get<SettingsResponse>("/settings");
      setData(result);
      setForm({
        panelDomain: result.config.panelDomain,
        letsencryptEmail: result.config.letsencryptEmail,
        sessionHours: result.config.sessionHours,
        phpFpmSocket: result.config.phpFpmSocket,
        backupDir: result.config.backupDir,
        maxUploadMb: result.config.maxUploadMb,
        adminUser: result.config.adminUser,
      });
      setAllowlist(result.config.ipAllowlist.join("\n"));
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab !== "audit") return;
    api
      .get<{ entries: AuditEntry[] }>("/settings/audit?limit=300")
      .then((result) => setAudit(result.entries.reverse()))
      .catch((caught) => toast("error", errorMessage(caught)));
  }, [tab]);

  if (loading || !data) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading settings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
        <p className="text-xs text-slate-500">
          Panel {data.config.panelDomain} · node {data.runtime.node} · pid {data.runtime.pid}
        </p>
      </div>

      <ErrorBanner message={error} />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "panel", label: "Panel" },
          { id: "security", label: "Security" },
          { id: "access", label: "Access control" },
          { id: "audit", label: "Audit log" },
        ]}
      />

      {tab === "panel" && (
        <Card title="General configuration">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Panel domain" hint="The hostname nginx serves this panel on">
              <input
                className="field mono"
                value={form.panelDomain}
                onChange={(event) => setForm({ ...form, panelDomain: event.target.value })}
              />
            </Field>
            <Field label="Admin username">
              <input
                className="field"
                value={form.adminUser}
                onChange={(event) => setForm({ ...form, adminUser: event.target.value })}
              />
            </Field>
            <Field label="Let's Encrypt email" hint="Used for certificate expiry notices">
              <input
                className="field"
                type="email"
                value={form.letsencryptEmail}
                onChange={(event) => setForm({ ...form, letsencryptEmail: event.target.value })}
              />
            </Field>
            <Field label="Session length (hours)" hint="Between 1 and 168">
              <input
                className="field"
                type="number"
                min={1}
                max={168}
                value={form.sessionHours}
                onChange={(event) => setForm({ ...form, sessionHours: Number(event.target.value) })}
              />
            </Field>
            <Field label="PHP-FPM socket" hint="Default socket for new PHP sites">
              <input
                className="field mono"
                value={form.phpFpmSocket}
                onChange={(event) => setForm({ ...form, phpFpmSocket: event.target.value })}
              />
            </Field>
            <Field label="Backup directory">
              <input
                className="field mono"
                value={form.backupDir}
                onChange={(event) => setForm({ ...form, backupDir: event.target.value })}
              />
            </Field>
            <Field label="Maximum upload (MB)" hint="Applies to SQL restores and file uploads">
              <input
                className="field"
                type="number"
                min={1}
                max={4096}
                value={form.maxUploadMb}
                onChange={(event) => setForm({ ...form, maxUploadMb: Number(event.target.value) })}
              />
            </Field>
          </div>
          <footer className="mt-4 flex justify-end">
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                await run(async () => {
                  const result = await api.put<{ config: SettingsResponse["config"] }>("/settings", {
                    panelDomain: form.panelDomain,
                    adminUser: form.adminUser,
                    letsencryptEmail: form.letsencryptEmail,
                    sessionHours: form.sessionHours,
                    phpFpmSocket: form.phpFpmSocket,
                    backupDir: form.backupDir,
                    maxUploadMb: form.maxUploadMb,
                  });
                  app.setConfig(result.config);
                  await load();
                }, "Settings saved");
              }}
            >
              Save settings
            </Button>
          </footer>
        </Card>
      )}

      {tab === "security" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs text-indigo-200">
            <div>
              <p className="font-semibold text-indigo-300">Looking for system firewall and server security?</p>
              <p className="mt-0.5 text-[11px] text-slate-300">
                Manage UFW firewall rules, Fail2Ban intrusion prevention, SSH hardening, and open ports scanner in the dedicated Security module.
              </p>
            </div>
            <Link
              to="/security"
              className="rounded-md border border-indigo-500/40 bg-indigo-600/30 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-600/50"
            >
              Security Settings →
            </Link>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Change password">
            <div className="space-y-3">
              <Field label="Current password">
                <input
                  className="field"
                  type="password"
                  value={passwords.current}
                  onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                />
              </Field>
              <Field label="New password" hint="Minimum 12 characters">
                <input
                  className="field"
                  type="password"
                  value={passwords.next}
                  onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
                />
              </Field>
              <Field label="Confirm new password">
                <input
                  className="field"
                  type="password"
                  value={passwords.confirm}
                  onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
                />
              </Field>
              <Button
                variant="primary"
                loading={busy}
                disabled={!passwords.current || passwords.next.length < 12 || passwords.next !== passwords.confirm}
                onClick={async () => {
                  await run(async () => {
                    await api.post("/auth/password", { current: passwords.current, next: passwords.next });
                    setPasswords({ current: "", next: "", confirm: "" });
                  }, "Password changed");
                }}
              >
                Change password
              </Button>
            </div>
          </Card>

          <Card
            title="Two-factor authentication"
            subtitle={data.config.totpEnabled ? "Enabled" : "Not enabled"}
            actions={<Badge tone={data.config.totpEnabled ? "ok" : "warn"}>{data.config.totpEnabled ? "on" : "off"}</Badge>}
          >
            {data.config.totpEnabled ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  A code from your authenticator app is required at sign-in. Disable it by confirming your password.
                </p>
                <Field label="Password">
                  <input
                    className="field"
                    type="password"
                    value={passwords.current}
                    onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
                  />
                </Field>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={!passwords.current}
                  onClick={async () => {
                    await run(async () => {
                      await api.post("/auth/2fa/disable", { password: passwords.current });
                      setPasswords({ ...passwords, current: "" });
                      await load();
                    }, "Two-factor disabled");
                  }}
                >
                  Disable two-factor
                </Button>
              </div>
            ) : twoFactor ? (
              <div className="space-y-4">
                <p className="text-xs text-slate-300">
                  Scan this QR code with your authenticator app (such as Google Authenticator, 1Password, or Authy), then enter the 6-digit verification code below.
                </p>

                {/* QR Code and Secret Container */}
                <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-4">
                  {twoFactor.qrCode && (
                    <div className="rounded-xl bg-white p-2.5 shrink-0 shadow-lg border border-slate-200">
                      <img
                        src={twoFactor.qrCode}
                        alt="2FA QR Code"
                        className="h-44 w-44 block"
                      />
                    </div>
                  )}
                  <div className="space-y-2.5 min-w-0 flex-1">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-400">Authenticator Setup</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Open your authenticator app and point your phone camera at the QR code.
                      </p>
                    </div>

                    <div className="rounded-lg border border-[var(--axon-border)] bg-[#111823] p-3">
                      <p className="text-[10px] uppercase tracking-wide text-slate-500 font-medium">Manual Setup Key</p>
                      <p className="mono mt-1 select-all break-all text-xs font-bold text-amber-300 tracking-wider">
                        {twoFactor.secret}
                      </p>
                    </div>

                    <p className="mono break-all text-[10px] text-slate-500 leading-tight">
                      {twoFactor.uri}
                    </p>
                  </div>
                </div>

                <Field label="Verification code" hint="Enter the 6-digit code currently shown in your authenticator app">
                  <input
                    className="field mono text-lg font-bold tracking-[0.3em] max-w-xs"
                    placeholder="123456"
                    value={totpCode}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoFocus
                  />
                </Field>

                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    loading={busy}
                    disabled={totpCode.length !== 6}
                    onClick={async () => {
                      await run(async () => {
                        await api.post("/auth/2fa/enable", { token: totpCode });
                        setTwoFactor(null);
                        setTotpCode("");
                        await load();
                      }, "Two-factor authentication enabled successfully");
                    }}
                  >
                    Confirm & Enable 2FA
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setTwoFactor(null);
                      setTotpCode("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Protect this panel with a time-based one-time password (TOTP). Because the panel manages core server infrastructure, enabling this is strongly
                  recommended.
                </p>
                <Button
                  variant="primary"
                  loading={busy}
                  onClick={async () => {
                    await run(async () => {
                      const result = await api.post<TwoFactorSetup>("/auth/2fa/setup");
                      setTwoFactor(result);
                    }, "Scan the QR code with your authenticator");
                  }}
                >
                  Set up two-factor
                </Button>
              </div>
            )}
          </Card>
        </div>
      </div>
      )}

      {tab === "access" && (
        <div className="space-y-4">
          <Card
            title="IP allowlist"
            subtitle="Restricts who can reach the panel at the nginx layer"
          >
            <Field label="Allowed addresses" hint="One IP or CIDR per line. Leave empty to allow everyone.">
              <textarea
                className="field mono h-40 resize-y"
                placeholder={"203.0.113.4\n198.51.100.0/24"}
                value={allowlist}
                onChange={(event) => setAllowlist(event.target.value)}
              />
            </Field>
            <p className="mt-2 text-[11px] text-slate-500">
              {data.allowlistSnippet
                ? "The nginx snippet is installed and included in the panel vhost."
                : "The nginx snippet is not present yet — run install.sh to wire it into the panel vhost."}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                loading={busy}
                onClick={async () => {
                  await run(async () => {
                    const entries = allowlist
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    await api.put("/settings", { ipAllowlist: entries });
                    await load();
                  }, "Allowlist saved");
                }}
              >
                Save list
              </Button>
              <Button
                variant="primary"
                loading={busy}
                onClick={async () => {
                  await run(async () => {
                    const entries = allowlist
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean);
                    await api.put("/settings", { ipAllowlist: entries });
                    await api.post("/settings/allowlist/apply");
                    await load();
                  }, "Allowlist applied to nginx");
                }}
              >
                Save and apply to nginx
              </Button>
            </div>
            <p className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/5 p-2.5 text-[11px] text-amber-200">
              Warning: adding an address that is not your own will lock you out of the panel. The application also enforces this list
              independently of nginx.
            </p>
          </Card>

          <Card title="Permitted directories" subtitle="Everything the file manager can touch">
            <ul className="grid gap-1.5 sm:grid-cols-2">
              {data.config.allowedRoots.map((root) => (
                <li key={root} className="mono rounded-md border border-[var(--axon-border)] px-2.5 py-1.5 text-[11px] text-slate-300">
                  {root}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "audit" && (
        <Card title="Audit log" subtitle="Every mutating action, newest first" bodyClassName="p-0">
          {audit.length === 0 ? (
            <EmptyState message="No audit entries yet" />
          ) : (
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10 bg-[var(--axon-card)]">
                  <tr>
                    <th className="th">When</th>
                    <th className="th">Action</th>
                    <th className="th">Actor</th>
                    <th className="th">IP</th>
                    <th className="th">Result</th>
                    <th className="th">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((entry, index) => (
                    <tr key={index} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                      <td className="td whitespace-nowrap text-[11px] text-slate-400">{formatDate(entry.at)}</td>
                      <td className="td mono text-[11px] text-slate-200">{entry.action}</td>
                      <td className="td text-[11px] text-slate-400">{entry.actor}</td>
                      <td className="td mono text-[11px] text-slate-500">{entry.ip ?? "—"}</td>
                      <td className="td">
                        <Badge tone={entry.result === "ok" ? "ok" : "bad"}>{entry.result}</Badge>
                      </td>
                      <td className="td max-w-md truncate text-[11px] text-slate-500" title={entry.detail ?? ""}>
                        {entry.detail ? entry.detail.split("\n")[0] : JSON.stringify(entry.params)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
