import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, ConfirmDialog, ErrorBanner, Modal, Spinner, useToast } from "../ui";

type OptimizationData = {
  siteName: string;
  domain: string;
  cleanupSummary: {
    revisions: number;
    revisionsEstimatedMb: string;
    transients: { expired: number; total: number };
    spamComments: number;
    trashComments: number;
    trashPosts: number;
    orphanedMeta: { postmeta: number; commentmeta: number; termmeta: number; total: number };
    tableOverheadMb: string;
    canReclaimMb: string;
  };
  database: {
    totalTables: number;
    dataSizeMb: string;
    indexSizeMb: string;
    totalSizeMb: string;
    overheadMb: string;
    mariadb: {
      innodbBufferPoolMb: number;
      recommendedBufferPoolMb: number;
      bufferPoolHitRatio: string;
      maxConnections: number;
      activeThreads: number;
      maxUsedConnections: number;
      slowQueryLog: boolean;
      slowQueriesCount: number;
    };
  };
  unusedComponents: {
    inactivePluginsCount: number;
    inactivePlugins: Array<{ name: string; version: string }>;
    inactiveThemesCount: number;
    inactiveThemes: Array<{ name: string; version: string }>;
  };
  wordpressConfig: {
    autosaveInterval: number;
    autosaveRecommended: number;
    heartbeatDisabled: boolean;
  };
  phpOptimization: {
    version: string;
    recommendedVersion: string;
    opcache: {
      enabled: boolean;
      hitRate: number;
      memoryUsedMb: number;
      memoryFreeMb: number;
      cachedScripts: number;
      maxAcceleratedFiles?: number;
      revalidateFreq?: number;
    };
    settings: {
      memoryLimit: string;
      maxExecutionTime: string;
      uploadMaxFilesize: string;
      postMaxSize: string;
    };
  };
  media: {
    totalImages: number;
    largeImagesCount: number;
    largeImagesTotalMb: string;
    webpImagesCount: number;
    webpCoveragePercent: number;
    avifSupported: boolean;
    lazyLoadingEnabled: boolean;
  };
  serverPerformance: {
    ttfbMs: number;
    ttfbRating: "fast" | "moderate" | "slow";
    loadAvg: string[];
    ram: { totalMb: number; usedMb: number; freeMb: number; usagePercent: number };
    note: string;
  };
};

