import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  Tabs,
  useAsyncAction,
  useToast,
} from "../components/ui";

type Check = { id: string; label: string; status: "ok" | "fail" | "warn"; detail: string; remediation: string | null };

type AppEntry = {
  id: string;
  name: string;
  vendor: string;
  tagline: string;
  description: string;
  category: string;
  runtime: string;
  database: string;
  weight: string;
  verified: boolean;
  automated: boolean;
  finishMode: string;
  finishPath: string | null;
  adminPath: string | null;
  notes: string[];
  manualRecipe: string[];
  ready: boolean;
  blockers: number;
  checks: Check[];
};

type Step = { label: string; status: string; detail: string | null };

type Job = {
  id: string;
  appId: string;
  appName: string;
  status: string;
  steps: Step[];
  currentStep: string | null;
  error: string | null;
  result: {
    url: string;
    finishUrl: string;
    adminUrl: string;
    installDir: string;
    finishMode: string;
    credentials: {
      database: string;
      databaseUser: string;
      databasePassword: string;
      adminUser: string;
      adminPassword: string;
    };
  } | null;
};

const WEIGHT_TONE: Record<string, "ok" | "warn" | "bad" | "neutral"> = {
  light: "ok",
  medium: "warn",
  heavy: "bad",
};

function CredentialRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--axon-border)] py-1.5 last:border-0">
      <span className="text-[11px] text-slate-400">{label}</span>
      <button
        className="mono truncate text-xs text-amber-200 hover:text-amber-100"
        title="Click to copy"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "copied" : value}
      </button>
    </div>
  );
}

