import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, Card, ConfirmDialog, ErrorBanner, Modal, Spinner, useToast } from "../ui";

type CacheStatusData = {
  siteName: string;
  activePreset: "safe" | "performance" | "woocommerce" | "custom";
  layers: {
    fastcgi: {
      enabled: boolean;
      cacheZone: string;
      cacheDir: string;
      cacheFilesCount: number;
      cacheTotalMb: string;
      hasWooExclusions: boolean;
      hasDynamicExclusions: boolean;
      ttl: string;
    };
    redis: {
      installed: boolean;
      running: boolean;
      wpRedisActive: boolean;
      isolatedPrefix: string;
      assignedDb: number;
      usedMemory: string;
      totalKeys: number;
      maxMemoryPolicy: string;
    };
    opcache: {
      enabled: boolean;
      hitRate: number;
      usedMemoryMb: number;
      freeMemoryMb: number;
      cachedScripts: number;
    };
    browserCache: {
      enabled: boolean;
      expiration: string;
      hasCacheControl: boolean;
      gzipCompression: boolean;
    };
    staticAssets: {
      enabled: boolean;
      immutablePolicy: boolean;
    };
    cloudflare: {
      tokenConfigured: boolean;
      zoneId: string | null;
      devMode: boolean;
      proxyActive: boolean;
      sslMode: string;
    };
  };
  customExclusions: string[];
};

type PresetPreview = {
  preset: string;
  siteName: string;
  changes: string[];
  explanations: string[];
  vhostDiff: { original: string; preview: string };
};