export default function WpOptimizationTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [data, setData] = useState<OptimizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mode: "audit" | "recommended" | "manual"
  const [mode, setMode] = useState<"audit" | "recommended" | "manual">("recommended");

  // Manual selections
  const [optRevisions, setOptRevisions] = useState(true);
  const [optTransients, setOptTransients] = useState(true);
  const [optSpamTrash, setOptSpamTrash] = useState(true);
  const [optOrphanedMeta, setOptOrphanedMeta] = useState(true);
  const [optTables, setOptTables] = useState(true);
  const [optAutosave, setOptAutosave] = useState(true);

  // Image optimization
  const [optimizingImages, setOptimizingImages] = useState(false);
  const [preserveOriginalImages, setPreserveOriginalImages] = useState(true);
  const [imageOptResult, setImageOptResult] = useState<any>(null);

  // Confirm dialog
  const [confirmClean, setConfirmClean] = useState(false);

  const toast = useToast();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<OptimizationData>(`/wp/${encodeURIComponent(siteName)}/optimization/audit`);
      setData(res);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [siteName]);

  const handleApplyOptimization = async () => {
    setBusy(true);
    try {
      const options =
        mode === "recommended"
          ? { cleanRevisions: true, cleanTransients: true, cleanSpamTrash: true, cleanOrphanedMeta: true, optimizeTables: true, tuneAutosave: true }
          : { cleanRevisions: optRevisions, cleanTransients: optTransients, cleanSpamTrash: optSpamTrash, cleanOrphanedMeta: optOrphanedMeta, optimizeTables: optTables, tuneAutosave: optAutosave };

      const res = await api.post<{ ok: boolean; message: string; results: any }>(
        `/wp/${encodeURIComponent(siteName)}/optimization/apply`,
        { options, isRecommendedMode: mode === "recommended" }
      );

      toast("ok", res.message || "Optimization operations completed! Pre-cleanup backup saved.");
      setConfirmClean(false);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOptimizeImages = async () => {
    setOptimizingImages(true);
    try {
      const res = await api.post<{ ok: boolean; processedCount: number; bytesSavedMb: string }>(
        `/wp/${encodeURIComponent(siteName)}/optimization/images`,
        { maxImages: 25, generateWebp: true, preserveOriginal: preserveOriginalImages }
      );
      setImageOptResult(res);
      toast("ok", `Processed ${res.processedCount} images. Reclaimed ${res.bytesSavedMb} MB space.`);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setOptimizingImages(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--axon-muted)]">
        <Spinner className="h-6 w-6 mb-2" />
        Auditing database, queries, media assets, PHP settings, and server TTFB...
      </div>
    );
  }

  const ttfbTone =
    data?.serverPerformance.ttfbRating === "fast" ? "ok" : data?.serverPerformance.ttfbRating === "moderate" ? "warn" : "bad";

  return (
    <div className="space-y-6 pt-1">
      <ErrorBanner message={error} />

      {/* Mode Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)]">Optimization Mode:</span>
          <div className="flex rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-0.5 text-xs">
            <button
              onClick={() => setMode("audit")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                mode === "audit" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
              }`}
            >
              Audit Mode
            </button>
            <button
              onClick={() => setMode("recommended")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                mode === "recommended" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
              }`}
            >
              Recommended
            </button>
            <button
              onClick={() => setMode("manual")}
              className={`rounded px-2.5 py-1 font-medium transition ${
                mode === "manual" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
              }`}
            >
              Advanced Manual
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" className="text-xs py-1" onClick={loadData}>
            ↻ Refresh Metrics
          </Button>
          {mode !== "audit" && (
            <Button variant="primary" loading={busy} onClick={() => setConfirmClean(true)}>
              ⚡ {mode === "recommended" ? "Run Recommended Cleanup" : "Apply Selected Cleanups"}
            </Button>
          )}
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid gap-3 sm:grid-cols-4">
        {/* Metric 1: Reclaimable DB */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Reclaimable Overhead</p>
          <p className="mt-1 text-xl font-bold text-[var(--axon-primary)]">{data?.cleanupSummary.canReclaimMb} MB</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
            {data?.cleanupSummary.revisions} revisions · {data?.cleanupSummary.transients.expired} expired transients
          </p>
        </div>

        {/* Metric 2: Database Size */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Total Database Size</p>
          <p className="mt-1 text-xl font-bold text-[var(--axon-text)]">{data?.database.totalSizeMb} MB</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
            {data?.database.totalTables} tables · {data?.database.overheadMb} MB fragmentation
          </p>
        </div>

        {/* Metric 3: Measured TTFB */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Local Server TTFB</p>
            <Badge tone={ttfbTone}>{data?.serverPerformance.ttfbRating.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 text-xl font-bold text-[var(--axon-text)]">{data?.serverPerformance.ttfbMs} ms</p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">Time to First Byte (server-side)</p>
        </div>

        {/* Metric 4: System Memory */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3.5">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">System RAM Usage</p>
          <p className="mt-1 text-xl font-bold text-[var(--axon-text)]">
            {data?.serverPerformance.ram.usedMb} / {data?.serverPerformance.ram.totalMb} MB
          </p>
          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
            Load: {data?.serverPerformance.loadAvg.join(", ")}
          </p>
        </div>
      </div>

      {/* Database Cleanup Section */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">
          WordPress Database Cleanup Operations
        </h4>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">Post Revisions</span>
              {mode === "manual" && (
                <input
                  type="checkbox"
                  checked={optRevisions}
                  onChange={(e) => setOptRevisions(e.target.checked)}
                  className="rounded"
                />
              )}
            </div>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-1">{data?.cleanupSummary.revisions}</p>
            <p className="text-[11px] text-[var(--axon-muted)]">~{data?.cleanupSummary.revisionsEstimatedMb} MB reclaimable</p>
          </div>

          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">Expired Transients</span>
              {mode === "manual" && (
                <input
                  type="checkbox"
                  checked={optTransients}
                  onChange={(e) => setOptTransients(e.target.checked)}
                  className="rounded"
                />
              )}
            </div>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-1">
              {data?.cleanupSummary.transients.expired} <span className="text-xs text-[var(--axon-muted)]">/ {data?.cleanupSummary.transients.total}</span>
            </p>
            <p className="text-[11px] text-[var(--axon-muted)]">Temporary cache options</p>
          </div>

          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">Spam & Trash Items</span>
              {mode === "manual" && (
                <input
                  type="checkbox"
                  checked={optSpamTrash}
                  onChange={(e) => setOptSpamTrash(e.target.checked)}
                  className="rounded"
                />
              )}
            </div>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-1">
              {data?.cleanupSummary.spamComments + data?.cleanupSummary.trashComments + data?.cleanupSummary.trashPosts}
            </p>
            <p className="text-[11px] text-[var(--axon-muted)]">
              {data?.cleanupSummary.spamComments} spam, {data?.cleanupSummary.trashPosts} trashed posts
            </p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">Orphaned Metadata</span>
              {mode === "manual" && (
                <input
                  type="checkbox"
                  checked={optOrphanedMeta}
                  onChange={(e) => setOptOrphanedMeta(e.target.checked)}
                  className="rounded"
                />
              )}
            </div>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-1">
              {data?.cleanupSummary.orphanedMeta.total}
            </p>
            <p className="text-[11px] text-[var(--axon-muted)]">
              {data?.cleanupSummary.orphanedMeta.postmeta} postmeta, {data?.cleanupSummary.orphanedMeta.commentmeta} commentmeta
            </p>
          </div>

          <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">Table Overhead Fragmentation</span>
              {mode === "manual" && (
                <input
                  type="checkbox"
                  checked={optTables}
                  onChange={(e) => setOptTables(e.target.checked)}
                  className="rounded"
                />
              )}
            </div>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-1">{data?.cleanupSummary.tableOverheadMb} MB</p>
            <p className="text-[11px] text-[var(--axon-muted)]">Run OPTIMIZE TABLE on all site tables</p>
          </div>
        </div>
      </div>

      {/* Media Optimization & WebP Conversion */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--axon-text)]">Media & Image Optimization</h4>
            <p className="text-xs text-[var(--axon-muted)]">
              Lossless JPEG/PNG compression and WebP sibling generation with original image preservation.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-[var(--axon-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={preserveOriginalImages}
                onChange={(e) => setPreserveOriginalImages(e.target.checked)}
                className="rounded"
              />
              Preserve uncompressed originals (.original.jpg)
            </label>
            <Button variant="primary" loading={optimizingImages} onClick={handleOptimizeImages}>
              🖼️ Optimize Uploads & Convert WebP
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-[var(--axon-border)] p-3">
            <p className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Total Uploaded Images</p>
            <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">{data?.media.totalImages} images</p>
            <p className="text-[11px] text-[var(--axon-muted)]">In wp-content/uploads/</p>
          </div>

          <div className="rounded-lg border border-[var(--axon-border)] p-3">
            <p className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Large Images (&gt;1 MB)</p>
            <p className="mt-1 text-sm font-semibold text-amber-400">
              {data?.media.largeImagesCount} ({data?.media.largeImagesTotalMb} MB)
            </p>
            <p className="text-[11px] text-[var(--axon-muted)]">Candidate for compression</p>
          </div>

          <div className="rounded-lg border border-[var(--axon-border)] p-3">
            <p className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">WebP Coverage</p>
            <p className="mt-1 text-sm font-semibold text-[var(--axon-primary)]">
              {data?.media.webpCoveragePercent}% ({data?.media.webpImagesCount} files)
            </p>
            <p className="text-[11px] text-[var(--axon-muted)]">Next-gen format delivery</p>
          </div>
        </div>

        {imageOptResult && (
          <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            Processed {imageOptResult.processedCount} images. Reclaimed {imageOptResult.bytesSavedMb} MB.
          </div>
        )}
      </div>

      {/* PHP & MariaDB Performance Diagnostics */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* PHP Diagnostics */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">PHP Runtime Tuning</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">PHP Version</span>
              <span className="font-semibold text-emerald-400">PHP {data?.phpOptimization.version} (Optimized)</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">OPcache Hit Rate</span>
              <span className="font-semibold text-[var(--axon-text)]">{data?.phpOptimization.opcache.hitRate}%</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Memory Limit</span>
              <span className="font-mono text-[var(--axon-text)]">{data?.phpOptimization.settings.memoryLimit}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Max Execution Time</span>
              <span className="font-mono text-[var(--axon-text)]">{data?.phpOptimization.settings.maxExecutionTime}s</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[var(--axon-muted)]">Max Upload & Post Size</span>
              <span className="font-mono text-[var(--axon-text)]">
                {data?.phpOptimization.settings.uploadMaxFilesize} / {data?.phpOptimization.settings.postMaxSize}
              </span>
            </div>
          </div>
        </div>

        {/* MariaDB Diagnostics */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-3">MariaDB Engine Analysis</h4>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">InnoDB Buffer Pool</span>
              <span className="font-semibold text-[var(--axon-text)]">
                {data?.database.mariadb.innodbBufferPoolMb} MB{" "}
                <span className="text-[11px] text-[var(--axon-muted)]">(Rec: {data?.database.mariadb.recommendedBufferPoolMb} MB)</span>
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Buffer Pool Hit Ratio</span>
              <span className="font-semibold text-emerald-400">{data?.database.mariadb.bufferPoolHitRatio}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Active Connections / Max</span>
              <span className="font-mono text-[var(--axon-text)]">
                {data?.database.mariadb.activeThreads} / {data?.database.mariadb.maxConnections}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Slow Query Log</span>
              <Badge tone={data?.database.mariadb.slowQueryLog ? "ok" : "neutral"}>
                {data?.database.mariadb.slowQueryLog ? "Active" : "Disabled"}
              </Badge>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[var(--axon-muted)]">Slow Queries Logged</span>
              <span className="font-mono text-[var(--axon-text)]">{data?.database.mariadb.slowQueriesCount}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmClean}
        title="Execute Performance Cleanup?"
        message={`This will clean expired transients, revisions, trashed items, and optimize tables for ${siteName}. An automated database dump snapshot will be created first.`}
        confirmLabel="Run Cleanup Now"
        busy={busy}
        onCancel={() => setConfirmClean(false)}
        onConfirm={handleApplyOptimization}
      />
    </div>
  );
}
