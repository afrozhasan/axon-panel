import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, Field, Modal, Spinner, Tabs, useToast } from "./ui";
import WpSecurityTab from "./wp/WpSecurityTab";
import WpOptimizationTab from "./wp/WpOptimizationTab";
import WpCacheTab from "./wp/WpCacheTab";
import WpPluginsThemesTab from "./wp/WpPluginsThemesTab";
import WpUsersTab from "./wp/WpUsersTab";
import WpDatabaseTab from "./wp/WpDatabaseTab";
import WpBackupTab from "./wp/WpBackupTab";
import WpLogsTab from "./wp/WpLogsTab";

type Site = {
  name: string;
  enabled: boolean;
  serverNames: string[];
  roots: string[];
  proxies: string[];
  ssl: boolean;
  kind: string;
  phpVersion?: string | null;
};

type DomainEntry = {
  id: string;
  website_id: string;
  domain: string;
  is_primary: number;
  domain_type: "primary" | "subdomain" | "alias";
  routing_type: "direct" | "redirect";
  target_url: string | null;
  ssl_active: number;
  created_at: string;
};

type StackInfo = {
  type: "wordpress" | "laravel" | "astro" | "nodejs" | "nextjs" | "php" | "static";
  docroot: string;
  details?: any;
};

type WpPlugin = {
  name: string;
  status: string;
  update: string;
  version: string;
};