export default function Apps() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AppEntry | null>(null);
  const [detailChecks, setDetailChecks] = useState<Check[] | null>(null);
  const [job, setJob] = useState<Job | null>(null);

  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const result = await api.get<{ apps: AppEntry[]; categories: string[]; activeJob: Job | null }>("/apps");
      setApps(result.apps);
      setCategories(result.categories);
      if (result.activeJob && ["queued", "running"].includes(result.activeJob.status)) setJob(result.activeJob);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) {
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = window.setInterval(async () => {
      try {
        const result = await api.get<{ job: Job }>(`/apps/jobs/${job.id}`);
        setJob(result.job);
        if (result.job.status === "success") {
          toast("ok", `${result.job.appName} installed`);
          load();
        } else if (result.job.status === "failed") {
          toast("error", `${result.job.appName} installation failed`);
          load();
        }
      } catch {
        /* keep polling */
      }
    }, 1200);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [job?.id, job?.status]);

  const openDetail = async (app: AppEntry) => {
    const normalizedApp: AppEntry = {
      ...app,
      notes: app.notes || [],
      manualRecipe: app.manualRecipe || [],
      checks: app.checks || [],
    };
    setSelected(normalizedApp);
    setDetailChecks(null);
    setError(null);
    try {
      const result = await api.get<{ preflight: { checks: Check[] }; app?: Partial<AppEntry> }>(`/apps/${app.id}`);
      setDetailChecks(result.preflight?.checks || []);
      if (result.app) {
        setSelected((prev) => (prev ? { ...prev, ...result.app, notes: result.app?.notes || prev.notes || [], manualRecipe: result.app?.manualRecipe || prev.manualRecipe || [] } : null));
      }
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const filtered = tab === "all" ? apps : apps.filter((app) => app.category === tab);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading application catalogue…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-2xl">⚡</span> One-Click App Store
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            One-click automated deployments for WordPress, Laravel, Next.js, Node.js, Astro, WooCommerce, and modern frameworks.
          </p>
        </div>
        <Button onClick={load}>Refresh</Button>
      </div>

      <ErrorBanner message={error} />

      <Tabs
        active={tab}
        onChange={setTab}
        tabs={[{ id: "all", label: "All", badge: apps.length }, ...categories.map((c) => ({ id: c, label: c, badge: apps.filter((a) => a.category === c).length }))]}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((app) => (
          <div key={app.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-slate-100">{app.name}</h3>
                <p className="truncate text-[11px] text-slate-500">
                  {app.vendor} · {app.tagline}
                </p>
              </div>
              <Badge tone={WEIGHT_TONE[app.weight] ?? "neutral"}>{app.weight}</Badge>
            </div>

            <p className="mt-2.5 flex-1 text-[11px] leading-relaxed text-slate-400">{app.description}</p>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="neutral">{app.runtime}</Badge>
              <Badge tone="neutral">{app.database}</Badge>
              {app.verified && <Badge tone="ok">tested</Badge>}
              {!app.automated && <Badge tone="warn">guided</Badge>}
            </div>

            <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--axon-border)] pt-3">
              <span className="text-[11px]">
                {app.automated === false ? (
                  <span className="text-amber-300">manual setup</span>
                ) : app.ready ? (
                  <span className="text-emerald-300">ready to install</span>
                ) : (
                  <span className="text-rose-300">
                    {app.blockers} requirement{app.blockers === 1 ? "" : "s"} not met
                  </span>
                )}
              </span>
              <Button variant="primary" onClick={() => openDetail(app)}>
                {app.automated === false ? "View recipe" : "Install"}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <Modal
        open={Boolean(selected)}
        title={selected ? `${selected.name} · ${selected.tagline}` : ""}
        onClose={() => setSelected(null)}
        width="max-w-3xl"
      >
        {selected && (
          <InstallPanel
            app={selected}
            checks={detailChecks}
            busy={busy}
            error={error}
            onInstall={async (options) => {
              const started = await run(async () => {
                const result = await api.post<{ job: Job }>(`/apps/${selected.id}/install`, options);
                setJob(result.job);
                setSelected(null);
              }, `Installing ${selected.name}— this can take a few minutes`);
              return started;
            }}
          />
        )}
      </Modal>

      <Modal
        open={Boolean(job)}
        title={job ? `${job.appName} — installation` : ""}
        onClose={() => {
          if (job && ["queued", "running"].includes(job.status)) return;
          setJob(null);
          load();
        }}
        width="max-w-3xl"
      >
        {job && <JobPanel job={job} />}
      </Modal>
    </div>
  );
}

function JobPanel({ job }: { job: Job }) {
  const running = ["queued", "running"].includes(job.status);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge tone={job.status === "success" ? "ok" : job.status === "failed" ? "bad" : "warn"}>{job.status}</Badge>
        {running && <Spinner className="h-3.5 w-3.5" />}
        {running && <span className="text-[11px] text-slate-400">{job.currentStep}</span>}
      </div>

      {job.error && (
        <pre className="mono max-h-52 overflow-auto whitespace-pre-wrap rounded-md border border-rose-500/30 bg-rose-950/40 p-3 text-[11px] text-rose-200">
          {job.error}
        </pre>
      )}

      <ol className="space-y-1.5">
        {job.steps.map((step, index) => (
          <li key={index} className="flex items-start gap-2.5 text-[11px]">
            <span
              className={`mt-0.5 w-4 shrink-0 text-center ${
                step.status === "done"
                  ? "text-emerald-400"
                  : step.status === "failed"
                    ? "text-rose-400"
                    : step.status === "skipped"
                      ? "text-amber-400"
                      : "text-slate-500"
              }`}
            >
              {step.status === "done" ? "✓" : step.status === "failed" ? "✕" : step.status === "skipped" ? "–" : "•"}
            </span>
            <div className="min-w-0 flex-1">
              <p className={step.status === "running" ? "text-slate-200" : "text-slate-400"}>{step.label}</p>
              {step.detail && <p className="mono mt-0.5 whitespace-pre-wrap break-all text-[10px] text-slate-500">{step.detail}</p>}
            </div>
          </li>
        ))}
      </ol>

      {job.result && (
        <div className="space-y-3 border-t border-[var(--axon-border)] pt-3">
          <p className="text-xs font-medium text-emerald-300">Installation complete</p>

          <div className="grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-md border border-[var(--axon-border)] p-2.5">
              <p className="text-slate-500">Site</p>
              <a className="mono text-indigo-300 hover:text-indigo-200" href={job.result.url} target="_blank" rel="noreferrer">
                {job.result.url}
              </a>
            </div>
            <div className="rounded-md border border-[var(--axon-border)] p-2.5">
              <p className="text-slate-500">Admin</p>
              <a className="mono text-indigo-300 hover:text-indigo-200" href={job.result.adminUrl} target="_blank" rel="noreferrer">
                {job.result.adminUrl}
              </a>
            </div>
          </div>

          {job.result.finishMode === "browser" && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-200">
              Finish the setup wizard at{" "}
              <a className="mono underline" href={job.result.finishUrl} target="_blank" rel="noreferrer">
                {job.result.finishUrl}
              </a>{" "}
              using the database details below.
            </div>
          )}

          {job.result.finishMode === "silent" && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-emerald-200">
              The application was installed and an admin account created for you. Sign in at the admin URL above.
            </div>
          )}

          {job.result.credentials && (
            <div className="rounded-md border border-[var(--axon-border)] p-3">
              <p className="mb-1.5 text-[11px] font-medium text-slate-300">Credentials — shown once, save them now</p>
              {job.result.credentials.database && <CredentialRow label="Database" value={job.result.credentials.database} />}
              {job.result.credentials.databaseUser && <CredentialRow label="Database user" value={job.result.credentials.databaseUser} />}
              {job.result.credentials.databasePassword && <CredentialRow label="Database password" value={job.result.credentials.databasePassword} />}
              {job.result.credentials.adminUser && <CredentialRow label="Admin user" value={job.result.credentials.adminUser} />}
              {job.result.credentials.adminPassword && <CredentialRow label="Admin password" value={job.result.credentials.adminPassword} />}
              {job.result.installDir && <CredentialRow label="Directory" value={job.result.installDir} />}
            </div>
          )}

          <p className="text-[11px] text-slate-500">
            To serve this site over HTTPS, open the SSL page and issue a certificate for the domain.
          </p>
        </div>
      )}
    </div>
  );
}