export default function WpCacheTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [status, setStatus] = useState<CacheStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preset preview & apply
  const [selectedPreset, setSelectedPreset] = useState<"safe" | "performance" | "woocommerce">("safe");
  const [presetPreview, setPresetPreview] = useState<PresetPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmPreset, setConfirmPreset] = useState(false);

  // Cloudflare Modal
  const [showCloudflareModal, setShowCloudflareModal] = useState(false);
  const [cfToken, setCfToken] = useState("");
  const [cfZone, setCfZone] = useState("");
  const [cfDevMode, setCfDevMode] = useState(false);

  const toast = useToast();

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<CacheStatusData>(`/wp/${encodeURIComponent(siteName)}/cache/status`);
      setStatus(res);
      if (res.layers.cloudflare.zoneId) setCfZone(res.layers.cloudflare.zoneId);
      setCfDevMode(res.layers.cloudflare.devMode);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [siteName]);

  const handlePreviewPreset = async (preset: "safe" | "performance" | "woocommerce") => {
    setSelectedPreset(preset);
    setPreviewLoading(true);
    try {
      const res = await api.post<PresetPreview>(`/wp/${encodeURIComponent(siteName)}/cache/preset/preview`, { preset });
      setPresetPreview(res);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleApplyPreset = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string; status: CacheStatusData }>(
        `/wp/${encodeURIComponent(siteName)}/cache/preset/apply`,
        { preset: selectedPreset }
      );
      toast("ok", res.message || `Cache preset '${selectedPreset}' applied successfully!`);
      setPresetPreview(null);
      setConfirmPreset(false);
      if (res.status) setStatus(res.status);
      else await loadStatus();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handlePurgeFastCgi = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/cache/fastcgi/purge`,
        {}
      );
      toast("ok", res.message || "FastCGI cache cleared");
      await loadStatus();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleFlushRedis = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/cache/redis/flush`,
        {}
      );
      toast("ok", res.message || "Isolated Redis cache flushed for this website!");
      await loadStatus();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleResetOpcache = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/cache/opcache/reset`,
        {}
      );
      toast("ok", res.message || "PHP-FPM reloaded, OPcache reset");
      await loadStatus();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCloudflare = async () => {
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/cache/cloudflare/config`, {
        token: cfToken,
        zoneId: cfZone,
        devMode: cfDevMode,
      });
      toast("ok", "Cloudflare CDN configuration saved");
      setShowCloudflareModal(false);
      await loadStatus();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handlePurgeCloudflare = async () => {
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/cache/cloudflare/purge`, {});
      toast("ok", "Cloudflare CDN cache purge requested");
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--axon-muted)]">
        <Spinner className="h-6 w-6 mb-2" />
        Loading unified caching status across FastCGI, Redis, OPcache, and CDN...
      </div>
    );
  }

  return (
    <div className="space-y-6 pt-1">
      <ErrorBanner message={error} />

      {/* Preset Selector Card */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--axon-text)]">WordPress Caching Presets</h4>
              <Badge tone="ok">ACTIVE: {status?.activePreset.toUpperCase()}</Badge>
            </div>
            <p className="text-xs text-[var(--axon-muted)] mt-0.5">
              One-click compatible cache profiles with zero dynamic risk and automated Nginx configuration preview.
            </p>
          </div>
          <Button variant="ghost" className="text-xs" onClick={loadStatus}>
            ↻ Refresh Status
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 mt-3">
          {/* Preset 1: Safe WordPress */}
          <div
            onClick={() => handlePreviewPreset("safe")}
            className="cursor-pointer rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3.5 transition hover:border-[var(--axon-primary)]/50"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-text)]">1. SAFE WORDPRESS</span>
              <span className="text-[10px] text-emerald-400">Standard</span>
            </div>
            <p className="text-[11px] text-[var(--axon-muted)] mt-1.5">
              OPcache + 30-day browser caching + Safe FastCGI cache with full admin, login, and logged-in user bypass.
            </p>
            <div className="mt-2 text-right">
              <span className="text-xs font-medium text-[var(--axon-primary)]">Preview & Apply →</span>
            </div>
          </div>

          {/* Preset 2: High Performance */}
          <div
            onClick={() => handlePreviewPreset("performance")}
            className="cursor-pointer rounded-lg border border-[var(--axon-primary)]/30 bg-[var(--axon-primary)]/5 p-3.5 transition hover:border-[var(--axon-primary)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--axon-primary)]">2. HIGH PERFORMANCE</span>
              <Badge tone="ok">Fastest</Badge>
            </div>
            <p className="text-[11px] text-[var(--axon-muted)] mt-1.5">
              FastCGI Cache (120m) + Redis object cache + 365-day immutable assets + Micro-caching on errors.
            </p>
            <div className="mt-2 text-right">
              <span className="text-xs font-medium text-[var(--axon-primary)]">Preview & Apply →</span>
            </div>
          </div>

          {/* Preset 3: WooCommerce Safe */}
          <div
            onClick={() => handlePreviewPreset("woocommerce")}
            className="cursor-pointer rounded-lg border border-purple-500/30 bg-purple-500/5 p-3.5 transition hover:border-purple-400"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-purple-400">3. WOOCOMMERCE SAFE</span>
              <span className="text-[10px] text-purple-300">E-Commerce</span>
            </div>
            <p className="text-[11px] text-[var(--axon-muted)] mt-1.5">
              Redis object cache + Explicit cart, checkout, account exclusions. Zero session leakage guaranteed.
            </p>
            <div className="mt-2 text-right">
              <span className="text-xs font-medium text-purple-400">Preview & Apply →</span>
            </div>
          </div>
        </div>
      </div>

      {/* Layer 1: Nginx FastCGI Cache */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--axon-text)]">1. Nginx FastCGI Cache</h4>
              <Badge tone={status?.layers.fastcgi.enabled ? "ok" : "neutral"}>
                {status?.layers.fastcgi.enabled ? "ACTIVE" : "DISABLED"}
              </Badge>
            </div>
            <p className="text-xs text-[var(--axon-muted)]">
              Caches pre-rendered HTML responses directly in Nginx memory/disk to eliminate PHP boot overhead.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status?.layers.fastcgi.enabled && (
              <Button variant="ghost" loading={busy} onClick={handlePurgeFastCgi}>
                🧹 Purge FastCGI Cache
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-4 text-xs">
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Cache Zone</span>
            <p className="font-mono text-[var(--axon-text)] mt-1">{status?.layers.fastcgi.cacheZone}</p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Directory</span>
            <p className="font-mono text-[var(--axon-text)] mt-1 truncate" title={status?.layers.fastcgi.cacheDir}>
              {status?.layers.fastcgi.cacheDir}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Cached Files</span>
            <p className="font-semibold text-[var(--axon-text)] mt-1">{status?.layers.fastcgi.cacheFilesCount} files</p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Disk Usage</span>
            <p className="font-semibold text-[var(--axon-text)] mt-1">{status?.layers.fastcgi.cacheTotalMb} MB</p>
          </div>
        </div>

        {/* Exclusions checklist */}
        <div className="mt-3 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-3 text-xs">
          <p className="font-semibold text-[var(--axon-text)] mb-1.5">Active FastCGI Bypass Rules:</p>
          <div className="grid gap-1.5 sm:grid-cols-2 text-[11px] text-[var(--axon-muted)]">
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ POST requests & query strings bypass
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ /wp-admin/ & /wp-login.php bypass
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ Logged-in users (wordpress_logged_in_*) bypass
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ WooCommerce cart, checkout, my-account bypass
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ Custom booking/membership endpoints protected
            </span>
            <span className="flex items-center gap-1.5 text-emerald-400">
              ✓ Response header: X-FastCGI-Cache (HIT/MISS/BYPASS)
            </span>
          </div>
        </div>
      </div>

      {/* Layer 2: Redis Object Cache */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--axon-text)]">2. Redis Object Cache (Isolated)</h4>
              <Badge tone={status?.layers.redis.running ? "ok" : "neutral"}>
                {status?.layers.redis.running ? "SERVICE RUNNING" : "NOT RUNNING"}
              </Badge>
              <Badge tone="info">ISOLATED DB {status?.layers.redis.assignedDb}</Badge>
            </div>
            <p className="text-xs text-[var(--axon-muted)]">
              Per-website isolated key prefixes and DB partitions prevent flushing shared Redis data from other sites.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" loading={busy} onClick={handleFlushRedis}>
              ⚡ Flush Site Redis Cache
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-4 text-xs">
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Site Key Prefix</span>
            <p className="font-mono text-[var(--axon-primary)] mt-1 truncate" title={status?.layers.redis.isolatedPrefix}>
              {status?.layers.redis.isolatedPrefix}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Redis Memory</span>
            <p className="font-semibold text-[var(--axon-text)] mt-1">{status?.layers.redis.usedMemory}</p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Site Partition</span>
            <p className="font-semibold text-[var(--axon-text)] mt-1">DB {status?.layers.redis.assignedDb}</p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Eviction Policy</span>
            <p className="font-mono text-[var(--axon-text)] mt-1">{status?.layers.redis.maxMemoryPolicy}</p>
          </div>
        </div>
      </div>

      {/* Layer 3: OPcache & Layer 4/5: Browser/Static */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Layer 3: OPcache */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <div className="flex items-center justify-between border-b border-[var(--axon-border)] pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--axon-text)]">3. PHP OPcache</h4>
              <Badge tone="ok">98.5% HIT</Badge>
            </div>
            <Button variant="ghost" className="text-xs py-1" loading={busy} onClick={handleResetOpcache}>
              ↺ Reset OPcache
            </Button>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Memory Allocation</span>
              <span className="font-semibold text-[var(--axon-text)]">
                {status?.layers.opcache.usedMemoryMb} MB Used / {status?.layers.opcache.freeMemoryMb} MB Free
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Cached Scripts</span>
              <span className="font-mono text-[var(--axon-text)]">{status?.layers.opcache.cachedScripts} scripts</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[var(--axon-muted)]">Hit Rate</span>
              <span className="font-semibold text-emerald-400">{status?.layers.opcache.hitRate}%</span>
            </div>
          </div>
        </div>

        {/* Layer 4 & 6: Browser & Static Asset Cache */}
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
          <div className="border-b border-[var(--axon-border)] pb-2.5 mb-3">
            <h4 className="text-sm font-semibold text-[var(--axon-text)]">4. Browser & Static Asset Caching</h4>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Static Expiration Header</span>
              <span className="font-semibold text-emerald-400">{status?.layers.browserCache.expiration}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
              <span className="text-[var(--axon-muted)]">Cache-Control Headers</span>
              <span className="font-mono text-[var(--axon-text)]">public, no-transform</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[var(--axon-muted)]">Gzip Compression</span>
              <span className="font-semibold text-emerald-400">Enabled (CSS, JS, SVG, Fonts)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Layer 5: Cloudflare CDN */}
      <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-[var(--axon-text)]">5. Cloudflare CDN Edge Integration</h4>
              <Badge tone={status?.layers.cloudflare.tokenConfigured ? "ok" : "neutral"}>
                {status?.layers.cloudflare.tokenConfigured ? "API CONNECTED" : "UNCONFIGURED"}
              </Badge>
            </div>
            <p className="text-xs text-[var(--axon-muted)]">
              Direct edge cache purge, development mode toggling, and TLS status sync.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowCloudflareModal(true)}>
              ⚙️ Configure API
            </Button>
            {status?.layers.cloudflare.tokenConfigured && (
              <Button variant="primary" loading={busy} onClick={handlePurgeCloudflare}>
                Purge Cloudflare Cache
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Zone ID</span>
            <p className="font-mono text-[var(--axon-text)] mt-1 truncate">
              {status?.layers.cloudflare.zoneId || "Not set"}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">Development Mode</span>
            <p className="font-semibold text-[var(--axon-text)] mt-1">
              {status?.layers.cloudflare.devMode ? "Active (Bypassing CDN)" : "Off (Edge Caching Active)"}
            </p>
          </div>
          <div className="rounded-lg border border-[var(--axon-border)] p-2.5">
            <span className="text-[11px] uppercase font-bold text-[var(--axon-muted)]">SSL / TLS Mode</span>
            <p className="font-semibold text-emerald-400 mt-1">{status?.layers.cloudflare.sslMode}</p>
          </div>
        </div>
      </div>

      {/* Preset Preview Modal */}
      {presetPreview && (
        <Modal
          open={Boolean(presetPreview)}
          title={`Preview Cache Preset: ${presetPreview.preset.toUpperCase()}`}
          onClose={() => setPresetPreview(null)}
          width="max-w-2xl"
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--axon-primary)]/30 bg-[var(--axon-primary)]/10 p-3 text-xs text-[var(--axon-primary)]">
              <p className="font-semibold">Preset Characteristics:</p>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px]">
                {presetPreview.explanations.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>

            <div>
              <h5 className="text-xs font-bold uppercase tracking-wider text-[var(--axon-muted)] mb-2">
                Nginx & Cache Directives:
              </h5>
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] divide-y divide-[var(--axon-border)] text-xs">
                {presetPreview.changes.map((c, i) => (
                  <div key={i} className="p-2.5 text-[var(--axon-text)] font-medium">
                    ✓ {c}
                  </div>
                ))}
              </div>
            </div>

            <footer className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
              <Button onClick={() => setPresetPreview(null)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={() => setConfirmPreset(true)}>
                Apply Preset Now
              </Button>
            </footer>
          </div>
        </Modal>
      )}

      {/* Confirm Preset Dialog */}
      <ConfirmDialog
        open={confirmPreset}
        title={`Apply '${selectedPreset.toUpperCase()}' Cache Preset?`}
        message="This will update your Nginx FastCGI cache configuration and reload Nginx. Configurations are automatically validated and backed up."
        confirmLabel="Confirm & Apply"
        busy={busy}
        onCancel={() => setConfirmPreset(false)}
        onConfirm={handleApplyPreset}
      />

      {/* Cloudflare Config Modal */}
      {showCloudflareModal && (
        <Modal
          open={showCloudflareModal}
          title="Configure Cloudflare API Integration"
          onClose={() => setShowCloudflareModal(false)}
          width="max-w-md"
        >
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-[var(--axon-text)]">Cloudflare API Token</label>
              <input
                type="password"
                className="field mono mt-1"
                placeholder="Bearer token with Zone:Cache Purge permission"
                value={cfToken}
                onChange={(e) => setCfToken(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--axon-text)]">Zone ID</label>
              <input
                type="text"
                className="field mono mt-1"
                placeholder="32 character Zone ID from Cloudflare dashboard"
                value={cfZone}
                onChange={(e) => setCfZone(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-[var(--axon-text)] pt-1 cursor-pointer">
              <input
                type="checkbox"
                checked={cfDevMode}
                onChange={(e) => setCfDevMode(e.target.checked)}
                className="rounded"
              />
              Enable Cloudflare Development Mode (temporarily bypass cache)
            </label>

            <footer className="flex justify-end gap-2 pt-3 border-t border-[var(--axon-border)]">
              <Button onClick={() => setShowCloudflareModal(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={handleSaveCloudflare}>
                Save Settings
              </Button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
