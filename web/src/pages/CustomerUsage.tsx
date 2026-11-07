import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Card, Spinner, useToast } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

type UsageData = {
  orgId: string;
  orgName: string;
  planName: string;
  websites: { used: number; max: number; remaining: number };
  databases: { used: number; max: number; remaining: number };
  storageMb: { used: number; max: number; remaining: number };
};

export default function CustomerUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadQuota = async () => {
    try {
      const res = await api.get<{ usage: UsageData }>("/users/quota");
      setUsage(res.usage);
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuota();
  }, []);

  const getPercent = (used: number, max: number) => {
    if (!max || max >= 9999) return Math.min(Math.round((used / 10) * 100), 100);
    return Math.min(Math.round((used / max) * 100), 100);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Hosting Plan & Resource Quotas" }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)]">Account Usage & Resource Quotas</h1>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Real-time consumption metrics against your active hosting plan limits.
          </p>
        </div>
        <Button variant="ghost" onClick={loadQuota}>
          Refresh Quota
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12 text-sm text-[var(--axon-muted)]">
          <Spinner /> Calculating resource consumption…
        </div>
      ) : !usage ? (
        <Card>
          <p className="text-xs text-[var(--axon-muted)]">No quota data available for this account.</p>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Plan Banner */}
          <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-xs text-[var(--axon-muted)] font-medium">Subscribed Hosting Plan</span>
              <h2 className="text-2xl font-black text-[var(--axon-primary)] mt-0.5">{usage.planName || "Standard Hosting"}</h2>
              <p className="text-xs text-[var(--axon-muted)] mt-1 font-mono">
                Organization: {usage.orgName} ({usage.orgId})
              </p>
            </div>
            <Link
              to="/plans"
              className="rounded-lg bg-[var(--axon-primary)] px-4 py-2 text-xs font-semibold text-[var(--axon-primary-fg)] hover:bg-[var(--axon-primary-hover)] transition"
            >
              View Plan Tiers →
            </Link>
          </div>

          {/* Quota Progress Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Websites */}
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-text)]">Active Websites</span>
                <span className="text-xs font-mono font-bold text-[var(--axon-text)]">
                  {usage.websites.used} / {usage.websites.max >= 9999 ? "Unlimited" : usage.websites.max}
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--axon-input-bg)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    getPercent(usage.websites.used, usage.websites.max) > 85 ? "bg-rose-500" : "bg-[var(--axon-primary)]"
                  }`}
                  style={{ width: `${getPercent(usage.websites.used, usage.websites.max)}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                {usage.websites.max >= 9999
                  ? "Unlimited websites allowed"
                  : `${usage.websites.remaining} website slot(s) remaining`}
              </p>
            </div>

            {/* Databases */}
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-text)]">Databases (MariaDB & Postgres)</span>
                <span className="text-xs font-mono font-bold text-[var(--axon-text)]">
                  {usage.databases.used} / {usage.databases.max >= 9999 ? "Unlimited" : usage.databases.max}
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--axon-input-bg)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    getPercent(usage.databases.used, usage.databases.max) > 85 ? "bg-rose-500" : "bg-indigo-400"
                  }`}
                  style={{ width: `${getPercent(usage.databases.used, usage.databases.max)}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                {usage.databases.max >= 9999
                  ? "Unlimited database quotas"
                  : `${usage.databases.remaining} database slot(s) remaining`}
              </p>
            </div>

            {/* Storage */}
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--axon-text)]">Disk Storage Allocation</span>
                <span className="text-xs font-mono font-bold text-[var(--axon-text)]">
                  {usage.storageMb.used} MB / {usage.storageMb.max >= 99999 ? "Unlimited" : `${usage.storageMb.max} MB`}
                </span>
              </div>
              <div className="h-2 w-full bg-[var(--axon-input-bg)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    getPercent(usage.storageMb.used, usage.storageMb.max) > 85 ? "bg-rose-500" : "bg-emerald-400"
                  }`}
                  style={{ width: `${getPercent(usage.storageMb.used, usage.storageMb.max)}%` }}
                />
              </div>
              <p className="text-[11px] text-[var(--axon-muted)]">
                Total filesystem space consumed across all document roots.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
