import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { Badge, Button, Card, ErrorBanner, Spinner, useToast } from "../components/ui";

type Source = { id: string; label: string; group: string; type: "file" | "journal"; path: string | null };

const MAX_LINES = 5000;

export default function Logs({ defaultGroup = "all" }: { defaultGroup?: "all" | "nginx" | "system" }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [source, setSource] = useState("");
  const [lines, setLines] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const paneRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  useEffect(() => {
    api
      .get<{ sources: Source[] }>("/logs/sources")
      .then((result) => {
        setSources(result.sources);
        const preferred =
          defaultGroup === "nginx"
            ? result.sources.find((item) => item.id.includes("nginx"))
            : result.sources.find((item) => item.id.includes("nginx/error")) ?? result.sources[0];
        if (preferred) setSource(preferred.id);
      })
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  }, [defaultGroup]);

  useEffect(() => {
    if (!source) return;
    setLines([]);
    setError(null);

    if (!live) {
      api
        .get<{ lines: string[] }>(`/logs/snapshot?source=${encodeURIComponent(source)}&lines=500`)
        .then((result) => setLines(result.lines))
        .catch((caught) => setError(errorMessage(caught)));
      return;
    }

    const stream = new EventSource(`/api/logs/stream?source=${encodeURIComponent(source)}&lines=500`);
    stream.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === "line") {
          setLines((current) => {
            const next = [...current, payload.line];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        } else if (payload.type === "error") {
          setError(payload.message);
        } else if (payload.type === "status" && payload.message) {
          setError(null);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    stream.onerror = () => setError("Log stream disconnected. Switch live off and on again to reconnect.");

    return () => stream.close();
  }, [source, live]);

  useEffect(() => {
    if (!follow || !paneRef.current) return;
    paneRef.current.scrollTop = paneRef.current.scrollHeight;
  }, [lines, follow]);

  const grouped = useMemo(() => {
    const groups = new Map<string, Source[]>();
    for (const item of sources) {
      const list = groups.get(item.group) ?? [];
      list.push(item);
      groups.set(item.group, list);
    }
    return [...groups.entries()];
  }, [sources]);

  const visible = useMemo(() => {
    if (!filter.trim()) return lines;
    const needle = filter.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, filter]);

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading log sources…
      </div>
    );
  }

  const current = sources.find((item) => item.id === source);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Logs</h1>
          <p className="text-xs text-slate-500">
            {visible.length} of {lines.length} lines buffered
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} />
            Live tail
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
            Follow
          </label>
          <Button onClick={() => setLines([])}>Clear view</Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card bodyClassName="p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-300">Source</span>
            <select className="field mono" value={source} onChange={(event) => setSource(event.target.value)}>
              {grouped.map(([group, items]) => (
                <optgroup key={group} label={group}>
                  {items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-300">Filter</span>
            <input
              className="field"
              placeholder="Search within the buffer…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2 pb-1">
            <Badge tone={live ? "ok" : "neutral"}>{live ? "streaming" : "snapshot"}</Badge>
            {current?.path && <span className="mono text-[11px] text-slate-500">{current.path}</span>}
          </div>
        </div>
      </Card>

      <Card bodyClassName="p-0">
        <div ref={paneRef} className="mono max-h-[62vh] min-h-[45vh] overflow-auto bg-[var(--axon-input-bg)] p-3 text-[11px] leading-relaxed">
          {visible.length === 0 ? (
            <p className="text-slate-600">{lines.length === 0 ? "Waiting for log output…" : "No lines match the filter"}</p>
          ) : (
            visible.map((line, index) => (
              <div
                key={index}
                className={`whitespace-pre-wrap break-all ${
                  /error|crit|emerg|alert|fail/i.test(line)
                    ? "text-rose-300"
                    : /warn/i.test(line)
                      ? "text-amber-200"
                      : "text-slate-300"
                }`}
              >
                {line}
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
