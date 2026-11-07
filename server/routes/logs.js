import { Router } from "express";
import { readdirSync, existsSync, statSync, openSync, readSync, closeSync, watchFile, unwatchFile } from "node:fs";
import path from "node:path";
import { spawnAllowed } from "../lib/exec.js";
import { resolveSafePath, assertLogSource } from "../lib/validate.js";
import { loadConfig } from "../config.js";

const router = Router();

const JOURNAL_UNITS = [
  { id: "journal:nginx", label: "nginx", unit: "nginx.service" },
  { id: "journal:mariadb", label: "MariaDB", unit: "mariadb.service" },
  { id: "journal:postgresql", label: "PostgreSQL", unit: "postgresql.service" },
  { id: "journal:php", label: "PHP-FPM", unit: "php8.3-fpm.service" },
  { id: "journal:axon-panel", label: "Axon Panel", unit: "axon-panel.service" },
  { id: "journal:fail2ban", label: "Fail2ban", unit: "fail2ban.service" },
  { id: "journal:ssh", label: "SSH", unit: "ssh.service" },
  { id: "journal:system", label: "Full system journal", unit: null },
];

function directoryFiles(directory, group, prefix, exclude = []) {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".log") && !exclude.includes(name))
      .slice(0, 40)
      .map((name) => ({
        id: `${prefix}${name}`,
        label: name,
        file: path.join(directory, name),
        group,
      }));
  } catch {
    return [];
  }
}

function internalSources() {
  const files = [
    ...directoryFiles("/var/log/nginx", "nginx", "file:nginx/"),
    ...directoryFiles("/var/log/postgresql", "databases", "file:pg/"),
    ...directoryFiles("/root/.pm2/logs", "pm2", "file:pm2/"),
    ...directoryFiles("/var/log", "system", "file:log/"),
  ]
    .filter((entry) => existsSync(entry.file))
    .map((entry) => ({ ...entry, type: "file" }));

  const journal = JOURNAL_UNITS.map((entry) => ({ ...entry, type: "journal" }));

  return [...files, ...journal];
}

export function listSources() {
  return internalSources().map(({ file, unit, ...entry }) => ({
    ...entry,
    path: entry.type === "file" ? file : null,
  }));
}

function resolveSource(rawSource) {
  const source = assertLogSource(String(rawSource || ""));
  const known = internalSources().find((entry) => entry.id === source);
  if (known) return known;

  if (source.startsWith("file:")) {
    const candidate = source.slice(5);
    const allowedRoots = loadConfig().allowedRoots;
    const target = resolveSafePath(path.isAbsolute(candidate) ? candidate : path.join("/var/log", candidate), allowedRoots);
    return { id: source, label: path.basename(target), type: "file", file: target, group: "custom" };
  }

  if (source.startsWith("journal:")) {
    const unit = JOURNAL_UNITS.find((entry) => entry.id === source);
    return { id: source, label: unit?.label ?? source, type: "journal", unit: unit?.unit ?? null, group: "journal" };
  }

  const error = new Error(`Unknown log source: ${source}`);
  error.status = 404;
  throw error;
}

function tailFile(file, maxLines) {
  const info = statSync(file);
  const size = info.size;
  const readSize = Math.min(size, Math.max(64 * 1024, maxLines * 512));
  if (readSize === 0) return [];

  const buffer = Buffer.alloc(readSize);
  const fd = openSync(file, "r");
  try {
    readSync(fd, buffer, 0, readSize, size - readSize);
  } finally {
    closeSync(fd);
  }

  let text = buffer.toString("utf8");
  if (readSize < size) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) text = text.slice(firstNewline + 1);
  }
  return text.split("\n").filter((line, index, all) => line !== "" || index < all.length - 1);
}

router.get("/sources", (_req, res, next) => {
  try {
    res.json({ sources: listSources() });
  } catch (error) {
    next(error);
  }
});

router.get("/snapshot", (req, res, next) => {
  try {
    const source = resolveSource(req.query.source);
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 5000);

    if (source.type === "file") {
      if (!existsSync(source.file)) return res.status(404).json({ error: "Log file not found" });
      return res.json({ source: source.id, label: source.label, lines: tailFile(source.file, lines) });
    }

    return res.json({ source: source.id, label: source.label, lines: [], journal: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/stream", (req, res, next) => {
  let source;
  try {
    source = resolveSource(req.query.source);
  } catch (error) {
    return next(error);
  }

  const initialLines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 2000);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (type, payload) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
  };

  send("status", { message: `Tailing ${source.label}` });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": keepalive\n\n");
  }, 20000);

  let child = null;
  let watching = null;
  let lastSize = 0;

  const cleanup = () => {
    clearInterval(heartbeat);
    if (child) {
      child.kill("SIGTERM");
      child = null;
    }
    if (watching) {
      unwatchFile(watching, onFileChange);
      watching = null;
    }
  };

  const onFileChange = (current) => {
    if (!watching || res.writableEnded) return;
    if (current.size < lastSize) {
      lastSize = 0;
    }
    if (current.size === lastSize) return;

    const start = lastSize;
    lastSize = current.size;
    const length = current.size - start;
    if (length <= 0 || length > 1024 * 1024) return;

    try {
      const buffer = Buffer.alloc(length);
      const fd = openSync(watching, "r");
      try {
        readSync(fd, buffer, 0, length, start);
      } finally {
        closeSync(fd);
      }
      for (const line of buffer.toString("utf8").split("\n")) {
        if (line.trim() !== "") send("line", { line });
      }
    } catch {
      /* file may have rotated mid-read */
    }
  };

  if (source.type === "file") {
    if (!existsSync(source.file)) {
      send("error", { message: "Log file not found" });
      clearInterval(heartbeat);
      return res.end();
    }
    for (const line of tailFile(source.file, initialLines)) send("line", { line });
    lastSize = statSync(source.file).size;
    watching = source.file;
    watchFile(source.file, { interval: 1000, persistent: false }, onFileChange);
  } else {
    const args = ["-f", "-n", String(initialLines), "--no-pager", "-o", "short-iso"];
    if (source.unit) args.push("-u", source.unit);
    child = spawnAllowed("journalctl", args);
    child.stdout.on("data", (chunk) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() !== "") send("line", { line });
      }
    });
    child.stderr.on("data", (chunk) => send("status", { message: chunk.toString().trim() }));
    child.on("error", (error) => send("error", { message: error.message }));
    child.on("close", () => {
      send("status", { message: "Stream ended" });
      cleanup();
      if (!res.writableEnded) res.end();
    });
  }

  req.on("close", cleanup);
  return undefined;
});

export default router;
