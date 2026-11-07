import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
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
  useToast,
} from "../components/ui";

type DomainRecord = {
  id: string;
  website_id: string;
  website_name: string;
  domain: string;
  is_primary: number;
  domain_type: "primary" | "subdomain" | "alias";
  routing_type: "direct" | "redirect";
  target_url: string | null;
  ssl_active: number;
  created_at: string;
};

type SiteSummary = {
  name: string;
  primary_domain?: string;
  serverNames: string[];
};

export default function Domains() {
  const [domains, setDomains] = useState<DomainRecord[]>([]);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterTab, setFilterTab] = useState("all");
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDomain, setEditingDomain] = useState<DomainRecord | null>(null);
  const [deletingDomain, setDeletingDomain] = useState<DomainRecord | null>(null);

  // Add Domain Form
  const [targetSite, setTargetSite] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [newDomainType, setNewDomainType] = useState<"subdomain" | "alias">("subdomain");
  const [newRoutingType, setNewRoutingType] = useState<"direct" | "redirect">("direct");
  const [newTargetUrl, setNewTargetUrl] = useState("");
  const [newRedirectCode, setNewRedirectCode] = useState(301);
  const [newIssueSsl, setNewIssueSsl] = useState(false);

  // Edit Domain Form
  const [editDomainType, setEditDomainType] = useState<"subdomain" | "alias">("subdomain");
  const [editRoutingType, setEditRoutingType] = useState<"direct" | "redirect">("direct");
  const [editTargetUrl, setEditTargetUrl] = useState("");
  const [editRedirectCode, setEditRedirectCode] = useState(301);

  const toast = useToast();

  const loadData = async () => {
    try {
      setError(null);
      const [domRes, sitesRes] = await Promise.all([
        api.get<{ domains: DomainRecord[] }>("/domains"),
        api.get<{ sites: SiteSummary[] }>("/sites").catch(() => ({ sites: [] })),
      ]);
      setDomains(domRes.domains || []);
      setSites(sitesRes.sites || []);
      if (sitesRes.sites?.length > 0 && !targetSite) {
        setTargetSite(sitesRes.sites[0].name);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleAddDomain = async () => {
    if (!targetSite || !newDomain.trim()) return;
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(targetSite)}/domains`, {
        domain: newDomain.trim(),
        domainType: newDomainType,
        routingType: newRoutingType,
        targetUrl: newTargetUrl.trim() || undefined,
        redirectCode: newRedirectCode,
        issueSsl: newIssueSsl,
      });
      toast("ok", `Domain ${newDomain.trim()} created on ${targetSite}`);
      setShowAddModal(false);
      setNewDomain("");
      setNewTargetUrl("");
      setNewIssueSsl(false);
      await loadData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const openEditDomain = (dom: DomainRecord) => {
    setEditingDomain(dom);
    setEditDomainType(dom.domain_type === "subdomain" ? "subdomain" : "alias");
    setEditRoutingType(dom.routing_type === "redirect" ? "redirect" : "direct");
    setEditTargetUrl(dom.target_url || `https://${dom.website_name}$request_uri`);
    setEditRedirectCode(301);
  };

  const handleUpdateDomain = async () => {
    if (!editingDomain) return;
    setBusyAction(true);
    try {
      await api.put(`/sites/${encodeURIComponent(editingDomain.website_name)}/domains/${encodeURIComponent(editingDomain.domain)}`, {
        domainType: editDomainType,
        routingType: editRoutingType,
        targetUrl: editTargetUrl.trim() || undefined,
        redirectCode: editRedirectCode,
      });
      toast("ok", `Domain ${editingDomain.domain} updated successfully`);
      setEditingDomain(null);
      await loadData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handlePromotePrimary = async (dom: DomainRecord) => {
    setBusyAction(true);
    try {
      await api.put(`/sites/${encodeURIComponent(dom.website_name)}/domains/${encodeURIComponent(dom.domain)}`, {
        isPrimary: true,
      });
      toast("ok", `${dom.domain} is now the primary domain for ${dom.website_name}`);
      setEditingDomain(null);
      await loadData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleIssueSsl = async (dom: DomainRecord) => {
    setBusyAction(true);
    try {
      await api.post(`/sites/${encodeURIComponent(dom.website_name)}/domains/${encodeURIComponent(dom.domain)}/ssl`);
      toast("ok", `SSL certificate issued for ${dom.domain}`);
      await loadData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  const handleDeleteDomain = async () => {
    if (!deletingDomain) return;
    setBusyAction(true);
    try {
      await api.delete(`/sites/${encodeURIComponent(deletingDomain.website_name)}/domains/${encodeURIComponent(deletingDomain.domain)}`);
      toast("ok", `Domain ${deletingDomain.domain} deleted`);
      setDeletingDomain(null);
      await loadData();
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyAction(false);
    }
  };

  // Metrics
  const totalCount = domains.length;
  const primaryCount = domains.filter((d) => d.is_primary === 1).length;
  const subCount = domains.filter((d) => d.domain_type === "subdomain").length;
  const aliasCount = domains.filter((d) => d.domain_type === "alias").length;
  const sslCount = domains.filter((d) => d.ssl_active === 1).length;

  // Filtered List
  const filtered = domains.filter((d) => {
    if (filterTab === "primary" && d.is_primary !== 1) return false;
    if (filterTab === "subdomain" && d.domain_type !== "subdomain") return false;
    if (filterTab === "alias" && d.domain_type !== "alias") return false;
    if (filterTab === "redirect" && d.routing_type !== "redirect") return false;

    if (search.trim()) {
      const q = search.toLowerCase();
      return d.domain.toLowerCase().includes(q) || d.website_name.toLowerCase().includes(q);
    }
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-sm text-[var(--axon-muted)]">
        <Spinner /> Loading domain registry…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)] flex items-center gap-2">
            <span className="text-2xl">🌐</span> Domains & Subdomains
          </h1>
          <p className="mt-1 text-xs text-[var(--axon-muted)]">
            Configure primary domains, subdomains, alias pointer domains, and HTTP redirect rules for your websites.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadData}>Refresh</Button>
          <Button
            variant="primary"
            onClick={() => {
              setNewDomain("");
              setNewDomainType("subdomain");
              setNewRoutingType("direct");
              setNewTargetUrl("");
              setNewRedirectCode(301);
              setNewIssueSsl(false);
              setShowAddModal(true);
            }}
          >
            + Add Domain / Subdomain
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Metric Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Total Domains</p>
          <p className="mt-1 text-2xl font-bold text-[var(--axon-text)]">{totalCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Across all websites</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Primary Hosts</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{primaryCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Main website domains</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Subdomains</p>
          <p className="mt-1 text-2xl font-bold text-indigo-400">{subCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Branch & service hosts</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Aliases & Pointers</p>
          <p className="mt-1 text-2xl font-bold text-teal-400">{aliasCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Domain aliases</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">SSL Protected</p>
          <p className="mt-1 text-2xl font-bold text-[var(--axon-primary)]">
            {sslCount} / {totalCount}
          </p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Active certificates</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <Tabs
          active={filterTab}
          onChange={setFilterTab}
          tabs={[
            { id: "all", label: "All Domains", badge: totalCount },
            { id: "primary", label: "Primary", badge: primaryCount },
            { id: "subdomain", label: "Subdomains", badge: subCount },
            { id: "alias", label: "Aliases", badge: aliasCount },
            { id: "redirect", label: "Redirects", badge: domains.filter((d) => d.routing_type === "redirect").length },
          ]}
        />
        <div className="w-full sm:w-64">
          <input
            className="field text-xs w-full"
            placeholder="Search domain or website…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Main Domains Table */}
      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[var(--axon-muted)]">
                <th className="p-3 font-semibold">Domain</th>
                <th className="p-3 font-semibold">Type</th>
                <th className="p-3 font-semibold">Target Website</th>
                <th className="p-3 font-semibold">Routing Mode</th>
                <th className="p-3 font-semibold">SSL Status</th>
                <th className="p-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {filtered.map((dom) => (
                <tr key={dom.id} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🌐</span>
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
                        <p className="text-[10px] text-[var(--axon-muted)] mt-0.5">Added {dom.created_at?.slice(0, 10)}</p>
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
                    <div className="flex items-center gap-1.5 font-mono text-[var(--axon-text)]">
                      <span>📁</span>
                      <span>{dom.website_name}</span>
                    </div>
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
                          onClick={() => handleIssueSsl(dom)}
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
          {filtered.length === 0 && <EmptyState message="No domains match the current filter or search criteria." />}
        </div>
      </Card>

      {/* Add Domain Modal */}
      <Modal
        open={showAddModal}
        title="Add Domain / Subdomain"
        onClose={() => setShowAddModal(false)}
        width="max-w-md"
      >
        <div className="space-y-4">
          <Field label="Target Website">
            <select
              className="field text-xs w-full"
              value={targetSite}
              onChange={(e) => setTargetSite(e.target.value)}
            >
              {sites.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} ({s.serverNames[0] || s.name})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Domain / Subdomain" hint="e.g. blog.yourdomain.com or brand.org">
            <input
              className="field mono text-xs w-full"
              placeholder={targetSite ? `sub.${targetSite}` : "sub.domain.com"}
              value={newDomain}
              onChange={(e) => {
                const val = e.target.value;
                setNewDomain(val);
                if (targetSite && val.endsWith(`.${targetSite}`)) {
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
                <p className="text-[10px] mt-0.5">e.g. api.{targetSite || "site.com"}</p>
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
                <p className="text-[10px] mt-0.5">e.g. brand.net</p>
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
                <p className="text-[10px] mt-0.5">Serves site content</p>
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
                  placeholder={`https://${targetSite}$request_uri`}
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
            <Button variant="outline" onClick={() => setShowAddModal(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={busyAction}
              disabled={!targetSite || !newDomain.trim()}
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
                  Attached to website: <span className="text-[var(--axon-text)] font-semibold">{editingDomain.website_name}</span>
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
        message={`Are you sure you want to remove "${deletingDomain?.domain}" from website "${deletingDomain?.website_name}"? Traffic routing to this domain will stop immediately.`}
        confirmLabel="Remove Domain"
        busy={busyAction}
        onCancel={() => setDeletingDomain(null)}
        onConfirm={handleDeleteDomain}
      />
    </div>
  );
}
