import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { formatBytes } from "../lib/format";
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
  useAsyncAction,
  useToast,
} from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";
import SiteWorkspaceModal from "../components/SiteWorkspaceModal";

type Site = {
  name: string;
  enabled: boolean;
  serverNames: string[];
  listens: string[];
  roots: string[];
  proxies: string[];
  certificates: string[];
  fastcgi: string[];
  redirects: string[];
  serverBlocks: number;
  ssl: boolean;
  kind: string;
  phpVersion?: string | null;
  bytes: number;
};

type Template = {
  id: string;
  label: string;
  description: string;
  needsPort: boolean;
  needsSocket: boolean;
};

const KIND_TONE: Record<string, "ok" | "info" | "warn" | "neutral" | "bad"> = {
  proxy: "info",
  php: "warn",
  static: "neutral",
  redirect: "bad",
  other: "neutral",
};

export default function Sites() {
  const [sites, setSites] = useState<Site[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [defaultSocket, setDefaultSocket] = useState("");
  const [nginxTest, setNginxTest] = useState<{ ok: boolean; output: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ name: string; content: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Site | null>(null);
  const [switchingPhpSite, setSwitchingPhpSite] = useState<Site | null>(null);
  const [targetPhpVer, setTargetPhpVer] = useState("8.3");
  const [workspaceSite, setWorkspaceSite] = useState<Site | null>(null);

  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();

  const load = async () => {
    try {
      const result = await api.get<{ sites: Site[]; nginx: { test: { ok: boolean; output: string } } }>("/sites");
      setSites(result.sites);
      setNginxTest(result.nginx.test);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    api
      .get<{ templates: Template[]; defaultSocket: string }>("/sites/templates")
      .then((result) => {
        setTemplates(result.templates);
        setDefaultSocket(result.defaultSocket);
      })
      .catch(() => {});
  }, []);

  const act = async (fn: () => Promise<unknown>, message: string) => {
    await run(async () => {
      await fn();
      await load();
    }, message);
  };

  const openEditor = async (site: Site) => {
    try {
      const result = await api.get<{ name: string; content: string }>(`/sites/${encodeURIComponent(site.name)}`);
      setEditing(result);
      setError(null);
    } catch (caught) {
      toast("error", errorMessage(caught));
    }
  };

  const saveEditor = async () => {
    if (!editing) return;
    await run(async () => {
      await api.put(`/sites/${encodeURIComponent(editing.name)}`, { content: editing.content });
      setEditing(null);
      await load();
    }, "Configuration saved and nginx reloaded");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading sites…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Breadcrumbs items={[{ label: "Websites" }]} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--axon-text)]">Websites</h1>
          <p className="text-xs text-[var(--axon-muted)]">{sites.length} nginx server configurations</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={nginxTest?.ok ? "ok" : "bad"}>nginx config {nginxTest?.ok ? "valid" : "invalid"}</Badge>
          <Button onClick={() => act(() => api.post("/sites/test"), "Configuration test complete")}>Test config</Button>
          <Button onClick={() => act(() => api.post("/sites/reload"), "nginx reloaded")}>Reload nginx</Button>
          <Button variant="primary" onClick={() => { setCreating(true); setError(null); }}>
            New site
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {!nginxTest?.ok && nginxTest && (
        <Card title="nginx configuration error">
          <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap text-[11px] text-rose-300">{nginxTest.output}</pre>
        </Card>
      )}

      <Card bodyClassName="p-0">
        <div className="overflow-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Site</th>
                <th className="th">Type</th>
                <th className="th">Upstream / root</th>
                <th className="th">SSL</th>
                <th className="th">State</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((site) => (
                <tr key={site.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="td">
                    <span className="mono text-xs text-[var(--axon-text)] font-medium">{site.name}</span>
                    <p className="truncate text-[11px] text-[var(--axon-muted)]">{site.serverNames.join(", ") || "—"}</p>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={KIND_TONE[site.kind] ?? "neutral"}>{site.kind}</Badge>
                      {site.phpVersion && (
                        <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-indigo-300">
                          PHP {site.phpVersion}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">{formatBytes(site.bytes)}</p>
                  </td>
                  <td className="td">
                    <p className="mono truncate text-[11px] text-slate-400">
                      {site.proxies[0] ?? site.roots[0] ?? site.redirects[0] ?? "—"}
                    </p>
                    {site.fastcgi.length > 0 && <p className="mono truncate text-[10px] text-slate-600">{site.fastcgi[0]}</p>}
                  </td>
                  <td className="td">
                    {site.ssl ? <Badge tone="ok">https</Badge> : <Badge tone="warn">http</Badge>}
                  </td>
                  <td className="td">
                    <Badge tone={site.enabled ? "ok" : "neutral"}>{site.enabled ? "enabled" : "disabled"}</Badge>
                  </td>
                  <td className="td">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <Link
                        to={`/sites/${encodeURIComponent(site.name)}`}
                        className="rounded-lg bg-[var(--axon-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--axon-primary-fg)] hover:bg-[var(--axon-primary-hover)] transition"
                      >
                        Manage
                      </Link>
                      {site.kind === "php" && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSwitchingPhpSite(site);
                            setTargetPhpVer(site.phpVersion || "8.3");
                          }}
                        >
                          PHP
                        </Button>
                      )}
                      <Button onClick={() => openEditor(site)}>VHost</Button>
                      {site.enabled ? (
                        <Button onClick={() => act(() => api.post(`/sites/${encodeURIComponent(site.name)}/disable`), `${site.name} disabled`)}>
                          Disable
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => act(() => api.post(`/sites/${encodeURIComponent(site.name)}/enable`), `${site.name} enabled`)}
                        >
                          Enable
                        </Button>
                      )}
                      <Button variant="danger" onClick={() => setDeleting(site)}>
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sites.length === 0 && <EmptyState message="No sites configured" />}
        </div>
      </Card>

      <Modal open={creating} title="Create a website" onClose={() => setCreating(false)} width="max-w-2xl">
        <CreateSiteForm
          templates={templates}
          defaultSocket={defaultSocket}
          busy={busy}
          error={error}
          onSubmit={async (payload) => {
            const ok = await run(async () => {
              await api.post("/sites", payload);
              setCreating(false);
              await load();
            }, "Site created");
            return ok;
          }}
        />
      </Modal>

      <Modal open={Boolean(editing)} title={`Edit · ${editing?.name ?? ""}`} onClose={() => setEditing(null)} width="max-w-4xl">
        <ErrorBanner message={error} />
        <textarea
          className="field mono h-[52vh] resize-y leading-relaxed"
          spellCheck={false}
          value={editing?.content ?? ""}
          onChange={(event) => setEditing((current) => (current ? { ...current, content: event.target.value } : current))}
        />
        <p className="mt-2 text-[11px] text-slate-500">
          The configuration is validated with <span className="mono">nginx -t</span> before saving. If it fails, your previous
          version is restored automatically.
        </p>
        <footer className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={saveEditor}>
            Save and reload
          </Button>
        </footer>
      </Modal>

      <Modal
        open={Boolean(switchingPhpSite)}
        title={switchingPhpSite ? `Switch PHP Version for ${switchingPhpSite.name}` : ""}
        onClose={() => setSwitchingPhpSite(null)}
        width="max-w-md"
      >
        {switchingPhpSite && (
          <div className="space-y-4 text-xs">
            <p className="text-slate-400">
              Select the PHP-FPM runtime version. The site's Nginx configuration will be updated and validated automatically.
            </p>
            <div>
              <label className="block text-slate-400 mb-1 font-medium">PHP Version</label>
              <select
                value={targetPhpVer}
                onChange={(e) => setTargetPhpVer(e.target.value)}
                className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-slate-200 focus:outline-none"
              >
                <option value="8.1">PHP 8.1 FPM</option>
                <option value="8.2">PHP 8.2 FPM</option>
                <option value="8.3">PHP 8.3 FPM</option>
                <option value="8.4">PHP 8.4 FPM</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setSwitchingPhpSite(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  const s = switchingPhpSite;
                  setSwitchingPhpSite(null);
                  await act(
                    () => api.post(`/sites/${encodeURIComponent(s.name)}/switch-php`, { version: targetPhpVer }),
                    `Switched ${s.name} to PHP ${targetPhpVer}`,
                  );
                }}
              >
                Apply PHP {targetPhpVer}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete site"
        message={
          <>
            This removes <span className="mono text-amber-300">{deleting?.name}</span> from nginx and disables it. A backup copy is
            kept in <span className="mono">/etc/nginx/panel-backups</span>. Files in the document root are not deleted.
          </>
        }
        requireText={deleting?.name}
        busy={busy}
        confirmLabel="Delete site"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const site = deleting;
          setDeleting(null);
          if (!site) return;
          await act(
            () => api.del(`/sites/${encodeURIComponent(site.name)}`, { confirm: site.name }),
            `${site.name} deleted`,
          );
        }}
      />

      <SiteWorkspaceModal
        site={workspaceSite}
        open={Boolean(workspaceSite)}
        onClose={() => setWorkspaceSite(null)}
        onRefresh={load}
      />
    </div>
  );
}

