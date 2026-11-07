import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, Modal, Spinner, useToast } from "../ui";

type BackupEntry = {
  id: string;
  siteName: string;
  backupType: string;
  backupPath: string;
  filesIncluded: string;
  notes: string;
  sizeMb: string;
  createdAt: string;
};

export default function WpBackupTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [notes, setNotes] = useState("");

  // Restore dialog
  const [restoringBackup, setRestoringBackup] = useState<BackupEntry | null>(null);

  const toast = useToast();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ backups: BackupEntry[] }>(`/wp/${encodeURIComponent(siteName)}/backups`);
      setBackups(res.backups || []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [siteName]);

  const handleCreateBackup = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string; backupId: string }>(
        `/wp/${encodeURIComponent(siteName)}/backups/create`,
        { notes: notes.trim() || "Manual WordPress snapshot" }
      );
      toast("ok", res.message || "WordPress snapshot created successfully!");
      setShowCreateModal(false);
      setNotes("");
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoringBackup) return;
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/backups/restore`,
        { backupId: restoringBackup.id }
      );
      toast("ok", res.message || "Snapshot restored successfully!");
      setRestoringBackup(null);
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteBackup = async (backupId: string) => {
    setBusy(true);
    try {
      await api.del(`/wp/${encodeURIComponent(siteName)}/backups/${encodeURIComponent(backupId)}`);
      toast("ok", "Backup deleted");
      await loadData();
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
        Loading WordPress backups and snapshot history...
      </div>
    );
  }

  return (
    <div className="space-y-4 pt-1">
      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
        <div>
          <h4 className="text-sm font-semibold text-[var(--axon-text)]">WordPress Snapshots & Restore Points</h4>
          <p className="text-xs text-[var(--axon-muted)]">
            Instant database dumps and configuration state backups before hardening or optimization routines.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          + Create WordPress Snapshot
        </Button>
      </div>

      {backups.length === 0 ? (
        <EmptyState message="No snapshots recorded yet. Create one or run a hardening/optimization profile." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-card-hover)] text-[10px] uppercase tracking-wider text-[var(--axon-muted)]">
                <th className="p-3">Snapshot ID</th>
                <th className="p-3">Type</th>
                <th className="p-3">Contents</th>
                <th className="p-3">Size</th>
                <th className="p-3">Created</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {backups.map((b) => (
                <tr key={b.id} className="hover:bg-[var(--axon-card-hover)] transition">
                  <td className="p-3 font-mono text-[var(--axon-text)] font-semibold">{b.id}</td>
                  <td className="p-3">
                    <Badge
                      tone={
                        b.backupType.includes("security")
                          ? "info"
                          : b.backupType.includes("opt")
                            ? "ok"
                            : "neutral"
                      }
                    >
                      {b.backupType.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                  </td>
                  <td className="p-3 text-[var(--axon-muted)]">
                    <span className="text-[var(--axon-text)]">{b.notes || b.filesIncluded}</span>
                  </td>
                  <td className="p-3 font-mono text-[var(--axon-muted)]">{b.sizeMb} MB</td>
                  <td className="p-3 font-mono text-[var(--axon-muted)]">{b.createdAt}</td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="primary"
                        loading={busy}
                        onClick={() => setRestoringBackup(b)}
                        className="text-[11px] py-1 px-2"
                      >
                        ↺ Restore
                      </Button>
                      <Button
                        variant="danger"
                        loading={busy}
                        onClick={() => handleDeleteBackup(b.id)}
                        className="text-[11px] py-1 px-2"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <Modal
          open={showCreateModal}
          title="Create WordPress Snapshot"
          onClose={() => setShowCreateModal(false)}
          width="max-w-md"
        >
          <div className="space-y-3 text-xs">
            <div>
              <label className="text-xs font-medium text-[var(--axon-text)]">Snapshot Description / Notes</label>
              <input
                type="text"
                className="field mt-1"
                placeholder="e.g. Pre-plugin update snapshot"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <p className="text-[11px] text-[var(--axon-muted)]">
              This will create a complete database dump via mysqldump and archive wp-config.php and Nginx vhost config
              into <span className="mono">/var/backups/axon-panel/wp/</span>.
            </p>

            <footer className="flex justify-end gap-2 pt-3 border-t border-[var(--axon-border)]">
              <Button onClick={() => setShowCreateModal(false)}>Cancel</Button>
              <Button variant="primary" loading={busy} onClick={handleCreateBackup}>
                Create Snapshot
              </Button>
            </footer>
          </div>
        </Modal>
      )}

      {/* Restore Dialog */}
      <ConfirmDialog
        open={Boolean(restoringBackup)}
        title={`Restore Snapshot ${restoringBackup?.id}?`}
        message="This will overwrite the current database and restore wp-config.php and Nginx configuration from this snapshot."
        confirmLabel="Restore Snapshot Now"
        busy={busy}
        onCancel={() => setRestoringBackup(null)}
        onConfirm={handleRestoreBackup}
      />
    </div>
  );
}
