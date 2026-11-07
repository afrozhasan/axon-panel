import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Card, EmptyState, Spinner, useToast } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

type Site = {
  name: string;
  kind: string;
  enabled: boolean;
};

type GitInfo = {
  hasGit: boolean;
  branch?: string;
  commit?: string;
  message?: string;
  author?: string;
  date?: string;
  remoteUrl?: string;
};

type SiteGitEntry = {
  siteName: string;
  kind: string;
  enabled: boolean;
  git: GitInfo | null;
};

export default function GitDeployments() {
  const [entries, setEntries] = useState<SiteGitEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [deployingSite, setDeployingSite] = useState<string | null>(null);
  const toast = useToast();

  const loadDeployments = async () => {
    try {
      const sitesRes = await api.get<{ sites: Site[] }>("/sites");
      const list = sitesRes.sites || [];

      const results = await Promise.all(
        list.map(async (site) => {
          try {
            const git = await api.get<GitInfo>(`/sites/${encodeURIComponent(site.name)}/git`);
            return { siteName: site.name, kind: site.kind, enabled: site.enabled, git };
          } catch {
            return { siteName: site.name, kind: site.kind, enabled: site.enabled, git: null };
          }
        }),
      );

      setEntries(results);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDeployments();
  }, []);

  const handleBuild = async (siteName: string) => {
    setDeployingSite(siteName);
    try {
      const res = await api.post<{ ok: boolean; task: { id: string } }>(
        `/sites/${encodeURIComponent(siteName)}/node/build`,
      );
      toast("ok", `Build & deployment enqueued (Task: ${res.task.id})`);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDeployingSite(null);
    }
  };

  const gitSites = entries.filter((e) => e.git?.hasGit);
  const nonGitSites = entries.filter((e) => !e.git?.hasGit);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Git & Deployments" }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)]">Git & Continuous Deployments</h1>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Automated git pulling, commit tracking, build execution, and zero-downtime releases.
          </p>
        </div>
        <Button variant="ghost" onClick={loadDeployments}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-[var(--axon-muted)]">
          <Spinner /> Inspecting Git repositories…
        </div>
      ) : (
        <div className="space-y-6">
          <Card title={`Active Git Connected Websites (${gitSites.length})`}>
            {gitSites.length === 0 ? (
              <EmptyState
                title="No Git repositories linked"
                description="None of your current websites have a Git repository initialized in their document root."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                      <th className="px-4 py-2.5">Website</th>
                      <th className="px-4 py-2.5">Branch</th>
                      <th className="px-4 py-2.5">Latest Commit</th>
                      <th className="px-4 py-2.5">Author</th>
                      <th className="px-4 py-2.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--axon-border)]">
                    {gitSites.map((entry) => (
                      <tr key={entry.siteName} className="hover:bg-[var(--axon-card-hover)] transition">
                        <td className="px-4 py-2.5">
                          <Link
                            to={`/sites/${encodeURIComponent(entry.siteName)}/git`}
                            className="font-semibold text-[var(--axon-text)] hover:text-[var(--axon-primary)] transition"
                          >
                            {entry.siteName}
                          </Link>
                          <span className="block text-[10px] font-mono text-[var(--axon-muted)] truncate max-w-xs">
                            {entry.git?.remoteUrl || "Local repository"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded bg-[var(--axon-primary)]/10 px-2 py-0.5 text-[11px] font-mono font-medium text-[var(--axon-primary)] border border-[var(--axon-primary)]/20">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3 w-3">
                              <path d="M6 3v12m0 0a3 3 0 103 3V6a3 3 0 10-3-3zm12 6a3 3 0 10-3-3v6a3 3 0 103 3" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {entry.git?.branch || "main"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="font-mono text-[11px] text-[var(--axon-muted)] block">
                            {entry.git?.commit ? entry.git.commit.slice(0, 7) : "—"}
                          </span>
                          <span className="text-[11px] text-[var(--axon-text)] truncate block max-w-sm">
                            {entry.git?.message || "No commit message"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--axon-muted)] text-[11px]">
                          {entry.git?.author || "—"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="secondary"
                              disabled={deployingSite === entry.siteName}
                              onClick={() => handleBuild(entry.siteName)}
                            >
                              {deployingSite === entry.siteName ? "Deploying…" : "Build & Deploy"}
                            </Button>
                            <Link
                              to={`/sites/${encodeURIComponent(entry.siteName)}/git`}
                              className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] px-2.5 py-1 text-xs text-[var(--axon-muted)] hover:text-[var(--axon-text)] transition"
                            >
                              Settings
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Websites without Git */}
          {nonGitSites.length > 0 && (
            <Card title={`Websites Without Git Integration (${nonGitSites.length})`}>
              <div className="divide-y divide-[var(--axon-border)] text-xs">
                {nonGitSites.map((s) => (
                  <div key={s.siteName} className="py-2.5 flex items-center justify-between">
                    <div>
                      <span className="font-medium text-[var(--axon-text)]">{s.siteName}</span>
                      <span className="text-[10px] text-[var(--axon-muted)] ml-2">({s.kind})</span>
                    </div>
                    <Link
                      to={`/sites/${encodeURIComponent(s.siteName)}/git`}
                      className="text-xs text-[var(--axon-primary)] hover:underline"
                    >
                      Connect Git →
                    </Link>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
