import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button, ErrorBanner, Spinner } from "../ui";

export default function WpLogsTab({ siteName, docroot }: { siteName: string; docroot: string }) {
  const [source, setSource] = useState<"debug" | "nginx-access" | "nginx-error">("debug");
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ lines: string[] }>(`/wp/${encodeURIComponent(siteName)}/logs?source=${source}`);
      setLines(res.lines || []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [siteName, source]);

  const filteredLines = lines.filter((l) => l.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4 pt-1">
      <ErrorBanner message={error} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
        <div className="flex rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card-hover)] p-0.5 text-xs">
          <button
            onClick={() => setSource("debug")}
            className={`rounded px-3 py-1 font-medium transition ${
              source === "debug" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
            }`}
          >
            WP debug.log
          </button>
          <button
            onClick={() => setSource("nginx-access")}
            className={`rounded px-3 py-1 font-medium transition ${
              source === "nginx-access" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
            }`}
          >
            Nginx Access
          </button>
          <button
            onClick={() => setSource("nginx-error")}
            className={`rounded px-3 py-1 font-medium transition ${
              source === "nginx-error" ? "bg-[var(--axon-primary)] text-slate-900 font-semibold" : "text-[var(--axon-muted)] hover:text-white"
            }`}
          >
            Nginx Error
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            className="field max-w-xs text-xs"
            placeholder="Search logs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <Button variant="ghost" className="text-xs py-1" onClick={loadLogs}>
            ↻ Refresh
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-[#0d1117] p-4 font-mono text-xs text-slate-300 max-h-[500px] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-8 text-slate-500">
            <Spinner className="h-4 w-4 mr-2" /> Loading log stream...
          </div>
        ) : filteredLines.length === 0 ? (
          <p className="text-slate-500 italic">No log entries found for this source.</p>
        ) : (
          <div className="space-y-1">
            {filteredLines.map((line, idx) => (
              <div key={idx} className="whitespace-pre-wrap break-all hover:bg-white/5 py-0.5 px-1 rounded">
                <span className="text-slate-500 mr-2 select-none">{idx + 1}</span>
                <span
                  className={
                    line.includes("Fatal") || line.includes("error") || line.includes("CRITICAL")
                      ? "text-rose-400"
                      : line.includes("Warning") || line.includes("warn")
                        ? "text-amber-400"
                        : "text-slate-300"
                  }
                >
                  {line}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
