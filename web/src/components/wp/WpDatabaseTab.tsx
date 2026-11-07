import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, ErrorBanner, Spinner, useToast } from "../ui";

type DbInfo = {
  databaseName: string;
  tablePrefix: string;
  totalTables: number;
  totalDataSizeMb: string;
  totalIndexSizeMb: string;
  totalSizeMb: string;
  totalOverheadMb: string;
  tables: Array<{
    name: string;
    engine: string;
    rows: number;
    dataSizeMb: string;
    indexSizeMb: string;
    totalSizeMb: string;
    overheadMb: string;
  }>;
};

export default function WpDatabaseTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [data, setData] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const toast = useToast();

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<DbInfo>(`/wp/${encodeURIComponent(siteName)}/database/tables`);
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

  const handleOptimizeAll = async (tableName?: string) => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/database/optimize`,
        { tableName }
      );
      toast("ok", res.message || "Database tables optimized");
      await loadData();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRepairAll = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(
        `/wp/${encodeURIComponent(siteName)}/database/repair`,
        {}
      );
      toast("ok", res.message || "Database tables repair completed");
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
        Inspecting WordPress database tables and storage engine status...
      </div>
    );
  }

  const filteredTables = (data?.tables || []).filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4 pt-1">
      <ErrorBanner message={error} />

      {/* Summary Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Database Name</p>
          <p className="mt-1 font-mono text-sm font-semibold text-[var(--axon-text)] truncate">{data?.databaseName}</p>
          <p className="text-[11px] text-[var(--axon-muted)]">Prefix: {data?.tablePrefix}</p>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Total Tables</p>
          <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">{data?.totalTables} tables</p>
          <p className="text-[11px] text-[var(--axon-muted)]">InnoDB engine</p>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Total Storage</p>
          <p className="mt-1 text-sm font-semibold text-[var(--axon-text)]">{data?.totalSizeMb} MB</p>
          <p className="text-[11px] text-[var(--axon-muted)]">
            {data?.totalDataSizeMb} MB data / {data?.totalIndexSizeMb} MB indexes
          </p>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-3">
          <p className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Fragmentation Overhead</p>
          <p className="mt-1 text-sm font-semibold text-[var(--axon-primary)]">{data?.totalOverheadMb} MB</p>
          <p className="text-[11px] text-[var(--axon-muted)]">Freeable via OPTIMIZE</p>
        </div>
      </div>

      {/* Action Header & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
        <input
          type="text"
          className="field max-w-xs text-xs"
          placeholder="Filter tables by name..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="flex items-center gap-2">
          <Button variant="ghost" loading={busy} onClick={() => handleRepairAll()}>
            🛠 Repair Tables
          </Button>
          <Button variant="primary" loading={busy} onClick={() => handleOptimizeAll()}>
            ⚡ Optimize All Tables
          </Button>
        </div>
      </div>

      {/* Tables Table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)]">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-card-hover)] text-[10px] uppercase tracking-wider text-[var(--axon-muted)]">
              <th className="p-3">Table Name</th>
              <th className="p-3">Engine</th>
              <th className="p-3">Rows</th>
              <th className="p-3">Data Size</th>
              <th className="p-3">Index Size</th>
              <th className="p-3">Total Size</th>
              <th className="p-3">Overhead</th>
              <th className="p-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--axon-border)]">
            {filteredTables.map((t) => (
              <tr key={t.name} className="hover:bg-[var(--axon-card-hover)] transition">
                <td className="p-3 font-mono font-medium text-[var(--axon-text)]">{t.name}</td>
                <td className="p-3 text-[var(--axon-muted)]">{t.engine}</td>
                <td className="p-3 font-mono text-[var(--axon-text)]">{t.rows.toLocaleString()}</td>
                <td className="p-3 font-mono text-[var(--axon-muted)]">{t.dataSizeMb} MB</td>
                <td className="p-3 font-mono text-[var(--axon-muted)]">{t.indexSizeMb} MB</td>
                <td className="p-3 font-mono font-semibold text-[var(--axon-text)]">{t.totalSizeMb} MB</td>
                <td className="p-3 font-mono text-emerald-400">{t.overheadMb} MB</td>
                <td className="p-3 text-right">
                  <Button
                    variant="ghost"
                    loading={busy}
                    onClick={() => handleOptimizeAll(t.name)}
                    className="text-[11px] py-1 px-2"
                  >
                    Optimize
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
