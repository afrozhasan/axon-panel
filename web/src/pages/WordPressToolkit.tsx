import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Card, EmptyState, Spinner, Tabs, useToast } from "../components/ui";
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
  kind: string;
  enabled: boolean;
};

type StackInfo = {
  type: string;
  docroot: string;
};

export default function WordPressToolkit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [wpSites, setWpSites] = useState<string[]>([]);
  const [selectedSite, setSelectedSite] = useState<string>(searchParams.get("site") || "");
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "security");
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadWpSites = async () => {
    try {
      const res = await api.get<{ sites: Site[] }>("/sites");
      const list = res.sites || [];

      // Check stack for each site
      const wpFound: string[] = [];
      await Promise.all(
        list.map(async (s) => {
          try {
            const stack = await api.get<StackInfo>(`/sites/${encodeURIComponent(s.name)}/stack`);
            if (stack.type === "wordpress") {
              wpFound.push(s.name);
            }
          } catch {
            // best effort
          }
        }),
      );

      setWpSites(wpFound);
      if (wpFound.length > 0 && !selectedSite) {
        setSelectedSite(wpFound[0]);
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWpSites();
  }, []);

  const handleSelectSite = (site: string) => {
    setSelectedSite(site);
    setSearchParams({ site, tab: activeTab });
  };

  const handleTabChange = (t: string) => {
    setActiveTab(t);
    setSearchParams({ site: selectedSite, tab: t });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "WordPress Toolkit Pro" }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[var(--axon-text)]">WordPress Toolkit Pro</h1>
            <span className="rounded bg-gradient-to-r from-blue-500 to-indigo-500 px-2 py-0.5 text-[10px] font-black text-white uppercase tracking-wider">
              Server-Grade
            </span>
          </div>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Enterprise security hardening, database hygiene, 6-layer caching, and WP-CLI automation.
          </p>
        </div>

        {/* Site Selector Dropdown */}
        {wpSites.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--axon-muted)]">Active WordPress Site:</span>
            <select
              value={selectedSite}
              onChange={(e) => handleSelectSite(e.target.value)}
              className="field text-xs font-semibold py-1.5"
            >
              {wpSites.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-[var(--axon-muted)]">
          <Spinner /> Detecting WordPress installations…
        </div>
      ) : wpSites.length === 0 ? (
        <Card>
          <EmptyState
            title="No WordPress websites detected"
            description="You do not have any active WordPress installations on this server yet."
          >
            <div className="mt-4 flex gap-3">
              <Link
                to="/apps"
                className="rounded-lg bg-[var(--axon-primary)] px-4 py-2 text-xs font-semibold text-[var(--axon-primary-fg)] hover:bg-[var(--axon-primary-hover)] transition"
              >
                Deploy WooCommerce / WordPress →
              </Link>
            </div>
          </EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Active Site Header Pill */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded bg-blue-500/15 text-blue-400 font-bold text-xs border border-blue-500/30">
                WP
              </div>
              <div>
                <span className="font-semibold text-sm text-[var(--axon-text)]">{selectedSite}</span>
                <span className="block text-[10px] font-mono text-[var(--axon-muted)]">
                  WordPress Toolkit Active Context
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to={`/sites/${encodeURIComponent(selectedSite)}`}
                className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1 text-xs text-[var(--axon-muted)] hover:text-[var(--axon-text)] transition"
              >
                Website Workspace →
              </Link>
              <a
                href={`https://${selectedSite}/wp-admin`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 px-2.5 py-1 text-xs font-semibold hover:bg-blue-600/30 transition"
              >
                WP-Admin ↗
              </a>
            </div>
          </div>

          <Tabs
            active={activeTab}
            onChange={handleTabChange}
            tabs={[
              { id: "security", label: "Security Hardening", badge: "Audit" },
              { id: "optimization", label: "Performance Optimization", badge: "Pro" },
              { id: "cache", label: "Cache Manager", badge: "FastCGI/Redis" },
              { id: "users", label: "Users", badge: "WP-CLI" },
              { id: "plugins-themes", label: "Plugins & Themes" },
              { id: "database", label: "Database Tools" },
              { id: "backup", label: "Snapshot Backups" },
              { id: "logs", label: "Error Logs" },
            ]}
          />

          <div className="pt-2">
            {activeTab === "security" && <WpSecurityTab siteName={selectedSite} />}
            {activeTab === "optimization" && <WpOptimizationTab siteName={selectedSite} />}
            {activeTab === "cache" && <WpCacheTab siteName={selectedSite} />}
            {activeTab === "users" && <WpUsersTab siteName={selectedSite} />}
            {activeTab === "plugins-themes" && <WpPluginsThemesTab siteName={selectedSite} />}
            {activeTab === "database" && <WpDatabaseTab siteName={selectedSite} />}
            {activeTab === "backup" && <WpBackupTab siteName={selectedSite} />}
            {activeTab === "logs" && <WpLogsTab siteName={selectedSite} />}
          </div>
        </div>
      )}
    </div>
  );
}