function InstallPanel({
  app,
  checks,
  busy,
  error,
  onInstall,
}: {
  app: AppEntry;
  checks: Check[] | null;
  busy: boolean;
  error: string | null;
  onInstall: (options: Record<string, unknown>) => Promise<boolean>;
}) {
  const [domain, setDomain] = useState("");
  const [siteTitle, setSiteTitle] = useState(app.name);
  const [adminUser, setAdminUser] = useState("admin");
  const [adminEmail, setAdminEmail] = useState("");
  const [aliases, setAliases] = useState("");

  const effectiveChecks = checks ?? app.checks ?? [];
  const blockers = effectiveChecks.filter((check) => check?.status === "fail");
  const notes = app.notes || [];
  const manualRecipe = app.manualRecipe || [];

  if (!app.automated) {
    return (
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-slate-300">{app.description}</p>

        {notes.length > 0 && (
          <ul className="space-y-1 rounded-md border border-amber-500/25 bg-amber-500/5 p-3 text-[11px] text-amber-200">
            {notes.map((note, index) => (
              <li key={index}>• {note}</li>
            ))}
          </ul>
        )}

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-slate-300">Manual recipe</p>
          <pre className="mono overflow-auto rounded-md bg-[var(--axon-input-bg)] p-3 text-[11px] leading-relaxed text-slate-300">
            {manualRecipe.length ? manualRecipe.join("\n") : "No recipe available."}
          </pre>
          <p className="mt-2 text-[11px] text-slate-500">
            Run these in the Terminal page. The panel can prepare the database, port and nginx vhost for you on request.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-slate-300">{app.description}</p>

      {notes.length > 0 && (
        <ul className="space-y-1 rounded-md border border-[var(--axon-border)] p-3 text-[11px] text-slate-400">
          {notes.map((note, index) => (
            <li key={index}>• {note}</li>
          ))}
        </ul>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-medium text-slate-300">Requirements</p>
        {checks === null ? (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <Spinner className="h-3 w-3" /> Checking this server…
          </div>
        ) : (
          <ul className="space-y-1">
            {effectiveChecks.map((check) => (
              <li key={check.id} className="text-[11px]">
                <div className="flex items-start gap-2">
                  <span className={check.status === "ok" ? "text-emerald-400" : "text-rose-400"}>
                    {check.status === "ok" ? "✓" : "✕"}
                  </span>
                  <div>
                    <span className="text-slate-300">{check.label}</span>
                    <span className="text-slate-500"> — {check.detail}</span>
                    {check.remediation && (
                      <p className="mono mt-0.5 whitespace-pre-wrap text-[10px] text-amber-300">{check.remediation}</p>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ErrorBanner message={error} />

      {blockers.length > 0 && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 text-[11px] text-rose-200">
          This server does not currently meet the requirements for {app.name}, so installation is blocked.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Domain" hint="Must already point at this server">
          <input
            className="field mono"
            placeholder="shop.example.com"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
          />
        </Field>
        <Field label="Additional domains" hint="Comma separated, optional">
          <input className="field mono" value={aliases} onChange={(event) => setAliases(event.target.value)} />
        </Field>
        <Field label="Site title">
          <input className="field" value={siteTitle} onChange={(event) => setSiteTitle(event.target.value)} />
        </Field>
        <Field label="Admin username">
          <input className="field mono" value={adminUser} onChange={(event) => setAdminUser(event.target.value)} />
        </Field>
        <Field label="Admin email">
          <input
            className="field"
            type="email"
            placeholder="you@example.com"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
          />
        </Field>
      </div>

      <p className="text-[11px] text-slate-500">
        A database, database user and admin password are generated automatically and shown once when installation finishes.
        {app.finishMode === "browser" && " You will complete the vendor's setup wizard in the browser afterwards."}
      </p>

      <footer className="flex justify-end">
        <Button
          variant="primary"
          loading={busy}
          disabled={!domain.trim() || blockers.length > 0 || checks === null}
          onClick={() =>
            onInstall({
              domain: domain.trim(),
              aliases: aliases.split(/[\s,]+/).map((value) => value.trim()).filter(Boolean),
              siteTitle,
              adminUser,
              adminEmail: adminEmail.trim() || undefined,
            })
          }
        >
          Install {app.name}
        </Button>
      </footer>
    </div>
  );
}