export default function SiteWorkspaceModal({
  site,
  open,
  onClose,
  onRefresh,
}: {
  site: Site | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [loadingStack, setLoadingStack] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState(false);

  // WordPress state
  const [wpData, setWpData] = useState<any>(null);

  // Laravel state
  const [laravelData, setLaravelData] = useState<any>(null);
  const [laravelEnv, setLaravelEnv] = useState<Record<string, string>>({});
  const [artisanOutput, setArtisanOutput] = useState<string | null>(null);

  // Node / Astro state
  const [nodeData, setNodeData] = useState<any>(null);

  // Git state
  const [gitData, setGitData] = useState<any>(null);

  // Nginx config state
  const [vhostContent, setVhostContent] = useState("");
  const [savingVhost, setSavingVhost] = useState(false);

  // PHP version switch
  const [selectedPhp, setSelectedPhp] = useState(site?.phpVersion || "8.4");

  // Domain Management state
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [loadingDomains, setLoadingDomains] = useState(false);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [editingDomain, setEditingDomain] = useState<DomainEntry | null>(null);
  const [deletingDomain, setDeletingDomain] = useState<DomainEntry | null>(null);

  // Add Domain form state
  const [newDomain, setNewDomain] = useState("");
  const [newDomainType, setNewDomainType] = useState<"subdomain" | "alias">("subdomain");
  const [newRoutingType, setNewRoutingType] = useState<"direct" | "redirect">("direct");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newRedirectCode, setNewRedirectCode] = useState(301);
  const [newIssueSsl, setNewIssueSsl] = useState(false);

  // Edit Domain form state
  const [editDomainType, setEditDomainType] = useState<"subdomain" | "alias">("subdomain");
  const [editRoutingType, setEditRoutingType] = useState<"direct" | "redirect">("direct");
  const [editTargetUrl, setEditTargetUrl] = useState("");
  const [editRedirectCode, setEditRedirectCode] = useState(301);

  const toast = useToast();

  useEffect(() => {
    if (!open || !site) return;
    setActiveTab("overview");
    setStack(null);
    setWpData(null);
    setLaravelData(null);
    setNodeData(null);
    setGitData(null);
    setError(null);
    setArtisanOutput(null);
    setDomains([]);

    loadStackData();
    loadDomains();
  }, [open, site]);

  const loadDomains = async () => {
    if (!site) return;
    setLoadingDomains(true);
    try {
      const res = await api.get<{ domains: DomainEntry[] }>(`/sites/${encodeURIComponent(site.name)}/domains`);
      setDomains(res.domains);
    } catch (err) {
      console.error("Failed to load domains", err);
    } finally {
      setLoadingDomains(false);
    }
  };

  const handleAddDomain = async () => {
    if (!site || !newDomain.trim()) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/domains`, {
        domain: newDomain.trim(),
        domainType: newDomainType,
        routingType: newRoutingType,
        targetUrl: newTargetUrl.trim() || undefined,
        redirectCode: newRedirectCode,
        issueSsl: newIssueSsl,
      });
      toast("ok", `Domain ${newDomain.trim()} added successfully`);
      setShowAddDomain(false);
      setNewDomain("");
      setNewTargetUrl("");
      setNewIssueSsl(false);
      await loadDomains();
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const openEditDomain = (domainItem: DomainEntry) => {
    setEditingDomain(domainItem);
    setEditDomainType(domainItem.domain_type === "subdomain" ? "subdomain" : "alias");
    setEditRoutingType(domainItem.routing_type === "redirect" ? "redirect" : "direct");
    setEditTargetUrl(domainItem.target_url || `https://${site?.serverNames[0] || site?.name}$request_uri`);
    setEditRedirectCode(301);
  };

  const handleUpdateDomain = async () => {
    if (!site || !editingDomain) return;
    setBusyAction(true);
    try {
      await api.put(`/sites/${encodeURIComponent(site.name)}/domains/${encodeURIComponent(editingDomain.domain)}`, {
        domainType: editDomainType,
        routingType: editRoutingType,
        targetUrl: editTargetUrl.trim() || undefined,
        redirectCode: editRedirectCode,
      });
      toast("ok", `Domain ${editingDomain.domain} updated successfully`);
      setEditingDomain(null);
      await loadDomains();
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handlePromotePrimary = async (domainItem: DomainEntry) => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.put(`/sites/${encodeURIComponent(site.name)}/domains/${encodeURIComponent(domainItem.domain)}`, {
        isPrimary: true,
      });
      toast("ok", `${domainItem.domain} promoted to primary domain`);
      setEditingDomain(null);
      await loadDomains();
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleIssueDomainSsl = async (domainItem: DomainEntry) => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/domains/${encodeURIComponent(domainItem.domain)}/ssl`);
      toast("ok", `SSL certificate issued for ${domainItem.domain}`);
      await loadDomains();
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!site || !deletingDomain) return;
    setBusyAction(true);
    try {
      await api.delete(`/sites/${encodeURIComponent(site.name)}/domains/${encodeURIComponent(deletingDomain.domain)}`);
      toast("ok", `Domain ${deletingDomain.domain} removed`);
      setDeletingDomain(null);
      await loadDomains();
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const loadStackData = async () => {
    if (!site) return;
    setLoadingStack(true);
    try {
      const [stackRes, gitRes, vhostRes] = await Promise.all([
        api.get<StackInfo>(`/sites/${encodeURIComponent(site.name)}/stack`),
        api.get<any>(`/sites/${encodeURIComponent(site.name)}/git`).catch(() => null),
        api.get<{ content: string }>(`/sites/${encodeURIComponent(site.name)}`),
      ]);

      setStack(stackRes);
      if (gitRes) setGitData(gitRes);
      setVhostContent(vhostRes.content);

      if (stackRes.type === "wordpress") {
        setWpData(stackRes.details);
      } else if (stackRes.type === "laravel") {
        setLaravelData(stackRes.details);
        loadLaravelEnv();
      } else if (stackRes.type === "astro" || stackRes.type === "nodejs" || stackRes.type === "nextjs") {
        setNodeData(stackRes.details);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingStack(false);
    }
  };

  const loadLaravelEnv = async () => {
    if (!site) return;
    try {
      const res = await api.get<{ env: Record<string, string> }>(`/sites/${encodeURIComponent(site.name)}/laravel/env`);
      setLaravelEnv(res.env);
    } catch {}
  };

  const runArtisanCmd = async (command: string) => {
    if (!site) return;
    setBusyAction(true);
    setArtisanOutput(null);
    try {
      const res = await api.post<{ ok: boolean; output: string }>(`/sites/${encodeURIComponent(site.name)}/laravel/artisan`, { command });
      setArtisanOutput(res.output);
      toast("ok", `Artisan ${command} completed`);
      loadStackData();
    } catch (err) {
      toast("error", errorMessage(err));
      setArtisanOutput(`Error: ${errorMessage(err)}`);
    } finally {
      setBusyAction(false);
    }
  };

  const togglePlugin = async (pluginName: string, activate: boolean) => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/wordpress/plugin`, {
        plugin: pluginName,
        action: activate ? "activate" : "deactivate",
      });
      toast("ok", `Plugin ${pluginName} ${activate ? "activated" : "deactivated"}`);
      // Refresh WP data
      const updated = await api.get<any>(`/sites/${encodeURIComponent(site.name)}/wordpress`);
      setWpData(updated);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const applyWpSecurity = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/wordpress/harden`);
      toast("ok", "WordPress security hardening applied");
      const updated = await api.get<any>(`/sites/${encodeURIComponent(site.name)}/wordpress`);
      setWpData(updated);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const optimizeWp = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/wordpress/optimize`);
      toast("ok", "WordPress database optimized");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const triggerBuild = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      const res = await api.post<{ task: { id: string } }>(`/sites/${encodeURIComponent(site.name)}/node/build`);
      toast("ok", `Build enqueued (Task: ${res.task.id})`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const saveVhost = async () => {
    if (!site) return;
    setSavingVhost(true);
    try {
      await api.put(`/sites/${encodeURIComponent(site.name)}`, { content: vhostContent });
      toast("ok", "Nginx configuration saved and reloaded");
      onRefresh();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSavingVhost(false);
    }
  };

  const handleSwitchPhp = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/switch-php`, { version: selectedPhp });
      toast("ok", `Switched to PHP ${selectedPhp}`);
      onRefresh();
      loadStackData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handlePullGit = async () => {
    setBusyAction(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/sites/${encodeURIComponent(site.name)}/git/pull`,
        { runBuild: false }
      );
      toast("ok", res.message || "Git pulled successfully");
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(site.name)}/git`);
      setGitData(updatedGit);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  if (!site) return null;

  const stackBadge =
    stack?.type === "wordpress"
      ? { label: "WordPress", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" }
      : stack?.type === "laravel"
        ? { label: "Laravel", color: "bg-red-500/15 text-red-400 border-red-500/30" }
        : stack?.type === "astro"
          ? { label: "Astro", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" }
          : stack?.type === "nextjs"
            ? { label: "Next.js", color: "bg-teal-500/15 text-teal-400 border-teal-500/30" }
            : stack?.type === "nodejs"
              ? { label: "Node.js", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" }
              : { label: "PHP / Web", color: "bg-slate-500/15 text-slate-300 border-slate-500/30" };

  const isWp = stack?.type === "wordpress";

  const tabs = isWp
    ? [
        { id: "overview", label: "Overview" },
        { id: "security", label: "Security", badge: "Audit" },
        { id: "optimization", label: "Optimization", badge: "Pro" },
        { id: "cache", label: "Cache Manager", badge: "FastCGI/Redis" },
        { id: "users", label: "Users" },
        { id: "plugins-themes", label: "Plugins & Themes" },
        { id: "database", label: "Database" },
        { id: "backup", label: "Backup" },
        { id: "logs", label: "Logs" },
        { id: "domains", label: "Domains & Subdomains", badge: domains.length ? `${domains.length}` : undefined },
        { id: "vhost", label: "Nginx VHost" },
      ]
    : [
        { id: "overview", label: "Overview" },
        { id: "domains", label: "Domains & Subdomains", badge: domains.length ? `${domains.length}` : undefined },
        { id: "toolkit", label: stack?.type === "laravel" ? "Laravel" : stack?.type === "astro" ? "Astro Engine" : "Runtime" },
        { id: "vhost", label: "Nginx VHost" },
        { id: "git", label: "Git & Deployment", badge: gitData?.hasGit ? "Active" : undefined },
      ];

  return (
    <Modal open={open} title={`Manage Website: ${site.name}`} onClose={onClose} width="max-w-4xl">
      <div className="space-y-4">
        <ErrorBanner message={error} />

        {/* Header Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">🌐</span>
            <div>
              <p className="font-bold text-sm text-[var(--axon-text)]">{site.serverNames[0] || site.name}</p>
              <p className="mono text-xs text-[var(--axon-muted)]">{stack?.docroot || site.roots[0] || "/var/www"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${stackBadge.color}`}>
              {stackBadge.label}
            </span>
            <Badge tone={site.ssl ? "ok" : "warn"}>{site.ssl ? "🔒 SSL Active" : "No SSL"}</Badge>
            <Badge tone={site.enabled ? "ok" : "neutral"}>{site.enabled ? "Enabled" : "Disabled"}</Badge>
          </div>
        </div>

        {/* Tab Navigation */}
        <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
          <div className="space-y-4 pt-1">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Application Stack</p>
                <p className="mt-1 text-sm font-semibold text-[var(--axon-text)] capitalize">{stack?.type || site.kind}</p>
                <p className="text-xs text-[var(--axon-muted)] mt-0.5">
                  {stack?.type === "wordpress" ? `Version ${wpData?.version || "installed"}` : stack?.type === "laravel" ? laravelData?.version || "installed" : "Managed stack"}
                </p>
              </div>

              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">PHP / Engine</p>
                <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
                  {site.phpVersion ? `PHP ${site.phpVersion}` : "Reverse Proxy"}
                </p>
                <p className="text-xs text-[var(--axon-muted)] mt-0.5">PHP-FPM Pool unix socket</p>
              </div>

              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Domains Bound</p>
                <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">{site.serverNames.length} host(s)</p>
                <p className="text-xs text-[var(--axon-muted)] mt-0.5 truncate">{site.serverNames.join(", ")}</p>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">Quick Operations</h4>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://${site.serverNames[0] || site.name}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost text-xs"
                >
                  ↗ Visit Website
                </a>
                {stack?.type === "wordpress" && (
                  <>
                    <Button variant="ghost" onClick={() => setActiveTab("security")}>
                      🛡️ Security Hardening
                    </Button>
                    <Button variant="ghost" onClick={() => setActiveTab("optimization")}>
                      ⚡ Performance Tuning
                    </Button>
                    <Button variant="ghost" onClick={() => setActiveTab("cache")}>
                      🚀 Cache Manager
                    </Button>
                    <Button variant="ghost" onClick={() => setActiveTab("backup")}>
                      💾 Snapshots & Restore
                    </Button>
                  </>
                )}
                {stack?.type === "laravel" && (
                  <>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("cache:clear")}>
                      🧹 Clear Cache
                    </Button>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("storage:link")}>
                      🔗 Link Storage
                    </Button>
                  </>
                )}
                {(stack?.type === "astro" || stack?.type === "nodejs" || stack?.type === "nextjs") && (
                  <Button variant="primary" loading={busyAction} onClick={triggerBuild}>
                    🚀 Run Production Build
                  </Button>
                )}
              </div>
            </div>

            {/* PHP Switcher for PHP sites */}
            {site.kind === "php" && (
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">PHP-FPM Pool Version</h4>
                <div className="flex items-center gap-3">
                  <select
                    className="field max-w-xs"
                    value={selectedPhp}
                    onChange={(e) => setSelectedPhp(e.target.value)}
                  >
                    <option value="8.4">PHP 8.4 (Recommended / Fast)</option>
                    <option value="8.3">PHP 8.3 (Stable)</option>
                    <option value="8.2">PHP 8.2 (LTS)</option>
                  </select>
                  <Button variant="primary" loading={busyAction} onClick={handleSwitchPhp}>
                    Switch Version
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab: Domains & Subdomains */}
        {activeTab === "domains" && (
          <div className="space-y-4 pt-1">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--axon-text)]">Domains & Subdomains</h4>
                <p className="text-xs text-[var(--axon-muted)]">
                  Manage primary domain, subdomains, alias pointer domains, and HTTP redirect rules for this website.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => {
                  setNewDomain("");
                  setNewDomainType("subdomain");
                  setNewRoutingType("direct");
                  setNewTargetUrl(`https://${site.serverNames[0] || site.name}$request_uri`);
                  setNewRedirectCode(301);
                  setNewIssueSsl(false);
                  setShowAddDomain(true);
                }}
              >
                + Add Domain / Subdomain
              </Button>
            </div>

            {loadingDomains ? (
              <div className="flex items-center gap-2 py-8 justify-center text-xs text-[var(--axon-muted)]">
                <Spinner /> Loading domains…
              </div>
            ) : domains.length === 0 ? (
              <EmptyState message="No domains registered for this website." />
            ) : (
              <div className="overflow-x-auto rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]">
                      <th className="p-3 font-semibold">Domain</th>
                      <th className="p-3 font-semibold">Type</th>
                      <th className="p-3 font-semibold">Routing Mode</th>
                      <th className="p-3 font-semibold">SSL Status</th>
                      <th className="p-3 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--axon-border)]">
                    {domains.map((dom) => (
                      <tr key={dom.id} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="text-sm">🌐</span>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <a
                                  href={`https://${dom.domain}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono font-medium text-[var(--axon-text)] hover:text-[var(--axon-primary)]"
                                >
                                  {dom.domain}
                                </a>
                                {dom.is_primary === 1 && (
                                  <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.2 text-[10px] font-bold text-emerald-400">
                                    PRIMARY
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="p-3">
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${
                              dom.domain_type === "primary"
                                ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                                : dom.domain_type === "subdomain"
                                  ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/30"
                                  : "bg-slate-500/15 text-slate-300 border-slate-500/30"
                            }`}
                          >
                            {dom.domain_type.toUpperCase()}
                          </span>
                        </td>
                        <td className="p-3">
                          {dom.routing_type === "redirect" ? (
                            <div>
                              <span className="rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                                301 Redirect
                              </span>
                              <p className="mono mt-0.5 truncate text-[11px] text-[var(--axon-muted)] max-w-xs" title={dom.target_url || ""}>
                                → {dom.target_url}
                              </p>
                            </div>
                          ) : (
                            <div>
                              <span className="rounded bg-teal-500/15 text-teal-400 border border-teal-500/30 px-1.5 py-0.5 text-[10px] font-semibold">
                                Direct App
                              </span>
                              <p className="mono mt-0.5 text-[11px] text-[var(--axon-muted)]">
                                Serves document root
                              </p>
                            </div>
                          )}
                        </td>
                        <td className="p-3">
                          {dom.ssl_active === 1 ? (
                            <Badge tone="ok">🔒 SSL Active</Badge>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Badge tone="warn">No SSL</Badge>
                              <Button
                                variant="ghost"
                                loading={busyAction}
                                onClick={() => handleIssueDomainSsl(dom)}
                                className="text-[11px] py-0.5 px-2 text-[var(--axon-primary)]"
                              >
                                Issue SSL
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {dom.is_primary === 0 && (
                              <Button
                                variant="ghost"
                                loading={busyAction}
                                onClick={() => handlePromotePrimary(dom)}
                                title="Set as the primary domain for this site"
                                className="text-[11px] py-1 px-2"
                              >
                                Make Primary
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              onClick={() => openEditDomain(dom)}
                              className="text-[11px] py-1 px-2"
                            >
                              Edit
                            </Button>
                            {dom.is_primary === 0 && (
                              <Button
                                variant="danger"
                                loading={busyAction}
                                onClick={() => setDeletingDomain(dom)}
                                className="text-[11px] py-1 px-2"
                              >
                                Remove
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Stack Specific Toolkit */}
        {activeTab === "toolkit" && !isWp && (
          <div className="space-y-4 pt-1">
            {/* WordPress Toolkit */}
            {stack?.type === "wordpress" && wpData && (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--axon-border)] pb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--axon-text)]">WordPress Toolkit</h4>
                    <p className="text-xs text-[var(--axon-muted)]">Core {wpData.version} · Active Theme: {wpData.activeTheme}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" loading={busyAction} onClick={optimizeWp}>Optimize DB</Button>
                    <Button variant="primary" loading={busyAction} onClick={applyWpSecurity}>Apply Hardening</Button>
                  </div>
                </div>

                {/* Plugins Table */}
                <div>
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-2">
                    Installed Plugins ({wpData.plugins?.length || 0})
                  </h5>
                  <div className="overflow-x-auto rounded-lg border border-[var(--axon-border)]">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-card)] text-[10px] uppercase text-[var(--axon-muted)]">
                          <th className="p-2.5">Plugin Name</th>
                          <th className="p-2.5">Version</th>
                          <th className="p-2.5">Status</th>
                          <th className="p-2.5 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--axon-border)]">
                        {wpData.plugins?.map((plugin: WpPlugin) => (
                          <tr key={plugin.name} className="hover:bg-[var(--axon-card-hover)]">
                            <td className="p-2.5 font-medium text-[var(--axon-text)]">{plugin.name}</td>
                            <td className="p-2.5 mono text-[11px] text-[var(--axon-muted)]">{plugin.version}</td>
                            <td className="p-2.5">
                              <Badge tone={plugin.status === "active" ? "ok" : "neutral"}>
                                {plugin.status}
                              </Badge>
                            </td>
                            <td className="p-2.5 text-right">
                              <button
                                onClick={() => togglePlugin(plugin.name, plugin.status !== "active")}
                                disabled={busyAction}
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded border ${
                                  plugin.status === "active"
                                    ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10"
                                    : "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                                }`}
                              >
                                {plugin.status === "active" ? "Deactivate" : "Activate"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Laravel Framework Manager */}
            {stack?.type === "laravel" && laravelData && (
              <div className="space-y-4">
                <div className="border-b border-[var(--axon-border)] pb-3">
                  <h4 className="text-sm font-semibold text-[var(--axon-text)]">Laravel Framework Manager</h4>
                  <p className="text-xs text-[var(--axon-muted)]">{laravelData.version} · App: {laravelData.envSummary?.appName} ({laravelData.envSummary?.appEnv})</p>
                </div>

                {/* Artisan Runner Console */}
                <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">Artisan Command Runner</h5>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("migrate:status")}>
                      📊 migrate:status
                    </Button>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("cache:clear")}>
                      🧹 cache:clear
                    </Button>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("config:cache")}>
                      ⚡ config:cache
                    </Button>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("route:cache")}>
                      🛣️ route:cache
                    </Button>
                    <Button variant="ghost" loading={busyAction} onClick={() => runArtisanCmd("storage:link")}>
                      🔗 storage:link
                    </Button>
                  </div>

                  {artisanOutput && (
                    <div className="rounded bg-[#080F19] p-3 mono text-xs text-emerald-300 whitespace-pre-wrap max-h-48 overflow-y-auto border border-[var(--axon-border)]">
                      {artisanOutput}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Astro & Node.js Engine */}
            {(stack?.type === "astro" || stack?.type === "nodejs" || stack?.type === "nextjs") && nodeData && (
              <div className="space-y-4">
                <div className="border-b border-[var(--axon-border)] pb-3">
                  <h4 className="text-sm font-semibold text-[var(--axon-text)]">
                    {stack.type === "astro" ? "Astro Modern Web Engine" : "Node.js Application Manager"}
                  </h4>
                  <p className="text-xs text-[var(--axon-muted)]">
                    Mode: {nodeData.mode || "standard"} · Package Manager: {nodeData.packageManager || "npm"}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Deployment Mode</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--axon-text)] capitalize">{nodeData.mode || "Static HTML"}</p>
                    <p className="text-xs text-[var(--axon-muted)] mt-0.5">
                      {nodeData.mode === "ssr" ? "Standalone Node adapter daemon" : "Direct Nginx static serving (Zero CPU/RAM overhead)"}
                    </p>
                  </div>

                  <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Build Status</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
                      {nodeData.distExists ? "Build Artifacts Present" : "Not Built Yet"}
                    </p>
                    <p className="text-xs text-[var(--axon-muted)] mt-0.5">Output target: dist/</p>
                  </div>
                </div>

                <Button variant="primary" loading={busyAction} onClick={triggerBuild}>
                  🚀 Trigger Production Build
                </Button>
              </div>
            )}
          </div>
        )}

        {/* WordPress Toolkit Pro Tabs */}
        {activeTab === "security" && isWp && (
          <WpSecurityTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "optimization" && isWp && (
          <WpOptimizationTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "cache" && isWp && (
          <WpCacheTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "users" && isWp && (
          <WpUsersTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "plugins-themes" && isWp && (
          <WpPluginsThemesTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "database" && isWp && (
          <WpDatabaseTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "backup" && isWp && (
          <WpBackupTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {activeTab === "logs" && isWp && (
          <WpLogsTab siteName={site.name} docroot={stack?.docroot || site.roots[0] || "/var/www"} />
        )}

        {/* Tab 3: Nginx VHost */}
        {activeTab === "vhost" && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-[var(--axon-text)]">Nginx Virtual Host Configuration</h4>
                <p className="text-xs text-[var(--axon-muted)]">`/etc/nginx/sites-available/{site.name}`</p>
              </div>
              <Button variant="primary" loading={savingVhost} onClick={saveVhost}>
                Save & Reload Nginx
              </Button>
            </div>
            <textarea
              className="field mono text-xs h-80 bg-[#080F19] text-[var(--axon-text)] border-[var(--axon-border)]"
              value={vhostContent}
              onChange={(e) => setVhostContent(e.target.value)}
              spellCheck={false}
            />
          </div>
        )}

        {/* Tab 4: Git & Deployment */}
        {activeTab === "git" && (
          <div className="space-y-4 pt-1">
            <div className="border-b border-[var(--axon-border)] pb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-semibold text-[var(--axon-text)]">Git Source & Deployments</h4>
                <p className="text-xs text-[var(--axon-muted)]">Continuous integration and deployment hooks</p>
              </div>
              <div className="flex items-center gap-2">
                {gitData?.hasGit && (
                  <Button variant="ghost" loading={busyAction} onClick={handlePullGit}>
                    ⬇ Pull Code
                  </Button>
                )}
                <Link
                  to={`/sites/${encodeURIComponent(site.name)}/git`}
                  onClick={onClose}
                  className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] px-3 py-1.5 text-xs text-[var(--axon-text)] hover:text-[var(--axon-primary)] transition"
                >
                  Full Git Settings →
                </Link>
              </div>
            </div>

            {gitData?.hasGit ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Active Branch</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--axon-primary)] mono">{gitData.branch}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Working Tree</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
                      {gitData.clean ? "Clean" : `${gitData.changesCount} uncommitted changes`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
                    <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Latest Commit</p>
                    <p className="mt-1 text-xs mono text-[var(--axon-text)] truncate">{gitData.commit ? gitData.commit.slice(0, 7) : gitData.latestCommit || "None"}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <h5 className="text-xs font-bold uppercase text-[var(--axon-muted)] mb-2">Automated Webhook Deployment</h5>
                  <p className="text-xs text-[var(--axon-muted)] mb-3">
                    Add this webhook URL to your GitHub or GitLab repository to trigger automatic deployments on push:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      className="field mono text-xs select-all flex-1"
                      readOnly
                      value={gitData?.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/sites/${site.name}/git/webhook`}
                    />
                    <Button variant="ghost" onClick={() => {
                      navigator.clipboard.writeText(gitData?.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/sites/${site.name}/git/webhook`);
                      toast("ok", "Webhook URL copied to clipboard");
                    }}>
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center space-y-3">
                <p className="text-xs text-[var(--axon-muted)]">
                  No Git repository initialized in this website root directory.
                </p>
                <Link
                  to={`/sites/${encodeURIComponent(site.name)}/git`}
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--axon-primary)] text-white text-xs font-medium hover:opacity-90"
                >
                  🔗 Connect Git Repository →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* Add Domain / Subdomain Modal */}
        <Modal
          open={showAddDomain}
          title={`Add Domain / Subdomain to ${site.name}`}
          onClose={() => setShowAddDomain(false)}
          width="max-w-md"
        >
          <div className="space-y-4">
            <Field label="Domain / Subdomain" hint="e.g. api.yourdomain.com or newalias.com">
              <input
                className="field mono text-xs w-full"
                placeholder={site ? `sub.${site.serverNames[0] || site.name}` : "domain.com"}
                value={newDomain}
                onChange={(e) => {
                  const val = e.target.value;
                  setNewDomain(val);
                  if (site && val.endsWith(`.${site.serverNames[0] || site.name}`)) {
                    setNewDomainType("subdomain");
                  }
                }}
              />
            </Field>

            <Field label="Domain Classification">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    newDomainType === "subdomain"
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                  }`}
                  onClick={() => setNewDomainType("subdomain")}
                >
                  <p className="font-semibold text-[var(--axon-text)]">Subdomain</p>
                  <p className="text-[10px] mt-0.5">e.g. app.{site.serverNames[0] || site.name}</p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    newDomainType === "alias"
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                  }`}
                  onClick={() => setNewDomainType("alias")}
                >
                  <p className="font-semibold text-[var(--axon-text)]">Alias Domain</p>
                  <p className="text-[10px] mt-0.5">e.g. yourbrand.net</p>
                </button>
              </div>
            </Field>

            <Field label="Routing Mode">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    newRoutingType === "direct"
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                  }`}
                  onClick={() => setNewRoutingType("direct")}
                >
                  <p className="font-semibold text-[var(--axon-text)]">Direct App</p>
                  <p className="text-[10px] mt-0.5">Serves site files directly</p>
                </button>
                <button
                  type="button"
                  className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                    newRoutingType === "redirect"
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                  }`}
                  onClick={() => setNewRoutingType("redirect")}
                >
                  <p className="font-semibold text-[var(--axon-text)]">HTTP Redirect</p>
                  <p className="text-[10px] mt-0.5">Forwards traffic to a URL</p>
                </button>
              </div>
            </Field>

            {newRoutingType === "redirect" && (
              <>
                <Field label="Redirect Target URL">
                  <input
                    className="field mono text-xs w-full"
                    placeholder={`https://${site.serverNames[0] || site.name}$request_uri`}
                    value={newTargetUrl}
                    onChange={(e) => setNewTargetUrl(e.target.value)}
                  />
                </Field>
                <Field label="HTTP Status Code">
                  <select
                    className="field text-xs w-full"
                    value={newRedirectCode}
                    onChange={(e) => setNewRedirectCode(Number(e.target.value))}
                  >
                    <option value={301}>301 Moved Permanently (SEO Recommended)</option>
                    <option value={302}>302 Found (Temporary)</option>
                  </select>
                </Field>
              </>
            )}

            <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--axon-text)] pt-1">
              <input
                type="checkbox"
                checked={newIssueSsl}
                onChange={(e) => setNewIssueSsl(e.target.checked)}
                className="rounded border-[var(--axon-border)] accent-[var(--axon-primary)]"
              />
              <span>Request Let's Encrypt SSL certificate automatically</span>
            </label>

            <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
              <Button variant="outline" onClick={() => setShowAddDomain(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={busyAction}
                disabled={!newDomain.trim()}
                onClick={handleAddDomain}
              >
                Add Domain
              </Button>
            </div>
          </div>
        </Modal>

        {/* Edit Domain Modal */}
        <Modal
          open={Boolean(editingDomain)}
          title={`Edit Domain: ${editingDomain?.domain ?? ""}`}
          onClose={() => setEditingDomain(null)}
          width="max-w-md"
        >
          {editingDomain && (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-lg bg-[var(--axon-sidebar)] p-3 border border-[var(--axon-border)]">
                <div>
                  <p className="font-mono font-bold text-sm text-[var(--axon-text)]">{editingDomain.domain}</p>
                  <p className="text-xs text-[var(--axon-muted)]">
                    {editingDomain.is_primary ? "Primary Domain" : "Additional Domain"}
                  </p>
                </div>
                {editingDomain.is_primary === 0 && (
                  <Button
                    variant="ghost"
                    loading={busyAction}
                    onClick={() => handlePromotePrimary(editingDomain)}
                    className="text-xs text-[var(--axon-primary)]"
                  >
                    ⭐ Make Primary
                  </Button>
                )}
              </div>

              {editingDomain.is_primary === 0 && (
                <>
                  <Field label="Domain Classification">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          editDomainType === "subdomain"
                            ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                            : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                        }`}
                        onClick={() => setEditDomainType("subdomain")}
                      >
                        <p className="font-semibold text-[var(--axon-text)]">Subdomain</p>
                      </button>
                      <button
                        type="button"
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          editDomainType === "alias"
                            ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                            : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                        }`}
                        onClick={() => setEditDomainType("alias")}
                      >
                        <p className="font-semibold text-[var(--axon-text)]">Alias Domain</p>
                      </button>
                    </div>
                  </Field>

                  <Field label="Routing Mode">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          editRoutingType === "direct"
                            ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                            : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                        }`}
                        onClick={() => setEditRoutingType("direct")}
                      >
                        <p className="font-semibold text-[var(--axon-text)]">Direct App</p>
                      </button>
                      <button
                        type="button"
                        className={`p-2.5 rounded-lg border text-left text-xs transition-colors ${
                          editRoutingType === "redirect"
                            ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                            : "border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]"
                        }`}
                        onClick={() => setEditRoutingType("redirect")}
                      >
                        <p className="font-semibold text-[var(--axon-text)]">HTTP Redirect</p>
                      </button>
                    </div>
                  </Field>

                  {editRoutingType === "redirect" && (
                    <>
                      <Field label="Redirect Target URL">
                        <input
                          className="field mono text-xs w-full"
                          value={editTargetUrl}
                          onChange={(e) => setEditTargetUrl(e.target.value)}
                        />
                      </Field>
                      <Field label="HTTP Status Code">
                        <select
                          className="field text-xs w-full"
                          value={editRedirectCode}
                          onChange={(e) => setEditRedirectCode(Number(e.target.value))}
                        >
                          <option value={301}>301 Moved Permanently</option>
                          <option value={302}>302 Found (Temporary)</option>
                        </select>
                      </Field>
                    </>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
                <Button variant="outline" onClick={() => setEditingDomain(null)}>
                  Cancel
                </Button>
                <Button variant="primary" loading={busyAction} onClick={handleUpdateDomain}>
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </Modal>

        {/* Delete Domain Confirmation */}
        <ConfirmDialog
          open={Boolean(deletingDomain)}
          title={`Remove Domain: ${deletingDomain?.domain ?? ""}`}
          message={`Are you sure you want to remove the domain "${deletingDomain?.domain}" from website "${site.name}"? Nginx routing for this domain will be removed immediately.`}
          confirmLabel="Remove Domain"
          busy={busyAction}
          onCancel={() => setDeletingDomain(null)}
          onConfirm={handleDeleteDomain}
        />
      </div>
    </Modal>
  );
}
