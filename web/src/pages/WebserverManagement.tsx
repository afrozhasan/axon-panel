import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Modal, Spinner, useAsyncAction, useToast } from "../components/ui";

type WebserverStatus = {
  active: boolean;
  version: string;
  test: { ok: boolean; error: string | null };
  processCount: number;
  confPath: string;
};

type WebserverConfig = {
  path: string;
  content: string;
  settings: {
    server_tokens: string;
    client_max_body_size: string;
    keepalive_timeout: string;
    gzip: string;
  };
};

type VersionItem = {
  raw: string;
  displayVersion: string;
  channel: string;
  channelLabel: string;
  priority: number;
  isCurrent: boolean;
};

type VersionsResponse = {
  currentVersion: string;
  currentRaw: string;
  currentChannel: string;
  versions: VersionItem[];
};

const CHANNEL_INFO: Record<string, { label: string; icon: string; desc: string }> = {
  stable: {
    label: "Official Stable (1.30.x)",
    icon: "🟢",
    desc: "Recommended for production. Long-term stability, security backports, and bug fixes.",
  },
  mainline: {
    label: "Official Mainline (1.31.x)",
    icon: "🚀",
    desc: "Active development upstream branch. Newest performance improvements and experimental HTTP/3.",
  },
  "legacy-1.28": {
    label: "Legacy Stable (1.28.x)",
    icon: "📦",
    desc: "Previous generation stable branch for backwards compatibility.",
  },
  "legacy-1.26": {
    label: "Legacy Stable (1.26.x)",
    icon: "📦",
    desc: "Older stable branch for legacy configurations.",
  },
  distro: {
    label: "Ubuntu LTS Distro (1.24.x)",
    icon: "🐧",
    desc: "Canonical's default Ubuntu 24.04 Noble LTS package.",
  },
};