function CreateSiteForm({
  templates,
  defaultSocket,
  busy,
  error,
  onSubmit,
}: {
  templates: Template[];
  defaultSocket: string;
  busy: boolean;
  error: string | null;
  onSubmit: (payload: Record<string, unknown>) => Promise<boolean>;
}) {
  const [template, setTemplate] = useState("proxy");
  const [domain, setDomain] = useState("");
  const [aliases, setAliases] = useState("");
  const [port, setPort] = useState("3000");
  const [root, setRoot] = useState("");
  const [socket, setSocket] = useState(defaultSocket);
  const [target, setTarget] = useState("");
  const [createRoot, setCreateRoot] = useState(true);

  useEffect(() => {
    if (defaultSocket && !socket) setSocket(defaultSocket);
  }, [defaultSocket, socket]);

  const selected = templates.find((item) => item.id === template);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload: Record<string, unknown> = {
      template,
      domain: domain.trim(),
      createRoot,
      enable: true,
      aliases: aliases
        .split(/[\s,]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    };
    if (template === "proxy") payload.port = Number(port);
    if (template === "redirect") payload.target = target.trim();
    if (template === "static" || template === "php") {
      if (root.trim()) payload.root = root.trim();
      if (template === "php") payload.socket = socket;
    }
    await onSubmit(payload);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <ErrorBanner message={error} />

      <Field label="Template">
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() => setTemplate(item.id)}
              className={`rounded-lg border p-3 text-left transition-colors ${
                template === item.id ? "border-indigo-500 bg-indigo-500/10" : "border-[var(--axon-border)] hover:border-slate-500"
              }`}
            >
              <p className="text-xs font-medium text-slate-200">{item.label}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{item.description}</p>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Domain">
          <input
            className="field mono"
            placeholder="example.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
          />
        </Field>
        <Field label="Additional domains" hint="Comma separated, optional">
          <input
            className="field mono"
            placeholder="www.example.com"
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
          />
        </Field>
      </div>

      {template === "proxy" && (
        <Field label="Upstream port" hint="Your app must already be listening on this local port">
          <input
            className="field mono"
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(event) => setPort(event.target.value)}
            required
          />
        </Field>
      )}

      {template === "redirect" && (
        <Field label="Redirect target" hint="Visitors are sent here with a 301">
          <input
            className="field mono"
            placeholder="other-site.com"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            required
          />
        </Field>
      )}

      {(template === "static" || template === "php") && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Document root" hint={template === "php" ? "Laravel: public/ is appended automatically" : "Leave blank for /var/www/<domain>"}>
            <input
              className="field mono"
              placeholder={`/var/www/${domain || "example.com"}`}
              value={root}
              onChange={(event) => setRoot(event.target.value)}
            />
          </Field>
          {template === "php" && (
            <Field label="PHP-FPM socket">
              <input className="field mono" value={socket} onChange={(event) => setSocket(event.target.value)} required />
            </Field>
          )}
        </div>
      )}

      {(template === "static" || template === "php") && (
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={createRoot} onChange={(event) => setCreateRoot(event.target.checked)} />
          Create the document root directory if it does not exist
        </label>
      )}

      <p className="text-[11px] text-slate-500">
        The site is created, validated with <span className="mono">nginx -t</span>, and enabled automatically. Use the Websites page
        to issue an SSL certificate afterwards.
      </p>

      <footer className="flex justify-end gap-2 pt-1">
        <Button type="submit" variant="primary" loading={busy} disabled={!selected || !domain.trim()}>
          Create site
        </Button>
      </footer>
    </form>
  );
}
