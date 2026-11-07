import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
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
  useAsyncAction,
  useToast,
} from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

type Snapshot = {
  id: string;
  fullId: string;
  time: string;
  paths: string[];
  tags: string[];
  hostname: string;
  username: string;
};

type BackupStatus = {
  engine: string;
  initialized: boolean;
  repo: string;
  snapshotsCount: number;
  latestSnapshot: Snapshot | null;
};

export default function Backups({ defaultTab = "snapshots" }: { defaultTab?: "snapshots" | "schedules" | "remote" }) {
  const [tab, setTab] = useState(defaultTab);
  const [status, setStatus] = useState<BackupStatus | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<Snapshot | null>(null);
  const [targetRestorePath, setTargetRestorePath] = useState("/tmp/axon-restore");
  const [customPaths, setCustomPaths] = useState("/var/www\n/etc/nginx/sites-available");

  useEffect(() => {
    if (defaultTab) {
      setTab(defaultTab);
    }
  }, [defaultTab]);

  const { busy, error, run } = useAsyncAction();
  const toast = useToast();

  const load = async () => {
    try {
      const [statusRes, snapRes] = await Promise.all([
        api.get<BackupStatus>("/backups/status"),
        api.get<{ snapshots: Snapshot[] }>("/backups/snapshots").catch(() => ({ snapshots: [] })),
      ]);
      setStatus(statusRes);
      setSnapshots(snapRes.snapshots);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateSnapshot = async () => {
    const paths = customPaths.split("\n").map((p) => p.trim()).filter(Boolean);
    await run(async () => {
      const res = await api.post<{ ok: boolean; task: { id: string } }>("/backups/create", { paths });
      setCreating(false);
      toast("ok", `Backup task queued (${res.task.id})`);
      setTimeout(load, 3000);
    }, "Backup creation task enqueued");
  };

  const handleRestoreSnapshot = async () => {
    if (!restoring) return;
    await run(async () => {
      const res = await api.post<{ ok: boolean; task: { id: string } }>("/backups/restore", {
        snapshotId: restoring.id,
        targetPath: targetRestorePath,
      });
      setRestoring(null);
      toast("ok", `Restore task queued (${res.task.id}) to ${targetRestorePath}`);
    }, "Restore task started");
  };

  const handlePrune = async () => {
    await run(async () => {
      await api.post("/backups/prune", { keepDaily: 7, keepWeekly: 4 });
      await load();
    }, "Pruned old snapshots according to retention policy");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-[var(--axon-muted)]">
        <Spinner /> Loading backup snapshots…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Breadcrumbs items={[{ label: "Backups & Recovery" }, { label: tab === "schedules" ? "Backup Schedules" : tab === "remote" ? "Remote Storage" : "Snapshot Manager" }]} />

      <ErrorBanner message={error} />

      {/* Hero Overview Card */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-[var(--axon-text)]">
                {tab === "schedules" ? "Automated Backup Schedules" : tab === "remote" ? "Remote Storage Targets" : "Backup Manager (Restic)"}
              </h1>
              <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                Restic Engine Active
              </span>
            </div>
            <p className="text-xs text-[var(--axon-muted)]">
              Snapshot-based, encrypted, deduplicated incremental backups for website files and database dumps.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={() => setCreating(true)}>
              + Create Snapshot
            </Button>
            <Button variant="ghost" loading={busy} onClick={handlePrune}>
              Prune Old Snapshots
            </Button>
            <Button variant="ghost" onClick={load}>
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <Tabs
        active={tab}
        onChange={(t) => setTab(t as any)}
        tabs={[
          { id: "snapshots", label: `Snapshots (${snapshots.length})` },
          { id: "schedules", label: "Backup Schedules" },
          { id: "remote", label: "Remote Storage (S3 / SFTP)" },
        ]}
      />

      {tab === "schedules" && (
        <Card title="Automated Backup Retention & Schedules">
          <div className="space-y-4 text-xs">
            <p className="text-[var(--axon-muted)]">
              Automated incremental snapshots run via server cron jobs and retain version history according to the active retention policy:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] space-y-1">
                <span className="font-semibold text-sm text-[var(--axon-text)]">Daily Incremental Snapshots</span>
                <p className="text-[var(--axon-muted)]">Runs every day at 02:00 UTC. Retains the last <strong>7 daily snapshots</strong>.</p>
              </div>
              <div className="p-3.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] space-y-1">
                <span className="font-semibold text-sm text-[var(--axon-text)]">Weekly Retention Archive</span>
                <p className="text-[var(--axon-muted)]">Retains the last <strong>4 weekly snapshots</strong> with automated pruning.</p>
              </div>
            </div>
            <div className="pt-2">
              <Link to="/cron" className="rounded-lg bg-[var(--axon-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--axon-primary-fg)] inline-block">
                Configure Custom Cron Triggers →
              </Link>
            </div>
          </div>
        </Card>
      )}

      {tab === "remote" && (
        <Card title="Remote Storage & Off-Site Replication">
          <div className="space-y-4 text-xs">
            <div className="p-3.5 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)]">
              <span className="font-semibold text-sm text-[var(--axon-text)]">Current Active Repository</span>
              <p className="font-mono text-xs text-[var(--axon-primary)] mt-1">{status?.repo || "/root/backups/restic-repo"}</p>
              <p className="text-[var(--axon-muted)] mt-1">Local encrypted repository stored on NVMe storage.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                <p className="font-semibold text-[var(--axon-text)]">AWS S3 / MinIO</p>
                <p className="text-[var(--axon-muted)] mt-1">Replicate snapshots to an S3-compatible bucket.</p>
              </div>
              <div className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                <p className="font-semibold text-[var(--axon-text)]">Cloudflare R2</p>
                <p className="text-[var(--axon-muted)] mt-1">Zero egress fees for remote encrypted archives.</p>
              </div>
              <div className="p-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)]">
                <p className="font-semibold text-[var(--axon-text)]">Remote SFTP</p>
                <p className="text-[var(--axon-muted)] mt-1">Secure encrypted tunnel to an external storage server.</p>
              </div>
            </div>
          </div>
        </Card>
      )}

      {tab === "snapshots" && (
        <>
          {/* Metric Cards */}
          <div className="grid gap-3.5 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Repository Target</p>
          <p className="mt-1 text-sm font-semibold mono text-[var(--axon-text)] truncate">{status?.repo || "/root/backups/restic-repo"}</p>
          <p className="mt-1 text-xs text-[var(--axon-muted)]">Local AES-256 encrypted repository</p>
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Total Snapshots</p>
          <p className="mt-1 text-2xl font-bold text-[var(--axon-primary)]">{snapshots.length}</p>
          <p className="mt-1 text-xs text-[var(--axon-muted)]">Incremental deduplicated snapshots</p>
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Latest Backup</p>
          <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">
            {snapshots[0] ? formatDate(snapshots[0].time) : "No snapshots yet"}
          </p>
          <p className="mt-1 text-xs text-[var(--axon-muted)] mono truncate">
            {snapshots[0] ? `ID: ${snapshots[0].id}` : "Run backup to create first snapshot"}
          </p>
        </div>
      </div>

      {/* Snapshots Table */}
      <Card
        title={
          <div className="flex items-center gap-2">
            <span>Restic Snapshots</span>
            <span className="rounded-full bg-[var(--axon-primary)]/20 px-2 py-0.5 text-[11px] font-semibold text-[var(--axon-primary)]">
              {snapshots.length}
            </span>
          </div>
        }
        subtitle="Deduplicated point-in-time recovery points"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] text-[11px] uppercase tracking-wider text-[var(--axon-muted)]">
                <th className="th">Snapshot ID</th>
                <th className="th">Timestamp</th>
                <th className="th">Source Paths</th>
                <th className="th">Host / User</th>
                <th className="th">Tags</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {snapshots.map((snap) => (
                <tr key={snap.id} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                  <td className="td mono font-bold text-[var(--axon-primary)]">{snap.id}</td>
                  <td className="td text-[var(--axon-text)]">{formatDate(snap.time)}</td>
                  <td className="td mono text-[11px] text-[var(--axon-muted)] max-w-xs truncate">
                    {snap.paths.join(", ")}
                  </td>
                  <td className="td text-[var(--axon-muted)]">
                    {snap.hostname} ({snap.username})
                  </td>
                  <td className="td">
                    {snap.tags.map((t) => (
                      <span key={t} className="rounded bg-[var(--axon-border)] px-1.5 py-0.5 text-[10px] text-[var(--axon-text)] mr-1">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td className="td text-right">
                    <Button
                      variant="primary"
                      onClick={() => {
                        setRestoring(snap);
                        setTargetRestorePath(`/tmp/axon-restore-${snap.id}`);
                      }}
                    >
                      Restore
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {snapshots.length === 0 && <EmptyState message="No backup snapshots found in repository" />}
        </div>
      </Card>
      </>
      )}

      {/* Create Snapshot Modal */}
      <Modal open={creating} title="Create Backup Snapshot" onClose={() => setCreating(false)} width="max-w-lg">
        <div className="space-y-4">
          <p className="text-xs text-[var(--axon-muted)]">
            A new incremental snapshot will be created by Restic in the background. Only modified file blocks will be stored.
          </p>

          <Field label="Backup Source Paths (one per line)">
            <textarea
              className="field mono text-xs h-28"
              value={customPaths}
              onChange={(e) => setCustomPaths(e.target.value)}
              placeholder="/var/www&#10;/etc/nginx/sites-available"
            />
          </Field>

          <footer className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleCreateSnapshot}>
              Start Backup Task
            </Button>
          </footer>
        </div>
      </Modal>

      {/* Restore Snapshot Modal */}
      <Modal open={Boolean(restoring)} title={`Restore Snapshot: ${restoring?.id}`} onClose={() => setRestoring(null)} width="max-w-md">
        <div className="space-y-4">
          <p className="text-xs text-[var(--axon-muted)]">
            Specify the destination directory where the snapshot files should be restored:
          </p>

          <Field label="Target Destination Path">
            <input
              className="field mono"
              value={targetRestorePath}
              onChange={(e) => setTargetRestorePath(e.target.value)}
              placeholder="/tmp/axon-restore"
              autoFocus
            />
          </Field>

          <footer className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleRestoreSnapshot}>
              Start Restore Task
            </Button>
          </footer>
        </div>
      </Modal>
    </div>
  );
}
