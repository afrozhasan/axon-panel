import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Badge, Button, Card, ErrorBanner } from "../components/ui";

export default function Terminal() {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState<"connecting" | "open" | "closed">("connecting");
  const [backend, setBackend] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12.5,
      theme: {
        background: "#080b12",
        foreground: "#e6edf3",
        cursor: "#6366f1",
        selectionBackground: "#2a3446",
        black: "#0d1117",
        brightBlack: "#7d8da6",
      },
      scrollback: 5000,
      convertEol: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(hostRef.current);
    fit.fit();

    termRef.current = terminal;
    fitRef.current = fit;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/terminal`);
    socketRef.current = socket;

    socket.onopen = () => {
      setStatus("open");
      setError(null);
      socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
    };

    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "output") terminal.write(message.data);
        else if (message.type === "ready") setBackend(message.backend);
        else if (message.type === "error") setError(message.message);
      } catch {
        /* ignore malformed frames */
      }
    };

    socket.onclose = () => setStatus("closed");
    socket.onerror = () => {
      setStatus("closed");
      setError("Terminal connection failed. Reload the page to try again.");
    };

    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "input", data }));
    });

    const handleResize = () => {
      try {
        fit.fit();
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
        }
      } catch {
        /* container may be hidden */
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(hostRef.current);
    window.addEventListener("resize", handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", handleResize);
      disposable.dispose();
      socket.close();
      terminal.dispose();
    };
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Terminal</h1>
          <p className="text-xs text-slate-500">
            A root shell on this server. Every session is logged; idle sessions close after 30 minutes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {backend && <Badge tone="neutral">pty: {backend}</Badge>}
          <Badge tone={status === "open" ? "ok" : status === "connecting" ? "warn" : "bad"}>{status}</Badge>
          <Button
            onClick={() => {
              socketRef.current?.send(JSON.stringify({ type: "close" }));
            }}
            disabled={status !== "open"}
          >
            End session
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card bodyClassName="p-2">
        <div ref={hostRef} className="h-[68vh] w-full overflow-hidden rounded-md bg-[var(--axon-input-bg)]" />
      </Card>
    </div>
  );
}
