import { createServer } from "node:net";
import { getDb } from "./db.js";

const PORT_POOL_START = 3000;
const PORT_POOL_END = 3999;

export function isPortFreeLocally(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

export async function allocatePort(preferredPort = null) {
  const db = getDb();
  const takenRows = db.prepare("SELECT assigned_port FROM websites WHERE assigned_port IS NOT NULL").all();
  const dbTaken = new Set(takenRows.map((r) => r.assigned_port));

  // If preferred port is free in DB and locally, use it
  if (preferredPort && preferredPort >= 1024 && preferredPort <= 65535) {
    if (!dbTaken.has(preferredPort) && (await isPortFreeLocally(preferredPort))) {
      return preferredPort;
    }
  }

  // Scan pool
  for (let port = PORT_POOL_START; port <= PORT_POOL_END; port += 1) {
    if (!dbTaken.has(port) && (await isPortFreeLocally(port))) {
      return port;
    }
  }

  throw new Error(`No free application ports available in pool (${PORT_POOL_START}-${PORT_POOL_END})`);
}