export default function WebserverManagement() {
  const [status, setStatus] = useState<WebserverStatus | null>(null);
  const [config, setConfig] = useState<WebserverConfig | null>(null);
  const [rawConfig, setRawConfig] = useState<string>("");
  const [editingConfig, setEditingConfig] = useState(false);

  // Versions
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [versionsData, setVersionsData] = useState<VersionsResponse | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string>("stable");
  const [selectedVersion, setSelectedVersion] = useState<string>("");
  const [switchingVersion, setSwitchingVersion] = useState(false);

  // Logs
  const [logType, setLogType] = useState<"access" | "error">("access");
  const [logLines, setLogLines] = useState<number>(100);
  const [filterText, setFilterText] = useState<string>("");
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const { busy, run } = useAsyncAction();
  const toast = useToast();

  const loadStatus = async () => {
    try {
      const s = await api.get<WebserverStatus>("/webserver/status");
      setStatus(s);
    } catch (e: any) {
      toast("error", e.message || "Failed to load Nginx status");
    }
  };

  const loadConfig = async () => {
    try {
      const c = await api.get<WebserverConfig>("/webserver/config");
      setConfig(c);
      setRawConfig(c.content);
    } catch {}
  };

  const loadVersions = async () => {
    try {
      const v = await api.get<VersionsResponse>("/webserver/versions");
      setVersionsData(v);
      if (v.currentChannel) {
        setSelectedChannel(v.currentChannel);
      }
      if (v.currentRaw) {
        setSelectedVersion(v.currentRaw);
      }
    } catch (e: any) {
      toast("error", e.message || "Failed to load NGINX version options");
    }
  };

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const res = await api.get<{ lines: string[] }>(`/webserver/logs?type=${logType}&lines=${logLines}`);
      setLogs(res.lines);
    } catch (e: any) {
      toast("error", e.message || "Failed to load logs");
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadStatus();
    loadConfig();
    loadVersions();
  }, []);

  useEffect(() => {
    loadLogs();
  }, [logType, logLines]);

  const handleAction = (action: "test" | "reload" | "restart") => {
    run(async () => {
      const res = await api.post<{ ok: boolean; error?: string; message?: string }>("/webserver/action", { action });
      if (action === "test") {
        if (res.ok) toast("ok", "Nginx configuration test passed: syntax is ok");
        else toast("error", `Configuration error: ${res.error}`);
      } else {
        toast("ok", res.message || `Nginx ${action}ed`);
      }
      await loadStatus();
    });
  };

  const handleSaveConfig = () => {
    run(async () => {
      await api.post("/webserver/config", { content: rawConfig });
      setEditingConfig(false);
      await loadStatus();
      await loadConfig();
    }, "nginx.conf validated and saved successfully");
  };

  const handleSwitchVersion = async () => {
    if (!selectedVersion) return;
    setSwitchingVersion(true);
    try {
      const res = await api.post<{ ok: boolean; version?: string; message?: string }>("/webserver/switch-version", {
        version: selectedVersion,
        channel: selectedChannel,
      });
      toast("ok", res.message || `NGINX switched to ${selectedVersion}`);
      setVersionModalOpen(false);
      await loadStatus();
      await loadVersions();
    } catch (e: any) {
      toast("error", e.message || "Failed to switch NGINX version");
    } finally {
      setSwitchingVersion(false);
    }
  };

  const availableVersionsInChannel = versionsData?.versions.filter((v) => v.channel === selectedChannel) || [];

  const filteredLogs = filterText
    ? logs.filter((l) => l.toLowerCase().includes(filterText.toLowerCase()))
    : logs;

  if (!status) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-400">
        <Spinner /> Loading web server state…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--axon-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-2xl">🌍</span> Web Server (Nginx) Management
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Monitor Nginx daemon health, switch release channels & versions, edit configurations, and inspect traffic logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setVersionModalOpen(true)} disabled={busy}>
            ⚙️ Change Version
          </Button>
          <Button variant="secondary" onClick={() => handleAction("test")} disabled={busy}>
            Test Syntax
          </Button>
          <Button variant="secondary" onClick={() => handleAction("reload")} disabled={busy}>
            Reload
          </Button>
          <Button variant="primary" onClick={() => handleAction("restart")} disabled={busy}>
            Restart
          </Button>
        </div>
      </div>

      {/* Status Highlights */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <p className="text-xs text-slate-400">Server Status</p>
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${status.active ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
            <span className="text-base font-bold text-slate-100">{status.active ? "Active (Running)" : "Stopped"}</span>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">Nginx Version</p>
              <Badge tone="info">
                {versionsData?.currentChannel ? versionsData.currentChannel.toUpperCase() : "STABLE"}
              </Badge>
            </div>
            <p className="mt-2 text-base font-bold text-slate-100">{status.version}</p>
          </div>
          <button
            onClick={() => setVersionModalOpen(true)}
            className="mt-2 text-left text-xs font-medium text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1"
          >
            <span>Change Version →</span>
          </button>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <p className="text-xs text-slate-400">Active Worker Processes</p>
          <p className="mt-2 text-base font-bold text-slate-100">{status.processCount} processes</p>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <p className="text-xs text-slate-400">Configuration Syntax</p>
          <div className="mt-2">
            <Badge tone={status.test.ok ? "ok" : "bad"}>
              {status.test.ok ? "Syntax OK" : "Syntax Error"}
            </Badge>
          </div>
        </div>
      </div>

      {/* Global Settings & nginx.conf */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Key Settings */}
        <Card title="Quick Directives" subtitle="Global HTTP parameters in nginx.conf">
          {config?.settings ? (
            <div className="space-y-3 text-xs">
              <div className="flex justify-between border-b border-[var(--axon-border)] pb-2">
                <span className="text-slate-400">server_tokens</span>
                <span className="mono text-slate-200">{config.settings.server_tokens}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--axon-border)] pb-2">
                <span className="text-slate-400">client_max_body_size</span>
                <span className="mono text-slate-200">{config.settings.client_max_body_size}</span>
              </div>
              <div className="flex justify-between border-b border-[var(--axon-border)] pb-2">
                <span className="text-slate-400">keepalive_timeout</span>
                <span className="mono text-slate-200">{config.settings.keepalive_timeout}s</span>
              </div>
              <div className="flex justify-between pb-1">
                <span className="text-slate-400">gzip compression</span>
                <span className="mono text-slate-200">{config.settings.gzip}</span>
              </div>
            </div>
          ) : (
            <div className="text-xs text-slate-500">Loading settings…</div>
          )}
        </Card>

        {/* nginx.conf Editor */}
        <div className="lg:col-span-2">
          <Card
            title="Global Configuration File"
            subtitle="/etc/nginx/nginx.conf"
            actions={
              editingConfig ? (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditingConfig(false)}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={handleSaveConfig} disabled={busy}>
                    Test & Save
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => setEditingConfig(true)}>
                  Edit Configuration
                </Button>
              )
            }
          >
            <textarea
              disabled={!editingConfig}
              value={rawConfig}
              onChange={(e) => setRawConfig(e.target.value)}
              rows={12}
              className="mono w-full rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3 text-xs leading-relaxed text-slate-300 focus:border-indigo-500 focus:outline-none disabled:opacity-80"
              spellCheck={false}
            />
          </Card>
        </div>
      </div>

      {/* Logs Viewer */}
      <Card
        title="Web Server Logs"
        subtitle={`Live output from /var/log/nginx/${logType}.log`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-[var(--axon-border)] p-0.5 bg-[var(--axon-input-bg)]">
              <button
                onClick={() => setLogType("access")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  logType === "access" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Access Log
              </button>
              <button
                onClick={() => setLogType("error")}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  logType === "error" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Error Log
              </button>
            </div>
            <select
              value={logLines}
              onChange={(e) => setLogLines(Number(e.target.value))}
              className="rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1 text-xs text-slate-300 focus:outline-none"
            >
              <option value={50}>50 lines</option>
              <option value={100}>100 lines</option>
              <option value={250}>250 lines</option>
              <option value={500}>500 lines</option>
            </select>
            <Button size="sm" variant="secondary" onClick={loadLogs} disabled={loadingLogs}>
              Refresh
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <input
            type="text"
            placeholder="Filter log lines (regex or keyword)…"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
          />

          <div className="mono max-h-96 overflow-y-auto rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3 text-[11px] text-slate-300">
            {loadingLogs ? (
              <div className="py-8 text-center text-slate-500">
                <Spinner /> Fetching latest logs…
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-8 text-center text-slate-600">No log entries matched your filter.</div>
            ) : (
              filteredLogs.map((line, idx) => (
                <div key={idx} className="hover:bg-slate-900/60 py-0.5 border-b border-slate-900/40">
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </Card>

      {/* Version Switcher Modal */}
      <Modal
        open={versionModalOpen}
        title="Switch NGINX Web Server Version"
        onClose={() => setVersionModalOpen(false)}
        width="max-w-2xl"
      >
        <div className="space-y-5 text-xs text-slate-300">
          {/* Current Running Info */}
          <div className="flex items-center justify-between rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3.5">
            <div>
              <p className="font-semibold text-slate-100">Currently Active Version</p>
              <p className="mt-0.5 text-slate-400">
                Active binary: <span className="mono text-indigo-300 font-semibold">{status.version}</span>
              </p>
            </div>
            <Badge tone="ok">RUNNING</Badge>
          </div>

          {/* Channel Selector */}
          <div>
            <label className="mb-2 block font-medium text-slate-200">
              Select Release Channel:
            </label>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {Object.entries(CHANNEL_INFO).map(([chKey, chInfo]) => {
                const isSelected = selectedChannel === chKey;
                const isCurrent = versionsData?.currentChannel === chKey;
                return (
                  <button
                    key={chKey}
                    type="button"
                    onClick={() => {
                      setSelectedChannel(chKey);
                      const matching = versionsData?.versions.filter((v) => v.channel === chKey) || [];
                      if (matching.length > 0) {
                        setSelectedVersion(matching[0].raw);
                      }
                    }}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-950/30 text-white ring-1 ring-indigo-500"
                        : "border-[var(--axon-border)] bg-[#0d121d] text-slate-300 hover:border-slate-700 hover:bg-[var(--axon-card-hover)] transition-colors"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold flex items-center gap-1.5">
                        <span>{chInfo.icon}</span> {chInfo.label}
                      </span>
                      {isCurrent && <Badge tone="info">CURRENT</Badge>}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 leading-snug">{chInfo.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Specific Version Dropdown */}
          <div>
            <label className="mb-1.5 block font-medium text-slate-200">
              Select Specific Package Version ({availableVersionsInChannel.length} available):
            </label>
            <select
              value={selectedVersion}
              onChange={(e) => setSelectedVersion(e.target.value)}
              className="w-full rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-2.5 text-xs text-slate-100 focus:border-indigo-500 focus:outline-none mono"
            >
              {availableVersionsInChannel.map((v) => (
                <option key={v.raw} value={v.raw}>
                  {v.raw} {v.isCurrent ? "— [CURRENTLY INSTALLED]" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Safety Guarantees Notice */}
          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3 text-[11px] text-slate-400 space-y-1.5">
            <p className="font-semibold text-slate-200">🛡️ Automated Safety & Rollback Protection:</p>
            <ul className="list-disc list-inside space-y-1 text-slate-400 pl-1">
              <li>Automatic snapshot of <span className="mono text-slate-300">/etc/nginx</span> prior to installation.</li>
              <li>Virtual hosts, SSL certificates, and PHP fastcgi configurations are fully preserved.</li>
              <li>Syntax validation (<span className="mono text-slate-300">nginx -t</span>) is executed before completing.</li>
              <li>Instant zero-downtime rollback triggered automatically if the target binary fails configuration validation.</li>
            </ul>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--axon-border)]">
            <Button variant="secondary" onClick={() => setVersionModalOpen(false)} disabled={switchingVersion}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={switchingVersion}
              onClick={handleSwitchVersion}
              disabled={switchingVersion || !selectedVersion || selectedVersion === versionsData?.currentRaw}
            >
              {selectedVersion === versionsData?.currentRaw ? "Already Running This Version" : "Switch Version & Restart"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
