import { WebSocketServer } from "ws";
import { spawnAllowed } from "./exec.js";
import { COOKIE_NAME, verifySession } from "../middleware/auth.js";
import { audit } from "./audit.js";
import { hasPermission } from "./rbac.js";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_SESSION_MS = 8 * 60 * 60 * 1000;

let ptyModule = null;
try {
  ptyModule = await import("node-pty");
} catch {
  ptyModule = null;
}

export const terminalBackend = ptyModule ? "node-pty" : "script";

function parseCookieHeader(header) {
  const cookies = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

function createSession(cols, rows) {
  if (ptyModule) {
    const proc = ptyModule.spawn("/bin/bash", ["-l"], {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: "/root",
      env: { ...process.env, TERM: "xterm-256color" },
    });
    return {
      backend: "node-pty",
      onData: (handler) => proc.onData(handler),
      write: (data) => proc.write(data),
      resize: (c, r) => {
        try {
          proc.resize(c, r);
        } catch {
          /* resize can fail during teardown */
        }
      },
      kill: () => proc.kill(),
    };
  }

  const child = spawnAllowed("script", ["-qfc", "/bin/bash -l", "/dev/null"], { cwd: "/root" });
  return {
    backend: "script",
    onData: (handler) => {
      child.stdout.on("data", (chunk) => handler(chunk.toString("utf8")));
      child.stderr.on("data", (chunk) => handler(chunk.toString("utf8")));
    },
    write: (data) => child.stdin.write(data),
    resize: () => {},
    kill: () => child.kill("SIGKILL"),
  };
}

export function attachTerminal(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch {
      socket.destroy();
      return;
    }

    if (pathname !== "/api/terminal") {
      socket.destroy();
      return;
    }

    const cookies = parseCookieHeader(request.headers.cookie);
    const token = cookies[COOKIE_NAME];
    const actor = token ? verifySession(token) : null;
    if (!actor) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!hasPermission(actor.role, "server:terminal_access")) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, actor);
    });
  });

  wss.on("connection", (ws, _request, actor) => {
    let session = null;
    let idleTimer = null;
    let maxTimer = null;
    let closed = false;

    const send = (payload) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
    };

    const teardown = (reason) => {
      if (closed) return;
      closed = true;
      clearTimeout(idleTimer);
      clearTimeout(maxTimer);
      try {
        session?.kill();
      } catch {
        /* already gone */
      }
      if (ws.readyState === ws.OPEN) ws.close(1000, reason);
      audit({ action: "terminal.session.end", actor: actor.username, result: "ok", detail: reason });
    };

    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => teardown("idle timeout"), IDLE_TIMEOUT_MS);
    };

    try {
      session = createSession(80, 24);
    } catch (error) {
      send({ type: "error", message: `Could not start a shell: ${error.message}` });
      ws.close();
      return;
    }

    audit({ action: "terminal.session.start", actor: actor.username, detail: session.backend });
    send({ type: "ready", backend: session.backend });

    session.onData((data) => {
      resetIdle();
      send({ type: "output", data });
    });

    maxTimer = setTimeout(() => teardown("maximum session duration reached"), MAX_SESSION_MS);
    resetIdle();

    ws.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }

      resetIdle();

      if (message.type === "input" && typeof message.data === "string") {
        session.write(message.data);
        return;
      }
      if (message.type === "resize") {
        const cols = Math.min(Math.max(Number(message.cols) || 80, 20), 500);
        const rows = Math.min(Math.max(Number(message.rows) || 24, 5), 200);
        session.resize(cols, rows);
        return;
      }
      if (message.type === "close") teardown("closed by user");
    });

    ws.on("close", () => teardown("connection closed"));
    ws.on("error", () => teardown("socket error"));
  });

  return wss;
}
