import { useEffect, useRef, useState } from "react";
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

type AstroProject = {
  id: string;
  name: string;
  template_type: string;
  use_lumos: number;
  cms_type: "none" | "wordpress" | "directus" | "decap";
  output_mode: "static" | "ssr";
  frontend_domain: string;
  backend_domain: string | null;
  docroot: string;
  backend_docroot: string | null;
  node_version: string;
  package_manager: string;
  build_command: string;
  git_repo: string | null;
  git_branch: string;
  assigned_port: number | null;
  backend_port: number | null;
  status: "active" | "building" | "error" | "suspended";
  created_at: string;
  frontend_ssl?: number;
  backend_ssl?: number;
};

type DeploymentRecord = {
  id: string;
  project_id: string;
  status: "pending" | "building" | "success" | "failed" | "rolled_back";
  output_mode: string;
  logs: string;
  dist_backup_path: string | null;
  duration_ms: number;
  deployed_by: string;
  created_at: string;
};

type TaskInfo = {
  id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress_percent: number;
  logs: string;
  error_message: string | null;
};

type PreflightCheck = {
  id: string;
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
  blocker: boolean;
};

export default function AstroHeadless() {
  const [projects, setProjects] = useState<AstroProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Wizard State
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [busyWizard, setBusyWizard] = useState(false);
  const [preflightData, setPreflightData] = useState<{ ok: boolean; checks: PreflightCheck[]; freeRamMb: number } | null>(null);

  // Wizard Form Fields
  const [templateType, setTemplateType] = useState("starter");
  const [useLumos, setUseLumos] = useState(false);
  const [cmsType, setCmsType] = useState<"none" | "wordpress" | "directus" | "decap">("none");
  const [frontendDomain, setFrontendDomain] = useState("");
  const [backendDomain, setBackendDomain] = useState("");
  const [nodeVersion, setNodeVersion] = useState("20");
  const [packageManager, setPackageManager] = useState("npm");
  const [outputMode, setOutputMode] = useState<"static" | "ssr">("static");
  const [buildCommand, setBuildCommand] = useState("npm run build");
  const [dbName, setDbName] = useState("");
  const [dbUser, setDbUser] = useState("");
  const [dbPass, setDbPass] = useState("");
  const [gitRepo, setGitRepo] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [wpInstallGraphql, setWpInstallGraphql] = useState(true);
  const [adminUser, setAdminUser] = useState("admin");
  const [adminEmail, setAdminEmail] = useState("admin@example.com");
  const [adminPass, setAdminPass] = useState("");
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>([
    { key: "PUBLIC_APP_ENV", value: "production" },
  ]);
  const [issueSsl, setIssueSsl] = useState(false);

  // Provisioning Task Watcher
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskState, setTaskState] = useState<TaskInfo | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  // Manage / Details Modal
  const [selectedProject, setSelectedProject] = useState<AstroProject | null>(null);
  const [projectDeployments, setProjectDeployments] = useState<DeploymentRecord[]>([]);
  const [envContent, setEnvContent] = useState("");
  const [detailTab, setDetailTab] = useState("overview");
  const [savingEnv, setSavingEnv] = useState(false);
  const [deletingProject, setDeletingProject] = useState<AstroProject | null>(null);

  const toast = useToast();

  const loadProjects = async () => {
    try {
      setError(null);
      const res = await api.get<{ projects: AstroProject[] }>("/astro/projects");
      setProjects(res.projects || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  // Poll Task Progress in Step 13
  useEffect(() => {
    if (!activeTaskId) return;

    const poll = async () => {
      try {
        const res = await api.get<{ task: TaskInfo }>(`/tasks/${activeTaskId}`);
        setTaskState(res.task);
        if (res.task.status === "completed") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          toast("ok", "Astro project deployed and verified!");
          loadProjects();
        } else if (res.task.status === "failed") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          toast("error", `Provisioning failed: ${res.task.error_message || "Unknown error"}`);
        }
      } catch {}
    };

    poll();
    pollTimerRef.current = window.setInterval(poll, 1500);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeTaskId]);

  const runPreflight = async () => {
    setBusyWizard(true);
    try {
      const res = await api.post<any>("/astro/preflight", {
        cmsType,
        outputMode,
        frontendDomain: frontendDomain.trim(),
        backendDomain: cmsType === "wordpress" || cmsType === "directus" ? backendDomain.trim() : null,
      });
      setPreflightData(res);
      setWizardStep(11);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyWizard(false);
    }
  };

  const handleStartProvision = async () => {
    setBusyWizard(true);
    try {
      const envObj: Record<string, string> = {};
      envPairs.forEach((p) => {
        if (p.key.trim()) envObj[p.key.trim()] = p.value;
      });

      const res = await api.post<{ ok: boolean; task: { id: string } }>("/astro/projects", {
        name: frontendDomain.trim(),
        templateType,
        useLumos,
        cmsType,
        outputMode,
        frontendDomain: frontendDomain.trim(),
        backendDomain: cmsType === "wordpress" || cmsType === "directus" ? backendDomain.trim() : null,
        nodeVersion,
        packageManager,
        buildCommand,
        gitRepo: gitRepo.trim() || undefined,
        gitBranch: gitBranch.trim() || "main",
        envVars: envObj,
        issueSsl,
        wpInstallGraphql,
        dbName: dbName.trim() || undefined,
        dbUser: dbUser.trim() || undefined,
        dbPass: dbPass.trim() || undefined,
        adminUser: adminUser.trim() || "admin",
        adminEmail: adminEmail.trim() || "admin@example.com",
        adminPass: adminPass.trim() || undefined,
      });

      setActiveTaskId(res.task.id);
      setWizardStep(13);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setBusyWizard(false);
    }
  };

  const openProjectModal = async (project: AstroProject) => {
    setSelectedProject(project);
    setDetailTab("overview");
    try {
      const res = await api.get<{ deployments: DeploymentRecord[]; envContent: string }>(
        `/astro/projects/${project.id}`,
      );
      setProjectDeployments(res.deployments || []);
      setEnvContent(res.envContent || "");
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleRebuild = async (projectId: string) => {
    try {
      const res = await api.post<{ ok: boolean; task: { id: string } }>(`/astro/projects/${projectId}/rebuild`);
      toast("ok", `Rebuild started (Task #${res.task.id.slice(0, 8)})`);
      loadProjects();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleRollback = async (projectId: string, deploymentId: string) => {
    try {
      await api.post(`/astro/projects/${projectId}/rollback`, { deploymentId });
      toast("ok", "Rolled back to selected deployment snapshot.");
      if (selectedProject) openProjectModal(selectedProject);
      loadProjects();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  const handleSaveEnv = async () => {
    if (!selectedProject) return;
    setSavingEnv(true);
    try {
      await api.put(`/astro/projects/${selectedProject.id}/env`, { content: envContent });
      toast("ok", "Environment variables (.env) saved. Trigger a rebuild to apply changes.");
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSavingEnv(false);
    }
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      await api.delete(`/astro/projects/${deletingProject.id}`);
      toast("ok", `Astro project ${deletingProject.name} deleted.`);
      setDeletingProject(null);
      if (selectedProject?.id === deletingProject.id) setSelectedProject(null);
      loadProjects();
    } catch (err) {
      toast("error", errorMessage(err));
    }
  };

  // Metrics
  const totalProjects = projects.length;
  const staticCount = projects.filter((p) => p.output_mode === "static").length;
  const ssrCount = projects.filter((p) => p.output_mode === "ssr").length;
  const cmsCount = projects.filter((p) => p.cms_type !== "none").length;

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-12 justify-center text-sm text-[var(--axon-muted)]">
        <Spinner /> Loading Astro & Headless CMS hub…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)] flex items-center gap-2">
            <span className="text-2xl">🚀</span> Astro & Headless CMS
          </h1>
          <p className="mt-1 text-xs text-[var(--axon-muted)]">
            Deploy decoupled Astro frontends with WordPress, Directus, Decap CMS, or Lumos design framework.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={loadProjects}>Refresh</Button>
          <Button
            variant="primary"
            onClick={() => {
              setWizardStep(1);
              setPreflightData(null);
              setActiveTaskId(null);
              setTaskState(null);
              setFrontendDomain("");
              setBackendDomain("");
              setTemplateType("starter");
              setUseLumos(false);
              setCmsType("none");
              setOutputMode("static");
              setShowWizard(true);
            }}
          >
            + New Astro Project
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Metric Cards */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Active Projects</p>
          <p className="mt-1 text-2xl font-bold text-[var(--axon-text)]">{totalProjects}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Astro applications</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Static (Nginx)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{staticCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Zero Node.js processes</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">SSR Daemons</p>
          <p className="mt-1 text-2xl font-bold text-[var(--axon-primary)]">{ssrCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Supervised by systemd</p>
        </div>
        <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Headless Backends</p>
          <p className="mt-1 text-2xl font-bold text-indigo-400">{cmsCount}</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Decoupled content engines</p>
        </div>
      </div>

      {/* Projects Grid */}
      {projects.length === 0 ? (
        <Card>
          <EmptyState
            message="No Astro projects configured yet. Click '+ New Astro Project' to launch the 13-step automated provisioning wizard."
          />
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex flex-col justify-between hover:border-[var(--axon-primary)]/50 transition-all"
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-[var(--axon-text)] truncate">{proj.name}</h3>
                    <a
                      href={`https://${proj.frontend_domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono text-xs text-[var(--axon-primary)] hover:underline truncate block"
                    >
                      {proj.frontend_domain} ↗
                    </a>
                  </div>
                  <Badge tone={proj.output_mode === "static" ? "ok" : "info"}>
                    {proj.output_mode.toUpperCase()}
                  </Badge>
                </div>

                <div className="flex flex-wrap gap-1.5 my-3">
                  <span className="rounded bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-400 capitalize">
                    {proj.cms_type === "none" ? "Standalone" : proj.cms_type}
                  </span>
                  {proj.use_lumos === 1 && (
                    <span className="rounded bg-teal-500/15 border border-teal-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-teal-400">
                      Lumos Design
                    </span>
                  )}
                  {proj.assigned_port && (
                    <span className="rounded bg-slate-500/15 border border-slate-500/30 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                      Port :{proj.assigned_port}
                    </span>
                  )}
                </div>

                {proj.backend_domain && (
                  <div className="rounded bg-[var(--axon-sidebar)] border border-[var(--axon-border)] p-2 my-2 text-[11px]">
                    <span className="text-[var(--axon-muted)]">Backend: </span>
                    <a
                      href={`https://${proj.backend_domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono font-semibold text-[var(--axon-text)] hover:text-[var(--axon-primary)]"
                    >
                      {proj.backend_domain} ↗
                    </a>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-[var(--axon-border)] pt-3 mt-2">
                <Button variant="ghost" onClick={() => handleRebuild(proj.id)} className="text-xs">
                  ⚡ Rebuild
                </Button>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" onClick={() => openProjectModal(proj)} className="text-xs">
                    Manage
                  </Button>
                  <Button variant="danger" onClick={() => setDeletingProject(proj)} className="text-xs">
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* 13-STEP ASTRO & HEADLESS CMS INSTALLATION WIZARD MODAL */}
      {/* --------------------------------------------------------------------- */}
      <Modal
        open={showWizard}
        title={`Astro & Headless CMS Wizard (Step ${wizardStep} of 13)`}
        onClose={() => setShowWizard(false)}
        width="max-w-2xl"
      >
        <div className="space-y-4">
          {/* Progress Indicator */}
          <div className="w-full bg-[var(--axon-sidebar)] h-1.5 rounded-full overflow-hidden border border-[var(--axon-border)]">
            <div
              className="bg-[var(--axon-primary)] h-full transition-all duration-300"
              style={{ width: `${(wizardStep / 13) * 100}%` }}
            />
          </div>

          {/* STEP 1: Choose Astro Template */}
          {wizardStep === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 1: Choose Astro Template</h3>
              <p className="text-xs text-[var(--axon-muted)]">Select starter foundation or connect custom code.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { id: "starter", title: "Clean Astro Starter", desc: "Minimal, zero-overhead foundation" },
                  { id: "blog", title: "Content Collections Blog", desc: "Markdown & MDX schema publishing" },
                  { id: "portfolio", title: "Agency & Portfolio", desc: "Case studies & modern layout grids" },
                  { id: "ecommerce", title: "E-Commerce Storefront", desc: "Headless catalog with checkout flow" },
                  { id: "custom_git", title: "Existing GitHub Repo", desc: "Clone and deploy from your repository" },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTemplateType(t.id)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      templateType === t.id
                        ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                        : "border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-text)] hover:border-slate-500"
                    }`}
                  >
                    <p className="font-semibold text-xs">{t.title}</p>
                    <p className="text-[11px] text-[var(--axon-muted)] mt-1">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Select Lumos Framework */}
          {wizardStep === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 2: Lumos Framework for Astro</h3>
              <p className="text-xs text-[var(--axon-muted)]">
                Lumos for Astro (lumosframework/lumos-for-astro) is a verified component and styling framework built specifically for Astro, focused on scalability, design-system tokens, and accessibility.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setUseLumos(true)}
                  className={`p-4 rounded-lg border text-left ${
                    useLumos
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-text)]"
                  }`}
                >
                  <p className="font-bold text-xs text-[var(--axon-primary)]">✨ Include Lumos Framework</p>
                  <p className="text-[11px] text-[var(--axon-muted)] mt-1">
                    Adds centralized design tokens, predictable CSS cascade, and accessible layout primitives.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setUseLumos(false)}
                  className={`p-4 rounded-lg border text-left ${
                    !useLumos
                      ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                      : "border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-text)]"
                  }`}
                >
                  <p className="font-bold text-xs">Standard Astro Styling</p>
                  <p className="text-[11px] text-[var(--axon-muted)] mt-1">Use default Astro component styling without Lumos tokens.</p>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Select Headless CMS */}
          {wizardStep === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 3: Select Headless CMS</h3>
              <p className="text-xs text-[var(--axon-muted)]">
                Choose the decoupled content management system to orchestrate with Astro.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  { id: "none", title: "No CMS (Standalone)", desc: "Astro only, without external CMS backend" },
                  { id: "wordpress", title: "WordPress Headless", desc: "PHP-FPM, MariaDB, REST API & WPGraphQL" },
                  { id: "directus", title: "Directus API Platform", desc: "Independent Node.js API service (requires >=512MB RAM)" },
                  { id: "decap", title: "Decap CMS (Git-based)", desc: "In-repo /admin/ portal committing to Git" },
                ].map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCmsType(c.id as any)}
                    className={`p-3 rounded-lg border text-left ${
                      cmsType === c.id
                        ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-white"
                        : "border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-text)]"
                    }`}
                  >
                    <p className="font-semibold text-xs">{c.title}</p>
                    <p className="text-[11px] text-[var(--axon-muted)] mt-1">{c.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* STEP 4: Configure Frontend Domain */}
          {wizardStep === 4 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 4: Configure Frontend Domain</h3>
              <p className="text-xs text-[var(--axon-muted)]">The primary public domain for your Astro frontend.</p>
              <Field label="Frontend Domain Name" hint="Must point to this VPS server">
                <input
                  className="field mono text-xs w-full"
                  placeholder="mysite.com"
                  value={frontendDomain}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFrontendDomain(val);
                    if (!backendDomain && val) setBackendDomain(`cms.${val}`);
                  }}
                />
              </Field>
            </div>
          )}

          {/* STEP 5: Configure Backend Domain */}
          {wizardStep === 5 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 5: Configure Backend Domain</h3>
              {cmsType === "wordpress" || cmsType === "directus" ? (
                <>
                  <p className="text-xs text-[var(--axon-muted)]">
                    Dedicated domain or subdomain for your {cmsType.toUpperCase()} administrative backend.
                  </p>
                  <Field label="Backend Domain / Subdomain" hint="e.g. cms.mysite.com or wp.mysite.com">
                    <input
                      className="field mono text-xs w-full"
                      placeholder={`cms.${frontendDomain || "mysite.com"}`}
                      value={backendDomain}
                      onChange={(e) => setBackendDomain(e.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <div className="p-4 rounded-lg bg-[var(--axon-card)] border border-[var(--axon-border)] text-xs text-[var(--axon-muted)]">
                  Decap CMS or Standalone mode selected. Content is served in-repo; no separate backend domain is required.
                </div>
              )}
            </div>
          )}

          {/* STEP 6: Select Runtime Versions & Output Mode */}
          {wizardStep === 6 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 6: Select Runtime Versions & Output Mode</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Node.js Version">
                  <select className="field text-xs w-full" value={nodeVersion} onChange={(e) => setNodeVersion(e.target.value)}>
                    <option value="22">Node.js 22 (Current)</option>
                    <option value="20">Node.js 20 (LTS Recommended)</option>
                    <option value="18">Node.js 18 (Maintenance)</option>
                  </select>
                </Field>
                <Field label="Package Manager">
                  <select className="field text-xs w-full" value={packageManager} onChange={(e) => setPackageManager(e.target.value)}>
                    <option value="npm">npm</option>
                    <option value="pnpm">pnpm</option>
                    <option value="yarn">yarn</option>
                  </select>
                </Field>
                <Field label="Delivery Mode">
                  <select className="field text-xs w-full" value={outputMode} onChange={(e) => setOutputMode(e.target.value as any)}>
                    <option value="static">Static (Nginx direct, 0 RAM)</option>
                    <option value="ssr">SSR (Node.js systemd)</option>
                  </select>
                </Field>
              </div>
              <Field label="Build Command">
                <input className="field mono text-xs w-full" value={buildCommand} onChange={(e) => setBuildCommand(e.target.value)} />
              </Field>
            </div>
          )}

          {/* STEP 7: Configure Database */}
          {wizardStep === 7 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 7: Configure Database</h3>
              {cmsType === "wordpress" ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--axon-muted)]">MariaDB database credentials for WordPress core.</p>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label="Database Name">
                      <input className="field mono text-xs w-full" placeholder="auto-generated" value={dbName} onChange={(e) => setDbName(e.target.value)} />
                    </Field>
                    <Field label="Database User">
                      <input className="field mono text-xs w-full" placeholder="auto-generated" value={dbUser} onChange={(e) => setDbUser(e.target.value)} />
                    </Field>
                    <Field label="Password">
                      <input className="field mono text-xs w-full" type="password" placeholder="auto-generated" value={dbPass} onChange={(e) => setDbPass(e.target.value)} />
                    </Field>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--axon-text)] pt-1">
                    <input type="checkbox" checked={wpInstallGraphql} onChange={(e) => setWpInstallGraphql(e.target.checked)} className="accent-[var(--axon-primary)]" />
                    <span>Install and activate WPGraphQL plugin for high-performance Astro GraphQL queries</span>
                  </label>
                </div>
              ) : cmsType === "directus" ? (
                <div className="p-4 rounded-lg bg-[var(--axon-card)] border border-[var(--axon-border)] text-xs text-[var(--axon-muted)]">
                  Directus will be provisioned with an isolated SQLite data store for ultra-lightweight VPS performance.
                </div>
              ) : (
                <div className="p-4 rounded-lg bg-[var(--axon-card)] border border-[var(--axon-border)] text-xs text-[var(--axon-muted)]">
                  No database required for this template configuration.
                </div>
              )}
            </div>
          )}

          {/* STEP 8: Connect GitHub or Starter */}
          {wizardStep === 8 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 8: GitHub & Starter Configuration</h3>
              {templateType === "custom_git" ? (
                <div className="space-y-3">
                  <Field label="GitHub Repository URL" hint="HTTPS repository clone URL">
                    <input className="field mono text-xs w-full" placeholder="https://github.com/user/astro-repo.git" value={gitRepo} onChange={(e) => setGitRepo(e.target.value)} />
                  </Field>
                  <Field label="Git Branch">
                    <input className="field mono text-xs w-full" placeholder="main" value={gitBranch} onChange={(e) => setGitBranch(e.target.value)} />
                  </Field>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--axon-muted)]">
                    Axon Panel will generate a fresh clean {templateType} Astro codebase in <code className="mono">/var/www/{frontendDomain || "domain"}</code>.
                  </p>
                  <Field label="Admin Email (CMS and Notifications)">
                    <input className="field text-xs w-full" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
                  </Field>
                </div>
              )}
            </div>
          )}

          {/* STEP 9: Configure Environment Variables */}
          {wizardStep === 9 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 9: Configure Environment Variables</h3>
                <Button
                  variant="ghost"
                  onClick={() => setEnvPairs([...envPairs, { key: "", value: "" }])}
                  className="text-xs"
                >
                  + Add Variable
                </Button>
              </div>
              <p className="text-xs text-[var(--axon-muted)]">
                Variables are injected into Astro frontend <code className="mono">.env</code>. CMS API endpoints are wired automatically.
              </p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {envPairs.map((pair, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      className="field mono text-xs flex-1"
                      placeholder="KEY (e.g. PUBLIC_API_URL)"
                      value={pair.key}
                      onChange={(e) => {
                        const next = [...envPairs];
                        next[idx].key = e.target.value;
                        setEnvPairs(next);
                      }}
                    />
                    <input
                      className="field mono text-xs flex-1"
                      placeholder="VALUE"
                      value={pair.value}
                      onChange={(e) => {
                        const next = [...envPairs];
                        next[idx].value = e.target.value;
                        setEnvPairs(next);
                      }}
                    />
                    <Button
                      variant="ghost"
                      onClick={() => setEnvPairs(envPairs.filter((_, i) => i !== idx))}
                      className="text-rose-400 text-xs px-2"
                    >
                      ✕
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 10: Configure SSL */}
          {wizardStep === 10 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 10: Configure SSL Certificates</h3>
              <p className="text-xs text-[var(--axon-muted)]">Automatic Let's Encrypt certificates for HTTPS.</p>
              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={issueSsl}
                  onChange={(e) => setIssueSsl(e.target.checked)}
                  className="mt-1 accent-[var(--axon-primary)]"
                />
                <div>
                  <p className="text-xs font-semibold text-[var(--axon-text)]">Issue Let's Encrypt SSL Certificates Automatically</p>
                  <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
                    Will request certificates for {frontendDomain || "frontend"}
                    {backendDomain ? ` and ${backendDomain}` : ""} via certbot. Ensure DNS A records already resolve to this server.
                  </p>
                </div>
              </label>
            </div>
          )}

          {/* STEP 11: Review Resource Requirements */}
          {wizardStep === 11 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 11: Review Resource Requirements</h3>
              {preflightData && (
                <div className="space-y-2">
                  {preflightData.checks.map((chk) => (
                    <div
                      key={chk.id}
                      className={`p-2.5 rounded-lg border flex items-center justify-between text-xs ${
                        chk.status === "ok"
                          ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                          : chk.status === "warn"
                            ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
                            : "border-rose-500/30 bg-rose-500/5 text-rose-300"
                      }`}
                    >
                      <div>
                        <p className="font-semibold">{chk.name}</p>
                        <p className="text-[11px] opacity-80">{chk.detail}</p>
                      </div>
                      <Badge tone={chk.status === "ok" ? "ok" : chk.status === "warn" ? "warn" : "bad"}>
                        {chk.status.toUpperCase()}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 12: Confirm Installation */}
          {wizardStep === 12 && (
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-[var(--axon-text)]">STEP 12: Confirm Installation</h3>
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-sidebar)] p-3 text-xs space-y-1.5 font-mono">
                <p><span className="text-[var(--axon-muted)]">Project:</span> {frontendDomain}</p>
                <p><span className="text-[var(--axon-muted)]">Astro Template:</span> {templateType}</p>
                <p><span className="text-[var(--axon-muted)]">Design Framework:</span> {useLumos ? "Lumos Framework" : "Standard"}</p>
                <p><span className="text-[var(--axon-muted)]">Headless CMS:</span> {cmsType.toUpperCase()}</p>
                {backendDomain && <p><span className="text-[var(--axon-muted)]">Backend URL:</span> https://{backendDomain}</p>}
                <p><span className="text-[var(--axon-muted)]">Delivery Mode:</span> {outputMode.toUpperCase()}</p>
                <p><span className="text-[var(--axon-muted)]">Node Version:</span> {nodeVersion} ({packageManager})</p>
                <p><span className="text-[var(--axon-muted)]">SSL:</span> {issueSsl ? "Enabled (Let's Encrypt)" : "Disabled"}</p>
              </div>
            </div>
          )}

          {/* STEP 13: Provisioning & Live Progress */}
          {wizardStep === 13 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-[var(--axon-text)] flex items-center gap-2">
                  STEP 13: Provisioning Astro Architecture
                  {taskState?.status === "running" && <Spinner className="h-4 w-4" />}
                </h3>
                <Badge
                  tone={
                    taskState?.status === "completed"
                      ? "ok"
                      : taskState?.status === "failed"
                        ? "bad"
                        : "info"
                  }
                >
                  {taskState?.status?.toUpperCase() || "PENDING"}
                </Badge>
              </div>

              <div className="w-full bg-[var(--axon-card)] h-2 rounded-full overflow-hidden border border-[var(--axon-border)]">
                <div
                  className="bg-[var(--axon-primary)] h-full transition-all duration-300"
                  style={{ width: `${taskState?.progress_percent || 5}%` }}
                />
              </div>

              <pre className="mono text-xs bg-[var(--axon-input-bg)] text-slate-300 p-3 rounded-lg border border-[var(--axon-border)] h-56 overflow-y-auto whitespace-pre-wrap">
                {taskState?.logs || "Waiting for worker to start provisioning pipeline…"}
              </pre>

              {taskState?.status === "completed" && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs">
                  🎉 Astro architecture verified! You can visit your site at{" "}
                  <a href={`https://${frontendDomain}`} target="_blank" rel="noreferrer" className="underline font-bold">
                    https://{frontendDomain}
                  </a>
                </div>
              )}

              {taskState?.status === "failed" && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  ❌ Provisioning failed: {taskState.error_message}. Safe rollback was executed.
                </div>
              )}
            </div>
          )}

          {/* Wizard Footer Navigation */}
          <div className="flex justify-between items-center pt-3 border-t border-[var(--axon-border)]">
            {wizardStep > 1 && wizardStep < 13 ? (
              <Button variant="outline" onClick={() => setWizardStep(wizardStep - 1)}>
                ← Previous
              </Button>
            ) : <div />}

            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setShowWizard(false)}>
                {wizardStep === 13 ? "Close" : "Cancel"}
              </Button>

              {wizardStep < 10 && (
                <Button
                  variant="primary"
                  disabled={wizardStep === 4 && !frontendDomain.trim()}
                  onClick={() => setWizardStep(wizardStep + 1)}
                >
                  Next →
                </Button>
              )}

              {wizardStep === 10 && (
                <Button variant="primary" loading={busyWizard} onClick={runPreflight}>
                  Run Preflight Checks →
                </Button>
              )}

              {wizardStep === 11 && (
                <Button
                  variant="primary"
                  disabled={preflightData?.ok === false}
                  onClick={() => setWizardStep(12)}
                >
                  Review & Confirm →
                </Button>
              )}

              {wizardStep === 12 && (
                <Button variant="primary" loading={busyWizard} onClick={handleStartProvision}>
                  🚀 Launch Provisioning
                </Button>
              )}
            </div>
          </div>
        </div>
      </Modal>

      {/* --------------------------------------------------------------------- */}
      {/* PROJECT MANAGE & ROLLBACK MODAL */}
      {/* --------------------------------------------------------------------- */}
      <Modal
        open={Boolean(selectedProject)}
        title={selectedProject ? `Project: ${selectedProject.name}` : ""}
        onClose={() => setSelectedProject(null)}
        width="max-w-3xl"
      >
        {selectedProject && (
          <div className="space-y-4">
            <Tabs
              active={detailTab}
              onChange={setDetailTab}
              tabs={[
                { id: "overview", label: "Overview" },
                { id: "deployments", label: "Deployments & Rollback", badge: projectDeployments.length },
                { id: "env", label: "Environment Variables (.env)" },
              ]}
            />

            {/* Tab: Overview */}
            {detailTab === "overview" && (
              <div className="space-y-3 text-xs">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg bg-[var(--axon-card)] border border-[var(--axon-border)] p-3">
                    <p className="text-[var(--axon-muted)] font-bold uppercase text-[10px]">Frontend Ingress</p>
                    <a
                      href={`https://${selectedProject.frontend_domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono font-semibold text-[var(--axon-primary)] text-sm hover:underline block mt-1"
                    >
                      https://{selectedProject.frontend_domain} ↗
                    </a>
                    <p className="text-[var(--axon-muted)] mt-1">Docroot: {selectedProject.docroot}</p>
                  </div>

                  {selectedProject.backend_domain && (
                    <div className="rounded-lg bg-[var(--axon-card)] border border-[var(--axon-border)] p-3">
                      <p className="text-[var(--axon-muted)] font-bold uppercase text-[10px]">Headless CMS Backend</p>
                      <a
                        href={`https://${selectedProject.backend_domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono font-semibold text-indigo-400 text-sm hover:underline block mt-1"
                      >
                        https://{selectedProject.backend_domain} ↗
                      </a>
                      <p className="text-[var(--axon-muted)] mt-1">Platform: {selectedProject.cms_type.toUpperCase()}</p>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button variant="primary" onClick={() => handleRebuild(selectedProject.id)}>
                    ⚡ Trigger Instant Rebuild
                  </Button>
                </div>
              </div>
            )}

            {/* Tab: Deployments & Rollback */}
            {detailTab === "deployments" && (
              <div className="space-y-3">
                <p className="text-xs text-[var(--axon-muted)]">
                  Previous production builds with automated rollback checkpoints.
                </p>
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {projectDeployments.map((dep) => (
                    <div
                      key={dep.id}
                      className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="mono font-bold text-[var(--axon-text)]">#{dep.id.slice(0, 8)}</span>
                          <Badge tone={dep.status === "success" ? "ok" : dep.status === "rolled_back" ? "warn" : "bad"}>
                            {dep.status.toUpperCase()}
                          </Badge>
                          <span className="mono text-[var(--axon-muted)] text-[11px]">{dep.output_mode.toUpperCase()}</span>
                        </div>
                        <p className="text-[11px] text-[var(--axon-muted)] mt-1">{dep.created_at}</p>
                      </div>

                      {dep.dist_backup_path && dep.status === "success" && (
                        <Button
                          variant="outline"
                          onClick={() => handleRollback(selectedProject.id, dep.id)}
                          className="text-xs"
                        >
                          ⏮ Rollback to this build
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tab: Environment Variables */}
            {detailTab === "env" && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--axon-muted)]">Astro frontend <code className="mono">.env</code> configuration</p>
                  <Button variant="primary" loading={savingEnv} onClick={handleSaveEnv} className="text-xs">
                    Save Variables
                  </Button>
                </div>
                <textarea
                  className="field mono text-xs h-64 w-full"
                  value={envContent}
                  onChange={(e) => setEnvContent(e.target.value)}
                  spellCheck={false}
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(deletingProject)}
        title={`Delete Astro Project: ${deletingProject?.name ?? ""}`}
        message={`Are you sure you want to delete "${deletingProject?.name}"? Its Nginx configuration, docroot files, and any associated background services will be removed.`}
        confirmLabel="Delete Project"
        onCancel={() => setDeletingProject(null)}
        onConfirm={handleDeleteProject}
      />
    </div>
  );
}
