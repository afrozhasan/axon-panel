import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBanner, Field, Modal, Spinner, Tabs, useToast } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";
import WpSecurityTab from "../components/wp/WpSecurityTab";
import WpOptimizationTab from "../components/wp/WpOptimizationTab";
import WpCacheTab from "../components/wp/WpCacheTab";
import WpPluginsThemesTab from "../components/wp/WpPluginsThemesTab";
import WpUsersTab from "../components/wp/WpUsersTab";
import WpDatabaseTab from "../components/wp/WpDatabaseTab";
import WpBackupTab from "../components/wp/WpBackupTab";
import WpLogsTab from "../components/wp/WpLogsTab";

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

export default function SiteDetail() {
  const { name, tab: urlTab } = useParams<{ name: string; tab?: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [site, setSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(urlTab || "overview");

  // Stack info
  const [stack, setStack] = useState<StackInfo | null>(null);
  const [laravelData, setLaravelData] = useState<any>(null);
  const [nodeData, setNodeData] = useState<any>(null);
  const [gitData, setGitData] = useState<any>(null);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [gitRunBuild, setGitRunBuild] = useState(true);
  const [gitBusy, setGitBusy] = useState(false);
  const [gitOutput, setGitOutput] = useState<string | null>(null);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [showSwitchBranchModal, setShowSwitchBranchModal] = useState(false);
  const [targetBranch, setTargetBranch] = useState("");
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [artisanOutput, setArtisanOutput] = useState<string | null>(null);

  // Domains
  const [domains, setDomains] = useState<DomainEntry[]>([]);
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [newDomainType, setNewDomainType] = useState<"subdomain" | "alias">("subdomain");
  const [newRoutingType, setNewRoutingType] = useState<"direct" | "redirect">("direct");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newRedirectCode, setNewRedirectCode] = useState(301);
  const [newIssueSsl, setNewIssueSsl] = useState(false);

  // Vhost & PHP
  const [vhostContent, setVhostContent] = useState("");
  const [savingVhost, setSavingVhost] = useState(false);
  const [selectedPhp, setSelectedPhp] = useState("8.4");
  const [busyAction, setBusyAction] = useState(false);

  const loadSite = async () => {
    if (!name) return;
    setLoading(true);
    try {
      const sitesRes = await api.get<{ sites: Site[] }>("/sites");
      const found = sitesRes.sites?.find((s) => s.name === name);
      if (!found) {
        setError(`Website "${name}" not found.`);
        setLoading(false);
        return;
      }
      setSite(found);
      setSelectedPhp(found.phpVersion || "8.4");

      // Load stack and secondary details
      const [stackRes, gitRes, vhostRes, domainsRes] = await Promise.all([
        api.get<StackInfo>(`/sites/${encodeURIComponent(name)}/stack`).catch(() => null),
        api.get<any>(`/sites/${encodeURIComponent(name)}/git`).catch(() => null),
        api.get<{ content: string }>(`/sites/${encodeURIComponent(name)}`).catch(() => ({ content: "" })),
        api.get<{ domains: DomainEntry[] }>(`/sites/${encodeURIComponent(name)}/domains`).catch(() => ({ domains: [] })),
      ]);

      if (stackRes) {
        setStack(stackRes);
        if (stackRes.type === "laravel") {
          const lRes = await api.get<any>(`/sites/${encodeURIComponent(name)}/laravel`).catch(() => null);
          setLaravelData(lRes);
        } else if (stackRes.type === "astro" || stackRes.type === "nodejs" || stackRes.type === "nextjs") {
          const nRes = await api.get<any>(`/sites/${encodeURIComponent(name)}/node`).catch(() => null);
          setNodeData(nRes);
        }
      }

      setGitData(gitRes);
      setVhostContent(vhostRes.content || "");
      setDomains(domainsRes.domains || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSite();
  }, [name]);

  useEffect(() => {
    if (urlTab && urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [urlTab]);

  const handleTabChange = (t: string) => {
    setActiveTab(t);
    navigate(`/sites/${encodeURIComponent(name || "")}/${t}`, { replace: true });
  };

  const handleToggleSite = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      const action = site.enabled ? "disable" : "enable";
      await api.post(`/sites/${encodeURIComponent(site.name)}/${action}`);
      toast("ok", `Site ${site.name} ${site.enabled ? "disabled" : "enabled"}`);
      await loadSite();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleSwitchPhp = async () => {
    if (!site) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(site.name)}/switch-php`, { version: selectedPhp });
      toast("ok", `Switched to PHP ${selectedPhp}`);
      await loadSite();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
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
      toast("ok", `Domain ${newDomain.trim()} attached`);
      setShowAddDomain(false);
      setNewDomain("");
      setNewTargetUrl("");
      const domRes = await api.get<{ domains: DomainEntry[] }>(`/sites/${encodeURIComponent(site.name)}/domains`);
      setDomains(domRes.domains || []);
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
      await loadSite();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSavingVhost(false);
    }
  };

  const runArtisan = async (cmd: string) => {
    if (!site) return;
    setBusyAction(true);
    try {
      const res = await api.post<{ ok: boolean; output: string }>(
        `/sites/${encodeURIComponent(site.name)}/laravel/artisan`,
        { command: cmd },
      );
      setArtisanOutput(res.output || "Completed with no output.");
      toast("ok", `artisan ${cmd} executed`);
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
      const res = await api.post<{ task: { id: string } }>(
        `/sites/${encodeURIComponent(site.name)}/node/build`,
      );
      toast("ok", `Build enqueued (Task: ${res.task.id})`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleConnectGit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!name || !gitRepoUrl.trim()) {
      toast("error", "Please provide a valid Git repository URL");
      return;
    }
    setGitBusy(true);
    setGitOutput(null);
    try {
      const res = await api.post<{ ok: boolean; message: string; buildTask?: any }>(
        `/sites/${encodeURIComponent(name)}/git/connect`,
        {
          repoUrl: gitRepoUrl.trim(),
          branch: gitBranch.trim() || "main",
          action: "clone",
          runBuild: gitRunBuild,
        }
      );
      toast("ok", res.message || "Connected to Git repository successfully");
      if (res.buildTask) {
        toast("ok", `Automated build task enqueued (Task: ${res.buildTask.id})`);
      }
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(name)}/git`);
      setGitData(updatedGit);
      setGitRepoUrl("");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setGitBusy(false);
    }
  };

  const handleInitGit = async () => {
    if (!name) return;
    setGitBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/sites/${encodeURIComponent(name)}/git/connect`,
        { action: "init" }
      );
      toast("ok", res.message || "Local Git repository initialized");
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(name)}/git`);
      setGitData(updatedGit);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setGitBusy(false);
    }
  };

  const handlePullGit = async (rebuild = false) => {
    if (!name) return;
    setGitBusy(true);
    try {
      const res = await api.post<{ ok: boolean; output: string; buildTask?: any }>(
        `/sites/${encodeURIComponent(name)}/git/pull`,
        { rebuild }
      );
      setGitOutput(res.output || "Already up to date.");
      toast("ok", rebuild ? "Pulled latest changes & build enqueued" : "Pulled latest changes from origin");
      if (res.buildTask) {
        toast("ok", `Build enqueued (Task: ${res.buildTask.id})`);
      }
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(name)}/git`);
      setGitData(updatedGit);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setGitBusy(false);
    }
  };

  const handleSwitchBranch = async () => {
    if (!name || !targetBranch.trim()) return;
    setGitBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/sites/${encodeURIComponent(name)}/git/branch`,
        { branch: targetBranch.trim() }
      );
      toast("ok", res.message || `Switched to branch ${targetBranch.trim()}`);
      setShowSwitchBranchModal(false);
      setTargetBranch("");
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(name)}/git`);
      setGitData(updatedGit);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setGitBusy(false);
    }
  };

  const handleDisconnectGit = async (removeGit = false) => {
    if (!name) return;
    setGitBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/sites/${encodeURIComponent(name)}/git/disconnect`,
        { removeGit }
      );
      toast("ok", res.message || "Git disconnected");
      setShowDisconnectModal(false);
      const updatedGit = await api.get<any>(`/sites/${encodeURIComponent(name)}/git`);
      setGitData(updatedGit);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setGitBusy(false);
    }
  };

  const copyToClipboard = (text: string, type: "key" | "webhook") => {
    navigator.clipboard.writeText(text);
    if (type === "key") {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } else {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
    toast("ok", "Copied to clipboard!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-[var(--axon-muted)]">
        <Spinner /> Loading website workspace…
      </div>
    );
  }

  if (!site) {
    return (
      <div className="space-y-4">
        <Breadcrumbs items={[{ label: "Websites", to: "/sites" }, { label: name || "Not Found" }]} />
        <Card>
          <EmptyState
            title="Website not found"
            description={`Could not locate a website with the name "${name}".`}
          >
            <div className="mt-4">
              <Link to="/sites" className="rounded-lg bg-[var(--axon-primary)] px-4 py-2 text-xs font-semibold text-[var(--axon-primary-fg)]">
                Back to All Websites
              </Link>
            </div>
          </EmptyState>
        </Card>
      </div>
    );
  }

  const isWp = stack?.type === "wordpress";
  const isAstro = stack?.type === "astro";
  const isLaravel = stack?.type === "laravel";
  const isNode = stack?.type === "nodejs" || stack?.type === "nextjs";

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "domains", label: "Domains & Subdomains", badge: domains.length ? `${domains.length}` : undefined },
    { id: "settings", label: "Settings" },
    ...(isWp
      ? [
          { id: "security", label: "Security", badge: "Audit" },
          { id: "optimization", label: "Optimization", badge: "Pro" },
          { id: "cache", label: "Cache Manager", badge: "FastCGI/Redis" },
          { id: "users", label: "Users" },
          { id: "plugins-themes", label: "Plugins & Themes" },
          { id: "database", label: "Database" },
          { id: "backup", label: "Backup" },
          { id: "logs", label: "Logs" },
        ]
      : [
          {
            id: "toolkit",
            label: isLaravel ? "Laravel" : isAstro ? "Astro Engine" : isNode ? "Node.js" : "Runtime",
          },
        ]),
    { id: "git", label: "Git & Deployment", badge: gitData?.hasGit ? "Active" : undefined },
    { id: "vhost", label: "Nginx VHost" },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Websites", to: "/sites" }, { label: site.name }, { label: activeTab }]} />

      <ErrorBanner message={error} />

      {/* Header Card */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 border border-blue-500/30 text-lg font-black text-white shadow-md shadow-blue-500/20">
              {site.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[var(--axon-text)]">{site.name}</h1>
                <Badge tone={site.enabled ? "ok" : "warn"}>{site.enabled ? "Active" : "Disabled"}</Badge>
                {site.ssl && <Badge tone="ok">SSL Protected</Badge>}
                <span className="rounded-full bg-slate-500/15 border border-slate-500/30 px-2 py-0.5 text-[10px] font-bold text-slate-300 uppercase">
                  {stack?.type || site.kind}
                </span>
              </div>
              <p className="text-xs font-mono text-[var(--axon-muted)] mt-1">
                Root: {site.roots?.[0] || stack?.docroot || `/var/www/${site.name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href={`https://${site.serverNames?.[0] || site.name}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--axon-text)] hover:border-[var(--axon-primary)]/50 transition"
            >
              Visit Site ↗
            </a>
            <Button
              variant={site.enabled ? "secondary" : "primary"}
              disabled={busyAction}
              onClick={handleToggleSite}
            >
              {site.enabled ? "Disable Site" : "Enable Site"}
            </Button>
          </div>
        </div>
      </div>

      {/* Contextual Navigation Tabs */}
      <Tabs tabs={tabs} active={activeTab} onChange={handleTabChange} />

      {/* Tab: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Runtime Stack</p>
              <p className="text-lg font-bold text-[var(--axon-text)] mt-1 capitalize">{stack?.type || site.kind}</p>
              <p className="text-xs text-[var(--axon-muted)] mt-0.5">PHP Version: {site.phpVersion || "8.4"}</p>
            </div>

            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">SSL Encryption</p>
              <p className="text-lg font-bold text-[var(--axon-text)] mt-1">{site.ssl ? "Let's Encrypt Active" : "No SSL Active"}</p>
              <p className="text-xs text-[var(--axon-muted)] mt-0.5">HTTPS Automatic Redirect</p>
            </div>

            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Attached Domains</p>
              <p className="text-lg font-bold text-[var(--axon-primary)] mt-1">{domains.length || 1}</p>
              <p className="text-xs text-[var(--axon-muted)] mt-0.5">Primary: {site.serverNames?.[0] || site.name}</p>
            </div>

            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Git Deployment</p>
              <p className="text-lg font-bold text-[var(--axon-text)] mt-1">{gitData?.hasGit ? "Linked" : "Not Linked"}</p>
              <p className="text-xs text-[var(--axon-muted)] mt-0.5">{gitData?.branch ? `Branch: ${gitData.branch}` : "Direct upload"}</p>
            </div>
          </div>

          <Card title="Quick Management Actions">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Button variant="ghost" onClick={() => handleTabChange("domains")}>
                🌐 Manage Domains & Subdomains
              </Button>
              <Button variant="ghost" onClick={() => handleTabChange("settings")}>
                ⚙️ PHP & Runtime Settings
              </Button>
              <Button variant="ghost" onClick={() => handleTabChange("vhost")}>
                📝 Raw Nginx Configuration
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Domains */}
      {activeTab === "domains" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--axon-text)]">Attached Domains & Routing Rules</h3>
            <Button variant="primary" onClick={() => setShowAddDomain(true)}>
              + Attach Domain
            </Button>
          </div>

          {showAddDomain && (
            <Card title="Attach Domain to Website">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--axon-muted)] mb-1">Domain Name</label>
                  <input
                    type="text"
                    placeholder="sub.domain.com"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    className="field w-full text-xs font-mono"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--axon-muted)] mb-1">Domain Type</label>
                    <select
                      value={newDomainType}
                      onChange={(e) => setNewDomainType(e.target.value as any)}
                      className="field w-full text-xs"
                    >
                      <option value="subdomain">Subdomain</option>
                      <option value="alias">Domain Alias</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--axon-muted)] mb-1">Routing Mode</label>
                    <select
                      value={newRoutingType}
                      onChange={(e) => setNewRoutingType(e.target.value as any)}
                      className="field w-full text-xs"
                    >
                      <option value="direct">Direct Serving</option>
                      <option value="redirect">301 Redirect</option>
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setShowAddDomain(false)}>Cancel</Button>
                  <Button variant="primary" loading={busyAction} onClick={handleAddDomain}>Add Domain</Button>
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                    <th className="px-4 py-2.5">Domain</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Routing</th>
                    <th className="px-4 py-2.5">SSL</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--axon-border)]">
                  {domains.map((d) => (
                    <tr key={d.id || d.domain} className="hover:bg-[var(--axon-card-hover)] transition">
                      <td className="px-4 py-2.5 font-semibold text-[var(--axon-text)] font-mono">{d.domain}</td>
                      <td className="px-4 py-2.5 capitalize text-[var(--axon-muted)]">{d.domain_type}</td>
                      <td className="px-4 py-2.5 text-[var(--axon-muted)]">{d.routing_type}</td>
                      <td className="px-4 py-2.5">
                        <Badge tone={d.ssl_active ? "ok" : "warn"}>{d.ssl_active ? "Active" : "None"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Tab: Settings */}
      {activeTab === "settings" && (
        <Card title="Runtime & Stack Settings">
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-[var(--axon-muted)] mb-1">PHP-FPM Version</label>
              <div className="flex gap-2">
                <select
                  value={selectedPhp}
                  onChange={(e) => setSelectedPhp(e.target.value)}
                  className="field flex-1 text-xs"
                >
                  <option value="8.4">PHP 8.4 (Latest)</option>
                  <option value="8.3">PHP 8.3 (Stable)</option>
                  <option value="8.2">PHP 8.2</option>
                  <option value="8.1">PHP 8.1</option>
                </select>
                <Button variant="primary" loading={busyAction} onClick={handleSwitchPhp}>
                  Switch PHP
                </Button>
              </div>
            </div>

            <div className="pt-4 border-t border-[var(--axon-border)]">
              <p className="text-xs text-[var(--axon-muted)] mb-2">Website Lifecycle Control</p>
              <Button variant="danger" onClick={handleToggleSite}>
                {site.enabled ? "Deactivate Website" : "Activate Website"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Tab: WordPress Modules */}
      {isWp && activeTab === "security" && <WpSecurityTab siteName={site.name} />}
      {isWp && activeTab === "optimization" && <WpOptimizationTab siteName={site.name} />}
      {isWp && activeTab === "cache" && <WpCacheTab siteName={site.name} />}
      {isWp && activeTab === "users" && <WpUsersTab siteName={site.name} />}
      {isWp && activeTab === "plugins-themes" && <WpPluginsThemesTab siteName={site.name} />}
      {isWp && activeTab === "database" && <WpDatabaseTab siteName={site.name} />}
      {isWp && activeTab === "backup" && <WpBackupTab siteName={site.name} />}
      {isWp && activeTab === "logs" && <WpLogsTab siteName={site.name} />}

      {/* Tab: Non-WordPress Toolkits */}
      {!isWp && activeTab === "toolkit" && (
        <div className="space-y-4">
          {isLaravel && (
            <Card title="Laravel Framework Manager">
              <div className="space-y-4">
                <p className="text-xs text-[var(--axon-muted)]">
                  {laravelData?.version || "Laravel Framework"} · Environment: {laravelData?.envSummary?.appEnv || "production"}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" loading={busyAction} onClick={() => runArtisan("migrate:status")}>
                    📊 migrate:status
                  </Button>
                  <Button variant="ghost" loading={busyAction} onClick={() => runArtisan("cache:clear")}>
                    🧹 cache:clear
                  </Button>
                  <Button variant="ghost" loading={busyAction} onClick={() => runArtisan("config:cache")}>
                    ⚡ config:cache
                  </Button>
                  <Button variant="ghost" loading={busyAction} onClick={() => runArtisan("storage:link")}>
                    🔗 storage:link
                  </Button>
                </div>
                {artisanOutput && (
                  <pre className="p-3 rounded bg-[var(--axon-input-bg)] border border-[var(--axon-border)] font-mono text-xs text-emerald-300 overflow-x-auto">
                    {artisanOutput}
                  </pre>
                )}
              </div>
            </Card>
          )}

          {(isAstro || isNode) && (
            <Card title={isAstro ? "Astro Modern Web Engine" : "Node.js Application Manager"}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                    <p className="text-[11px] font-bold text-[var(--axon-muted)]">Deployment Mode</p>
                    <p className="text-sm font-semibold text-[var(--axon-text)] capitalize mt-1">
                      {nodeData?.mode || (isAstro ? "Static" : "Node Daemon")}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                    <p className="text-[11px] font-bold text-[var(--axon-muted)]">Build Artifacts</p>
                    <p className="text-sm font-semibold text-[var(--axon-text)] mt-1">
                      {nodeData?.distExists ? "dist/ Available" : "Build Required"}
                    </p>
                  </div>
                </div>
                <Button variant="primary" loading={busyAction} onClick={triggerBuild}>
                  🚀 Trigger Production Build
                </Button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Tab: Git & Deployment */}
      {activeTab === "git" && (
        <div className="space-y-6">
          {/* Header Card */}
          <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500/20 to-red-500/20 border border-orange-500/30 text-orange-400">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
                    <path d="M6 3v12m0 0a3 3 0 103 3V6a3 3 0 10-3-3zm12 6a3 3 0 10-3-3v6a3 3 0 103 3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-bold text-[var(--axon-text)]">Git Source & Continuous Deployment</h3>
                  <p className="text-xs text-[var(--axon-muted)]">
                    Link this website with GitHub, GitLab, or Bitbucket for one-click code sync and automated push deployments.
                  </p>
                </div>
              </div>
              {gitData?.hasGit && (
                <div className="flex items-center gap-2">
                  <Button variant="ghost" loading={gitBusy} onClick={() => handlePullGit(false)}>
                    ⬇ Pull Code
                  </Button>
                  <Button variant="primary" loading={gitBusy} onClick={() => handlePullGit(true)}>
                    🚀 Pull & Rebuild
                  </Button>
                  <Button variant="danger" loading={gitBusy} onClick={() => setShowDisconnectModal(true)}>
                    Disconnect
                  </Button>
                </div>
              )}
            </div>
          </div>

          {gitOutput && (
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">Git Output</span>
                <button
                  type="button"
                  onClick={() => setGitOutput(null)}
                  className="text-xs text-[var(--axon-muted)] hover:text-[var(--axon-text)]"
                >
                  ✕ Close
                </button>
              </div>
              <pre className="p-3 rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] font-mono text-[11px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                {gitOutput}
              </pre>
            </div>
          )}

          {gitData?.hasGit ? (
            /* Connected State */
            <div className="space-y-6">
              {/* Metrics Grid */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Active Branch</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-sm font-bold font-mono text-[var(--axon-primary)]">{gitData.branch}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetBranch(gitData.branch || "main");
                        setShowSwitchBranchModal(true);
                      }}
                      className="text-[10px] text-[var(--axon-primary)] hover:underline font-semibold"
                    >
                      Switch →
                    </button>
                  </div>
                  <p className="text-xs text-[var(--axon-muted)] mt-0.5 truncate">Tracking origin/{gitData.branch}</p>
                </div>

                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Repository Remote</p>
                  <p className="text-sm font-semibold text-[var(--axon-text)] truncate mt-1" title={gitData.remoteUrl || "Local"}>
                    {gitData.remoteUrl ? gitData.remoteUrl.replace(/^https?:\/\/|git@/, "").replace(/:/, "/") : "Local Only"}
                  </p>
                  <p className="text-xs text-[var(--axon-muted)] mt-0.5 font-mono truncate">
                    {gitData.remoteUrl || "No remote attached"}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Latest Commit</p>
                  <p className="text-sm font-bold font-mono text-[var(--axon-text)] mt-1">
                    {gitData.commit ? gitData.commit.slice(0, 7) : "—"}
                  </p>
                  <p className="text-xs text-[var(--axon-muted)] mt-0.5 truncate" title={gitData.message}>
                    {gitData.message || "Initial checkout"}
                  </p>
                </div>

                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Working Tree</p>
                  <p className="text-sm font-semibold text-[var(--axon-text)] mt-1">
                    {gitData.clean ? "✅ Clean" : `⚠️ ${gitData.changesCount} uncommitted`}
                  </p>
                  <p className="text-xs text-[var(--axon-muted)] mt-0.5">
                    {gitData.date ? `Committed ${gitData.date}` : "Up to date"}
                  </p>
                </div>
              </div>

              {/* Commit Details Card */}
              {gitData.commit && (
                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">
                    Latest Repository Revision
                  </h4>
                  <div className="rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] p-3 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="mono font-semibold text-xs text-amber-400">{gitData.commit}</span>
                      <span className="text-xs text-[var(--axon-text)] font-medium">{gitData.message}</span>
                    </div>
                    <div className="flex items-center gap-4 text-[11px] text-[var(--axon-muted)]">
                      <span>Author: {gitData.author || "Unknown"}</span>
                      <span>•</span>
                      <span>Date: {gitData.date || "Recently"}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Webhook Push-to-Deploy */}
              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5">
                <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
                  <div>
                    <h4 className="text-sm font-semibold text-[var(--axon-text)]">Automated Webhook Deployment</h4>
                    <p className="text-xs text-[var(--axon-muted)] mt-0.5">
                      Configure your remote repository to trigger automated pulls whenever new commits are pushed.
                    </p>
                  </div>
                  <Badge tone="ok">Live Webhook</Badge>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      className="field mono text-xs select-all flex-1"
                      readOnly
                      value={gitData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/sites/${site?.name}/git/webhook`}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => copyToClipboard(gitData.webhookUrl || `${typeof window !== "undefined" ? window.location.origin : ""}/api/sites/${site?.name}/git/webhook`, "webhook")}
                    >
                      {copiedWebhook ? "✓ Copied!" : "Copy Webhook"}
                    </Button>
                  </div>
                  <div className="rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] p-3 text-xs text-[var(--axon-muted)] space-y-1.5">
                    <p className="font-semibold text-[var(--axon-text)]">GitHub Webhook Setup:</p>
                    <ol className="list-decimal list-inside space-y-1 text-[11px]">
                      <li>In your GitHub repo, navigate to <strong>Settings → Webhooks → Add webhook</strong>.</li>
                      <li>Paste the URL above into the <strong>Payload URL</strong> field.</li>
                      <li>Set <strong>Content type</strong> to <code className="mono text-white">application/json</code>.</li>
                      <li>Select <strong>Just the push event</strong>, and click <strong>Add webhook</strong>.</li>
                    </ol>
                  </div>
                </div>
              </div>

              {/* Server Deploy Key */}
              {gitData.deployKey && (
                <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5">
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
                    <div>
                      <h4 className="text-sm font-semibold text-[var(--axon-text)]">Server Public SSH Deploy Key</h4>
                      <p className="text-xs text-[var(--axon-muted)] mt-0.5">
                        Required if you clone private repositories via SSH (<code className="mono">git@github.com:...</code>).
                      </p>
                    </div>
                    <Button variant="ghost" onClick={() => copyToClipboard(gitData.deployKey, "key")}>
                      {copiedKey ? "✓ Copied!" : "Copy Deploy Key"}
                    </Button>
                  </div>
                  <div className="mt-3">
                    <pre className="p-3 rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] font-mono text-[11px] text-slate-300 break-all select-all whitespace-pre-wrap">
                      {gitData.deployKey}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Not Connected State: Form to Connect */
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Connect Form */}
              <div className="lg:col-span-2 rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-6 space-y-5">
                <div>
                  <h4 className="text-base font-semibold text-[var(--axon-text)]">Connect Remote Git Repository</h4>
                  <p className="text-xs text-[var(--axon-muted)] mt-1">
                    Provide your repository clone URL (HTTPS or SSH). Axon Panel will link this website's document root with your repository.
                  </p>
                </div>

                <form onSubmit={handleConnectGit} className="space-y-4">
                  <Field label="Repository Clone URL" hint="HTTPS or SSH clone URL">
                    <input
                      className="field mono text-xs w-full"
                      placeholder="https://github.com/username/repository.git or git@github.com:..."
                      value={gitRepoUrl}
                      onChange={(e) => setGitRepoUrl(e.target.value)}
                      required
                    />
                  </Field>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Target Branch" hint="Branch to checkout (e.g. main or master)">
                      <input
                        className="field mono text-xs w-full"
                        placeholder="main"
                        value={gitBranch}
                        onChange={(e) => setGitBranch(e.target.value)}
                        required
                      />
                    </Field>

                    <div className="flex flex-col justify-end">
                      <label className="flex items-center gap-2 text-xs text-[var(--axon-text)] cursor-pointer pb-2.5">
                        <input
                          type="checkbox"
                          checked={gitRunBuild}
                          onChange={(e) => setGitRunBuild(e.target.checked)}
                          className="rounded border-[var(--axon-border)]"
                        />
                        <span>Trigger production build after connecting</span>
                      </label>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-wrap items-center gap-3">
                    <Button variant="primary" loading={gitBusy} type="submit" disabled={!gitRepoUrl.trim()}>
                      🔗 Connect & Deploy Repository
                    </Button>
                    <Button variant="ghost" loading={gitBusy} type="button" onClick={handleInitGit}>
                      Initialize Local Git
                    </Button>
                  </div>
                </form>
              </div>

              {/* Deploy Key Sidebox */}
              <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">
                    SSH Deploy Key
                  </h4>
                  <Button variant="ghost" className="text-xs py-0.5 px-2" onClick={() => copyToClipboard(gitData?.deployKey || "", "key")}>
                    {copiedKey ? "✓ Copied" : "Copy Key"}
                  </Button>
                </div>
                <p className="text-[11px] text-[var(--axon-muted)]">
                  If your repository is <strong>private</strong>, copy this public key into your repository's <strong>Settings → Deploy Keys</strong> before connecting:
                </p>
                <pre className="p-2.5 rounded bg-[var(--axon-input-bg)] border border-[var(--axon-border)] font-mono text-[10px] text-slate-300 break-all select-all whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {gitData?.deployKey || "Generating deploy key…"}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Nginx VHost */}
      {activeTab === "vhost" && (
        <Card title="Nginx Virtual Host Configuration">
          <div className="space-y-3">
            <p className="text-xs text-[var(--axon-muted)]">
              Direct edits are validated with <code className="font-mono">nginx -t</code> and backed up to <code className="font-mono">/etc/nginx/panel-backups/</code> automatically.
            </p>
            <textarea
              value={vhostContent}
              onChange={(e) => setVhostContent(e.target.value)}
              className="field w-full h-96 font-mono text-xs leading-relaxed"
            />
            <div className="flex justify-end">
              <Button variant="primary" loading={savingVhost} onClick={saveVhost}>
                Validate & Save Config
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Git Disconnect Confirmation Modal */}
      <ConfirmDialog
        open={showDisconnectModal}
        title="Disconnect Git Repository"
        message={
          <>
            Are you sure you want to disconnect Git from <span className="mono text-amber-300">{site?.name}</span>?
            This will detach the remote repository origin. Your existing website files will not be deleted.
          </>
        }
        confirmLabel="Disconnect Git"
        busy={gitBusy}
        onCancel={() => setShowDisconnectModal(false)}
        onConfirm={() => handleDisconnectGit(false)}
      />

      {/* Switch Git Branch Modal */}
      <Modal
        open={showSwitchBranchModal}
        title={`Switch Git Branch · ${site?.name}`}
        onClose={() => setShowSwitchBranchModal(false)}
        width="max-w-md"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSwitchBranch();
          }}
          className="space-y-4"
        >
          <Field label="Target Branch" hint="Branch name to fetch and checkout (e.g. main, master, staging, prod)">
            <input
              className="field mono text-xs w-full"
              placeholder="main"
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowSwitchBranchModal(false)} disabled={gitBusy}>
              Cancel
            </Button>
            <Button variant="primary" loading={gitBusy} type="submit" disabled={!targetBranch.trim()}>
              Switch Branch
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
