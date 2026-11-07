import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Spinner, useAsyncAction, useToast } from "../components/ui";

type PhpVersion = {
  version: string;
  service: string;
  status: string;
  socketExists: boolean;
  socketPath: string;
  iniExists: boolean;
  isDefaultCli: boolean;
  activeSitesCount: number;
};

type PhpData = {
  versions: PhpVersion[];
  availableToInstall: string[];
  defaultCli: string | null;
};

type Site = {
  name: string;
  kind: string;
  phpVersion: string | null;
};

type IniSettings = {
  upload_max_filesize: string;
  post_max_size: string;
  memory_limit: string;
  max_execution_time: string;
  max_input_time: string;
  display_errors: string;
  date_timezone: string;
};

type ExtensionItem = {
  name: string;
  label: string;
  category: string;
  description: string;
  pkg: string;
  installed: boolean;
  enabled: boolean;
};

const CATEGORIES = [
  "All",
  "Database",
  "Performance",
  "Web & API",
  "Media",
  "Data & Math",
  "Compression",
  "Text & Encoding",
  "Development",
  "Enterprise",
];

export default function PhpManagement() {
  const [data, setData] = useState<PhpData | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [selectedVer, setSelectedVer] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"extensions" | "ini">("extensions");

  // Settings
  const [iniSettings, setIniSettings] = useState<IniSettings | null>(null);
  const [editingIni, setEditingIni] = useState(false);

  // Extensions
  const [extensions, setExtensions] = useState<ExtensionItem[]>([]);
  const [loadingExts, setLoadingExts] = useState(false);
  const [togglingExt, setTogglingExt] = useState<string | null>(null);
  const [extSearch, setExtSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");

  // Install PHP
  const [installingVer, setInstallingVer] = useState<string | null>(null);

  // Switch site version state
  const [switchSite, setSwitchSite] = useState<string>("");
  const [switchTargetVer, setSwitchTargetVer] = useState<string>("");

  const { busy, run } = useAsyncAction();
  const toast = useToast();

  const load = async () => {
    try {
      const res = await api.get<PhpData>("/php");
      setData(res);
      if (res.versions.length > 0 && !selectedVer) {
        setSelectedVer(res.versions[0].version);
      }
      const sitesRes = await api.get<{ sites: Site[] }>("/sites");
      setSites(sitesRes.sites.filter((s) => s.kind === "php"));
    } catch (e: any) {
      toast("error", e.message || "Failed to load PHP data");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const loadVersionDetails = (ver: string) => {
    api
      .get<{ settings: IniSettings }>(`/php/${ver}/config`)
      .then((res) => setIniSettings(res.settings))
      .catch(() => setIniSettings(null));

    setLoadingExts(true);
    api
      .get<{ extensions: ExtensionItem[] }>(`/php/${ver}/extensions`)
      .then((res) => setExtensions(res.extensions || []))
      .catch(() => setExtensions([]))
      .finally(() => setLoadingExts(false));
  };

  useEffect(() => {
    if (!selectedVer) return;
    loadVersionDetails(selectedVer);
  }, [selectedVer]);

  const handleServiceAction = (version: string, action: "restart" | "reload" | "start" | "stop") => {
    run(async () => {
      await api.post("/php/service", { version, action });
      await load();
    }, `PHP ${version} ${action}ed successfully`);
  };

  const handleSaveIni = () => {
    if (!selectedVer || !iniSettings) return;
    run(async () => {
      await api.post(`/php/${selectedVer}/config`, { settings: iniSettings });
      setEditingIni(false);
      await load();
    }, `PHP ${selectedVer} configuration saved and FPM reloaded`);
  };

  const handleSwitchSite = () => {
    if (!switchSite || !switchTargetVer) return;
    run(async () => {
      await api.post("/php/switch-site", { site: switchSite, version: switchTargetVer });
      await load();
    }, `Switched ${switchSite} to PHP ${switchTargetVer}`);
  };

  const handleInstallPhp = (ver: string) => {
    setInstallingVer(ver);
    run(async () => {
      await api.post("/php/install", { version: ver });
      await load();
    }, `PHP ${ver} installed successfully`).finally(() => setInstallingVer(null));
  };

  const handleToggleExtension = async (ext: ExtensionItem) => {
    if (!selectedVer) return;
    const willEnable = !ext.enabled;
    setTogglingExt(ext.name);

    try {
      const res = await api.post<{ ok: boolean; message?: string }>(`/php/${selectedVer}/extensions/toggle`, {
        extension: ext.name,
        enable: willEnable,
      });

      // Update state locally
      setExtensions((prev) =>
        prev.map((item) =>
          item.name === ext.name ? { ...item, enabled: willEnable, installed: true } : item,
        ),
      );
      toast("ok", res.message || `${ext.label} ${willEnable ? "enabled" : "disabled"}`);
    } catch (e: any) {
      toast("error", e.message || `Failed to toggle ${ext.label}`);
    } finally {
      setTogglingExt(null);
    }
  };

  const applyPreset = async (presetName: string, extNames: string[]) => {
    if (!selectedVer) return;
    const toEnable = extNames.filter((name) => {
      const found = extensions.find((e) => e.name === name);
      return found && !found.enabled;
    });

    if (toEnable.length === 0) {
      toast("ok", `All ${presetName} extensions are already enabled`);
      return;
    }

    run(async () => {
      for (const name of toEnable) {
        setTogglingExt(name);
        await api.post(`/php/${selectedVer}/extensions/toggle`, {
          extension: name,
          enable: true,
        });
      }
      loadVersionDetails(selectedVer);
    }, `${presetName} extensions enabled for PHP ${selectedVer}`).finally(() => setTogglingExt(null));
  };

  const filteredExtensions = extensions.filter((ext) => {
    const matchesCategory = selectedCategory === "All" || ext.category === selectedCategory;
    const matchesSearch =
      !extSearch.trim() ||
      ext.name.toLowerCase().includes(extSearch.toLowerCase()) ||
      ext.label.toLowerCase().includes(extSearch.toLowerCase()) ||
      ext.description.toLowerCase().includes(extSearch.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const enabledCount = extensions.filter((e) => e.enabled).length;

  if (!data) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-400">
        <Spinner /> Loading PHP runtimes…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--axon-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-2xl">🐘</span> PHP Version & Runtime Management
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Manage PHP-FPM pools, select and toggle extensions, switch PHP version per site, configure php.ini directives.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="info">Default CLI: PHP {data.defaultCli ?? "8.3"}</Badge>
          <Button onClick={load} disabled={busy}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Installed PHP Versions Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {data.versions.map((v) => (
          <div
            key={v.version}
            onClick={() => setSelectedVer(v.version)}
            className={`cursor-pointer rounded-xl border p-4 transition-all ${
              selectedVer === v.version
                ? "border-indigo-500/60 bg-[var(--axon-card)] shadow-lg shadow-indigo-500/10"
                : "border-[var(--axon-border)] bg-[var(--axon-card)] hover:border-slate-700"
            }`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-100">PHP {v.version}</h3>
                  {v.isDefaultCli && <Badge tone="info">CLI Default</Badge>}
                </div>
                <p className="mono text-[11px] text-slate-500 mt-0.5">{v.service}</p>
              </div>
              <Badge tone={v.status === "active" ? "ok" : "bad"}>{v.status}</Badge>
            </div>

            <div className="mt-4 space-y-1.5 text-xs text-slate-400 border-t border-[var(--axon-border)] pt-3">
              <div className="flex justify-between">
                <span>Active Websites</span>
                <span className="font-semibold text-slate-200">{v.activeSitesCount} sites</span>
              </div>
              <div className="flex justify-between">
                <span>Socket</span>
                <span className="mono text-[11px] text-slate-300 truncate max-w-[140px]">{v.socketPath}</span>
              </div>
            </div>

            <div className="mt-4 flex gap-1.5 border-t border-[var(--axon-border)] pt-3" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleServiceAction(v.version, "restart")}
                disabled={busy}
              >
                Restart
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleServiceAction(v.version, "reload")}
                disabled={busy}
              >
                Reload
              </Button>
              {v.status === "active" ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleServiceAction(v.version, "stop")}
                  disabled={busy}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleServiceAction(v.version, "start")}
                  disabled={busy}
                >
                  Start
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Website PHP Switcher */}
      <Card
        title="Quick PHP Version Switcher"
        subtitle="Switch the active PHP interpreter for any website with automatic Nginx configuration reload."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-400 mb-1">Select Website</label>
            <select
              value={switchSite}
              onChange={(e) => setSwitchSite(e.target.value)}
              className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">-- Choose a PHP website --</option>
              {sites.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} (Current: PHP {s.phpVersion ?? "unknown"})
                </option>
              ))}
            </select>
          </div>

          <div className="w-48">
            <label className="block text-xs font-medium text-slate-400 mb-1">Target PHP Version</label>
            <select
              value={switchTargetVer}
              onChange={(e) => setSwitchTargetVer(e.target.value)}
              className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">-- Version --</option>
              {data.versions.map((v) => (
                <option key={v.version} value={v.version}>
                  PHP {v.version} ({v.status})
                </option>
              ))}
            </select>
          </div>

          <div className="pt-5">
            <Button
              variant="primary"
              onClick={handleSwitchSite}
              disabled={!switchSite || !switchTargetVer || busy}
            >
              Apply to Website
            </Button>
          </div>
        </div>
      </Card>

      {/* Selected Version Tabs: Extensions Selection vs php.ini */}
      {selectedVer && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab("extensions")}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "extensions"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200 bg-[var(--axon-card-hover)]"
                }`}
              >
                <span>🧩 Extensions Selector</span>
                <span className="rounded-full bg-indigo-950/60 px-2 py-0.5 text-[10px] font-bold text-indigo-200">
                  {enabledCount} active
                </span>
              </button>

              <button
                onClick={() => setActiveTab("ini")}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  activeTab === "ini"
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30"
                    : "text-slate-400 hover:text-slate-200 bg-[var(--axon-card-hover)]"
                }`}
              >
                <span>⚙️ php.ini Directives</span>
              </button>
            </div>

            <span className="text-xs text-slate-500 font-mono">
              Managing <strong>PHP {selectedVer}</strong>
            </span>
          </div>

          {/* TAB 1: Extensions Selection */}
          {activeTab === "extensions" && (
            <div className="space-y-4">
              {/* Presets and Filters */}
              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-400">Quick Presets:</span>
                    <button
                      onClick={() =>
                        applyPreset("WordPress", ["mysqli", "curl", "gd", "mbstring", "xml", "zip", "opcache", "intl"])
                      }
                      className="rounded border border-[var(--axon-border)] bg-[var(--axon-card)] px-2.5 py-1 text-xs text-slate-200 hover:border-indigo-500 hover:text-white transition-colors"
                    >
                      WordPress Recommended
                    </button>
                    <button
                      onClick={() =>
                        applyPreset("Laravel", ["pdo_mysql", "curl", "mbstring", "xml", "zip", "bcmath", "redis", "opcache", "intl"])
                      }
                      className="rounded border border-[var(--axon-border)] bg-[var(--axon-card)] px-2.5 py-1 text-xs text-slate-200 hover:border-indigo-500 hover:text-white transition-colors"
                    >
                      Laravel Recommended
                    </button>
                    <button
                      onClick={() =>
                        applyPreset("Full Stack", ["mysqli", "pdo_mysql", "sqlite3", "curl", "gd", "imagick", "mbstring", "xml", "zip", "bcmath", "redis", "opcache", "intl", "soap"])
                      }
                      className="rounded border border-[var(--axon-border)] bg-[var(--axon-card)] px-2.5 py-1 text-xs text-slate-200 hover:border-indigo-500 hover:text-white transition-colors"
                    >
                      Full Stack Suite
                    </button>
                  </div>

                  <input
                    type="text"
                    placeholder="Search extensions (e.g. redis, imagick, pdo)…"
                    value={extSearch}
                    onChange={(e) => setExtSearch(e.target.value)}
                    className="w-72 rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Category Pills */}
                <div className="flex flex-wrap gap-1.5 border-t border-[var(--axon-border)] pt-3">
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selectedCategory === cat
                          ? "bg-indigo-600 text-white"
                          : "border border-[var(--axon-border)] bg-[#101624] text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Extensions Grid */}
              {loadingExts ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  <Spinner /> Loading extension list…
                </div>
              ) : filteredExtensions.length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">
                  No extensions matched your search criteria.
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredExtensions.map((ext) => (
                    <div
                      key={ext.name}
                      className={`flex flex-col justify-between rounded-xl border p-3.5 transition-all ${
                        ext.enabled
                          ? "border-emerald-500/30 bg-[#0e181f]/40"
                          : "border-[var(--axon-border)] bg-[var(--axon-input-bg)] opacity-80"
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-1.5">
                              <h4 className="font-bold text-sm text-slate-100">{ext.label}</h4>
                              <span className="mono text-[10px] text-slate-500">({ext.name})</span>
                            </div>
                            <span className="inline-block mt-1 rounded bg-[#182236] px-2 py-0.5 text-[9px] font-medium text-slate-400">
                              {ext.category}
                            </span>
                          </div>

                          {/* Toggle Switch */}
                          <button
                            type="button"
                            disabled={togglingExt === ext.name || busy}
                            onClick={() => handleToggleExtension(ext)}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              ext.enabled ? "bg-emerald-500" : "bg-[#253248]"
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                ext.enabled ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </div>

                        <p className="mt-2 text-xs text-slate-400 leading-relaxed">{ext.description}</p>
                      </div>

                      <div className="mt-3 flex items-center justify-between border-t border-[var(--axon-border)] pt-2 text-[10px]">
                        <span className="text-slate-500">Package: php{selectedVer}-{ext.pkg}</span>
                        {togglingExt === ext.name ? (
                          <span className="flex items-center gap-1 text-indigo-400">
                            <Spinner /> Updating…
                          </span>
                        ) : !ext.installed ? (
                          <span className="text-amber-400 font-medium">Auto-installs on toggle</span>
                        ) : ext.enabled ? (
                          <span className="text-emerald-400 font-semibold">Enabled</span>
                        ) : (
                          <span className="text-slate-500">Disabled</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: php.ini Directives */}
          {activeTab === "ini" && (
            <Card
              title={`PHP ${selectedVer} Settings (php.ini)`}
              subtitle={`/etc/php/${selectedVer}/fpm/php.ini`}
              actions={
                editingIni ? (
                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingIni(false)}>
                      Cancel
                    </Button>
                    <Button variant="primary" size="sm" onClick={handleSaveIni} disabled={busy}>
                      Save & Reload
                    </Button>
                  </div>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => setEditingIni(true)}>
                    Edit Directives
                  </Button>
                )
              }
            >
              {iniSettings ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">upload_max_filesize</label>
                      <input
                        type="text"
                        disabled={!editingIni}
                        value={iniSettings.upload_max_filesize}
                        onChange={(e) => setIniSettings({ ...iniSettings, upload_max_filesize: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">post_max_size</label>
                      <input
                        type="text"
                        disabled={!editingIni}
                        value={iniSettings.post_max_size}
                        onChange={(e) => setIniSettings({ ...iniSettings, post_max_size: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">memory_limit</label>
                      <input
                        type="text"
                        disabled={!editingIni}
                        value={iniSettings.memory_limit}
                        onChange={(e) => setIniSettings({ ...iniSettings, memory_limit: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">max_execution_time</label>
                      <input
                        type="text"
                        disabled={!editingIni}
                        value={iniSettings.max_execution_time}
                        onChange={(e) => setIniSettings({ ...iniSettings, max_execution_time: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">display_errors</label>
                      <select
                        disabled={!editingIni}
                        value={iniSettings.display_errors}
                        onChange={(e) => setIniSettings({ ...iniSettings, display_errors: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      >
                        <option value="Off">Off (Production)</option>
                        <option value="On">On (Development)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-slate-400 mb-1 font-medium">date.timezone</label>
                      <input
                        type="text"
                        disabled={!editingIni}
                        value={iniSettings.date_timezone}
                        onChange={(e) => setIniSettings({ ...iniSettings, date_timezone: e.target.value })}
                        className="w-full rounded border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 disabled:opacity-60"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-4 text-xs text-slate-400">Loading settings…</div>
              )}
            </Card>
          )}
        </div>
      )}

      {/* Available to Install */}
      {data.availableToInstall.length > 0 && (
        <Card
          title="Install Additional PHP Runtimes"
          subtitle="One-click package installation from the official Ondřej Surý PHP repository."
        >
          <div className="flex flex-wrap gap-3">
            {data.availableToInstall.map((ver) => (
              <div
                key={ver}
                className="flex items-center justify-between gap-4 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-4 py-3"
              >
                <div>
                  <h4 className="text-sm font-semibold text-slate-200">PHP {ver}</h4>
                  <p className="text-[11px] text-slate-500">FPM, CLI, MySQL, cURL, GD, XML, Zip</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleInstallPhp(ver)}
                  disabled={busy || installingVer === ver}
                >
                  {installingVer === ver ? <Spinner /> : "Install"}
                </Button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
