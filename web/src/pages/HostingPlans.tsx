import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, Card, Spinner } from "../components/ui";
import { formatBytes } from "../lib/format";

type HostingPlan = {
  id: string;
  name: string;
  slug: string;
  max_websites: number;
  max_databases: number;
  max_storage_mb: number;
  max_bandwidth_mb: number;
  organization_count?: number;
  created_at: string;
};

export default function HostingPlans() {
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [formPlanId, setFormPlanId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    maxWebsites: 5,
    maxDatabases: 5,
    maxStorageMb: 5120,
    maxBandwidthMb: 51200,
  });
  const [submitting, setSubmitting] = useState(false);

  const [deletingPlan, setDeletingPlan] = useState<HostingPlan | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const loadPlans = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<{ plans: HostingPlan[] }>("/plans");
      setPlans(res.plans || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load hosting plans");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleOpenCreate = () => {
    setIsEditing(false);
    setFormPlanId(null);
    setFormData({
      name: "",
      slug: "",
      maxWebsites: 5,
      maxDatabases: 5,
      maxStorageMb: 5120,
      maxBandwidthMb: 51200,
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (plan: HostingPlan) => {
    setIsEditing(true);
    setFormPlanId(plan.id);
    setFormData({
      name: plan.name,
      slug: plan.slug,
      maxWebsites: plan.max_websites,
      maxDatabases: plan.max_databases,
      maxStorageMb: plan.max_storage_mb,
      maxBandwidthMb: plan.max_bandwidth_mb,
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (isEditing && formPlanId) {
        await api.put(`/plans/${formPlanId}`, formData);
        setSuccess(`Plan "${formData.name}" updated successfully.`);
      } else {
        await api.post("/plans", formData);
        setSuccess(`Plan "${formData.name}" created successfully.`);
      }
      setIsModalOpen(false);
      loadPlans();
    } catch (err: any) {
      setError(err?.message || "Failed to save hosting plan");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingPlan) return;
    setSubmittingDelete(true);
    setError(null);
    try {
      await api.delete(`/plans/${deletingPlan.id}`);
      setSuccess(`Plan "${deletingPlan.name}" deleted.`);
      setDeletingPlan(null);
      loadPlans();
    } catch (err: any) {
      setError(err?.message || "Failed to delete plan");
    } finally {
      setSubmittingDelete(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--axon-text)]">Hosting Plans & Quotas</h1>
          <p className="text-xs text-[var(--axon-muted)] mt-0.5">
            Define resource quota limits for websites, databases, and disk capacity per customer plan.
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold text-xs">
          + Create Hosting Plan
        </Button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-emerald-300">✕</button>
        </div>
      )}

      {/* Plans Grid */}
      {loading ? (
        <div className="p-12 text-center text-xs text-[var(--axon-muted)] flex items-center justify-center gap-2">
          <Spinner /> Loading hosting plans…
        </div>
      ) : plans.length === 0 ? (
        <Card className="p-12 text-center text-xs text-[var(--axon-muted)] bg-[var(--axon-card)] border-[var(--axon-border)]">
          No hosting plans configured. Click "+ Create Hosting Plan" above to create one.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {plans.map((p) => (
            <Card key={p.id} className="p-5 flex flex-col justify-between bg-[var(--axon-card)] border-[var(--axon-border)] hover:border-[var(--axon-primary)]/40 transition-all">
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-[var(--axon-text)]">{p.name}</h3>
                  <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[var(--axon-card-hover)] text-[var(--axon-muted)] border border-[var(--axon-border)]">
                    {p.slug}
                  </span>
                </div>

                <div className="mt-4 space-y-2 text-xs border-t border-[var(--axon-border)] pt-3">
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--axon-muted)]">Websites Quota</span>
                    <span className="font-mono font-semibold text-[var(--axon-text)]">
                      {p.max_websites >= 999 ? "Unlimited" : `${p.max_websites} Sites`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--axon-muted)]">Databases Quota</span>
                    <span className="font-mono font-semibold text-[var(--axon-text)]">
                      {p.max_databases >= 999 ? "Unlimited" : `${p.max_databases} DBs`}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--axon-muted)]">Storage Limit</span>
                    <span className="font-mono font-semibold text-[var(--axon-text)]">
                      {p.max_storage_mb >= 99999 ? "Unlimited" : formatBytes(p.max_storage_mb * 1024 * 1024, 0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[var(--axon-muted)]">Bandwidth Limit</span>
                    <span className="font-mono font-semibold text-[var(--axon-text)]">
                      {p.max_bandwidth_mb >= 99999 ? "Unlimited" : formatBytes(p.max_bandwidth_mb * 1024 * 1024, 0)}
                    </span>
                  </div>
                </div>

                <div className="mt-4 p-2.5 rounded-lg bg-[var(--axon-sidebar)] border border-[var(--axon-border)] text-center">
                  <p className="text-[10px] text-[var(--axon-muted)] uppercase tracking-wider font-semibold">Active Organizations</p>
                  <p className="text-base font-bold text-[var(--axon-primary)] mt-0.5">
                    {p.organization_count || 0}
                  </p>
                </div>
              </div>

              <div className="mt-5 pt-3 border-t border-[var(--axon-border)] flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit(p)}
                  className="flex-1 text-xs"
                >
                  Edit Quotas
                </Button>
                {p.slug !== "unlimited" && (p.organization_count === 0 || !p.organization_count) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeletingPlan(p)}
                    className="text-xs text-rose-400 hover:text-rose-300 hover:border-rose-500/40"
                    title="Delete Plan"
                  >
                    Delete
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Plan Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-[var(--axon-text)]">
                {isEditing ? `Edit Plan: ${formData.name}` : "Create Hosting Plan"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 pt-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Plan Name *</label>
                  <input
                    required
                    className="field text-xs w-full"
                    placeholder="e.g. Professional"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Slug</label>
                  <input
                    className="field text-xs w-full disabled:opacity-50"
                    placeholder="pro"
                    disabled={isEditing}
                    value={formData.slug}
                    onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Max Websites *</label>
                  <input
                    required
                    type="number"
                    min="1"
                    className="field text-xs w-full"
                    value={formData.maxWebsites}
                    onChange={(e) => setFormData({ ...formData, maxWebsites: parseInt(e.target.value, 10) || 1 })}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Max Databases *</label>
                  <input
                    required
                    type="number"
                    min="0"
                    className="field text-xs w-full"
                    value={formData.maxDatabases}
                    onChange={(e) => setFormData({ ...formData, maxDatabases: parseInt(e.target.value, 10) || 0 })}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Storage Limit (MB) *</label>
                  <input
                    required
                    type="number"
                    min="100"
                    step="512"
                    className="field text-xs w-full"
                    value={formData.maxStorageMb}
                    onChange={(e) => setFormData({ ...formData, maxStorageMb: parseInt(e.target.value, 10) || 1024 })}
                  />
                  <span className="text-[10px] text-[var(--axon-muted)]">
                    ≈ {formatBytes(formData.maxStorageMb * 1024 * 1024, 1)}
                  </span>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Bandwidth Limit (MB) *</label>
                  <input
                    required
                    type="number"
                    min="100"
                    step="1024"
                    className="field text-xs w-full"
                    value={formData.maxBandwidthMb}
                    onChange={(e) => setFormData({ ...formData, maxBandwidthMb: parseInt(e.target.value, 10) || 10240 })}
                  />
                  <span className="text-[10px] text-[var(--axon-muted)]">
                    ≈ {formatBytes(formData.maxBandwidthMb * 1024 * 1024, 1)}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold">
                  {submitting ? <Spinner /> : isEditing ? "Save Changes" : "Create Plan"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Delete Plan Confirm Modal */}
      {deletingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-rose-400">Delete Plan</h2>
              <button onClick={() => setDeletingPlan(null)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <div className="pt-4 text-xs space-y-3">
              <p className="text-[var(--axon-text)]">
                Are you sure you want to delete hosting plan <span className="font-bold">{deletingPlan.name}</span>?
              </p>
              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setDeletingPlan(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleDelete}
                  disabled={submittingDelete}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-semibold"
                >
                  {submittingDelete ? <Spinner /> : "Confirm Delete"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
