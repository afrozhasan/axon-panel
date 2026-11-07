import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, Spinner, useToast } from "../ui";

type Plugin = {
  name: string;
  status: string;
  update: string;
  version: string;
  update_version?: string;
  hasUpdate?: boolean;
};

type Theme = {
  name: string;
  status: string;
  update: string;
  version: string;
  update_version?: string;
};

export default function WpPluginsThemesTab({ siteName, docroot }: { siteName: string; docroot?: string }) {
  const [subTab, setSubTab] = useState<"plugins" | "themes">("plugins");
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletePluginTarget, setDeletePluginTarget] = useState<string | null>(null);
  const [deleteThemeTarget, setDeleteThemeTarget] = useState<string | null>(null);

  const toast = useToast();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, tRes] = await Promise.all([
        api.get<{ plugins: Plugin[] }>(`/wp/${encodeURIComponent(siteName)}/plugins`),
        api.get<{ themes: Theme[] }>(`/wp/${encodeURIComponent(siteName)}/themes`),
      ]);
      setPlugins(pRes.plugins || []);
      setThemes(tRes.themes || []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [siteName]);

  const handleTogglePlugin = async (pluginName: string, activate: boolean) => {
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/plugins/toggle`, {
        plugin: pluginName,
        activate,
      });
      toast("ok", `Plugin ${pluginName} ${activate ? "activated" : "deactivated"}`);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleUpdatePlugin = async (pluginName: string = "--all") => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; output: string }>(`/wp/${encodeURIComponent(siteName)}/plugins/update`, {
        plugin: pluginName,
      });
      toast("ok", pluginName === "--all" ? "All plugins updated successfully" : `Plugin ${pluginName} updated`);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDeletePlugin = async (pluginName: string) => {
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/plugins/delete`, {
        plugin: pluginName,
      });
      toast("ok", `Plugin ${pluginName} deleted`);
      setDeletePluginTarget(null);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteTheme = async (themeName: string) => {
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/themes/delete`, {
        theme: themeName,
      });
      toast("ok", `Theme ${themeName} deleted`);
      setDeleteThemeTarget(null);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--axon-muted)]">
        <Spinner className="h-6 w-6 mb-2" />
        Loading WordPress plugins and themes from server...
      </div>
    );
  }

  const inactivePluginsCount = plugins.filter((p) => p.status !== "active").length;
  const updatesCount = plugins.filter((p) => p.update === "available" || p.hasUpdate).length;

  return (
    <div className="space-y-4 pt-1">
      <ErrorBanner message={error} />

      {/* Subtab Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
        <div className="flex rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-0.5 text-xs">
          <button
            onClick={() => setSubTab("plugins")}
            className={`rounded px-3 py-1 font-medium transition ${
              subTab === "plugins" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
            }`}
          >
            Plugins ({plugins.length}) {updatesCount > 0 && <span className="ml-1 rounded bg-amber-400 px-1 text-[10px] text-black font-bold">{updatesCount}</span>}
          </button>
          <button
            onClick={() => setSubTab("themes")}
            className={`rounded px-3 py-1 font-medium transition ${
              subTab === "themes" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
            }`}
          >
            Themes ({themes.length})
          </button>
        </div>

        {subTab === "plugins" && updatesCount > 0 && (
          <Button variant="primary" loading={busy} onClick={() => handleUpdatePlugin("--all")}>
            ⬆ Update All Plugins ({updatesCount})
          </Button>
        )}
      </div>

      {/* Inactive Components Warning */}
      {subTab === "plugins" && inactivePluginsCount > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300 flex items-center justify-between">
          <span>
            Notice: {inactivePluginsCount} inactive plugin(s) detected. Inactive plugins still consume disk storage and may present security attack surface if outdated.
          </span>
        </div>
      )}

      {/* Plugins Table */}
      {subTab === "plugins" && (
        <div className="overflow-x-auto rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-card-hover)] text-[10px] uppercase tracking-wider text-[var(--axon-muted)]">
                <th className="p-3">Plugin Name</th>
                <th className="p-3">Version</th>
                <th className="p-3">Status</th>
                <th className="p-3">Updates</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {plugins.map((p) => (
                <tr key={p.name} className="hover:bg-[var(--axon-card-hover)] transition">
                  <td className="p-3 font-semibold text-[var(--axon-text)]">{p.name}</td>
                  <td className="p-3 font-mono text-[var(--axon-muted)]">{p.version}</td>
                  <td className="p-3">
                    <Badge tone={p.status === "active" ? "ok" : "neutral"}>
                      {p.status.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="p-3">
                    {p.update === "available" || p.hasUpdate ? (
                      <span className="rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                        v{p.update_version || "Newer"} Available
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500">Up to date</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(p.update === "available" || p.hasUpdate) && (
                        <Button
                          variant="ghost"
                          loading={busy}
                          onClick={() => handleUpdatePlugin(p.name)}
                          className="text-[11px] py-1 px-2 text-[var(--axon-primary)]"
                        >
                          Update
                        </Button>
                      )}
                      <Button
                        variant={p.status === "active" ? "ghost" : "primary"}
                        loading={busy}
                        onClick={() => handleTogglePlugin(p.name, p.status !== "active")}
                        className="text-[11px] py-1 px-2"
                      >
                        {p.status === "active" ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        variant="danger"
                        loading={busy}
                        onClick={() => setDeletePluginTarget(p.name)}
                        className="text-[11px] py-1 px-2"
                        title="Delete plugin files"
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

      {/* Themes Grid */}
      {subTab === "themes" && (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {themes.map((t) => (
            <div
              key={t.name}
              className={`rounded-xl border p-4 bg-[var(--axon-card)] flex flex-col justify-between ${
                t.status === "active" ? "border-emerald-500/40 shadow-sm" : "border-[var(--axon-border)]"
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[var(--axon-text)] capitalize">{t.name}</h4>
                  <Badge tone={t.status === "active" ? "ok" : "neutral"}>
                    {t.status === "active" ? "ACTIVE THEME" : "INACTIVE"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-[var(--axon-muted)] font-mono">Version {t.version}</p>
                <p className="mt-2 text-[11px] text-[var(--axon-muted)]">
                  {t.status === "active" ? "Currently rendering the frontend application." : "Installed standby theme."}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--axon-border)] flex items-center justify-between">
                {t.status === "active" ? (
                  <span className="text-[11px] text-emerald-400 font-medium">Protected (Active Theme)</span>
                ) : (
                  <Button
                    variant="danger"
                    loading={busy}
                    onClick={() => setDeleteThemeTarget(t.name)}
                    className="text-[11px] py-1 px-2.5 ml-auto"
                  >
                    Delete Theme
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirm Plugin Deletion */}
      <ConfirmDialog
        open={!!deletePluginTarget}
        title="Delete WordPress Plugin"
        message={
          deletePluginTarget
            ? `Are you sure you want to delete plugin "${deletePluginTarget}"? This will deactivate the plugin and permanently remove all its files from the server.`
            : ""
        }
        confirmLabel="Delete Plugin"
        busy={busy}
        onCancel={() => setDeletePluginTarget(null)}
        onConfirm={() => {
          if (deletePluginTarget) handleDeletePlugin(deletePluginTarget);
        }}
      />

      {/* Confirm Theme Deletion */}
      <ConfirmDialog
        open={!!deleteThemeTarget}
        title="Delete WordPress Theme"
        message={
          deleteThemeTarget
            ? `Are you sure you want to delete theme "${deleteThemeTarget}"? This will permanently remove its files from the server.`
            : ""
        }
        confirmLabel="Delete Theme"
        busy={busy}
        onCancel={() => setDeleteThemeTarget(null)}
        onConfirm={() => {
          if (deleteThemeTarget) handleDeleteTheme(deleteThemeTarget);
        }}
      />
    </div>
  );
}
