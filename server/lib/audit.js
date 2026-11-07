import { appendFileSync, readFileSync, existsSync } from "node:fs";
import { LOG_DIR, ensureConfigDir } from "../config.js";

const AUDIT_PATH = `${LOG_DIR}/audit.jsonl`;
const MAX_MEMORY_ENTRIES = 500;
const memory = [];

ensureConfigDir();

export function audit({ action, actor = "system", ip = null, params = {}, result = "ok", detail = null }) {
  const entry = {
    at: new Date().toISOString(),
    actor,
    ip,
    action,
    result,
    params: redact(params),
    detail: detail ? String(detail).slice(0, 4000) : null,
  };

  memory.push(entry);
  if (memory.length > MAX_MEMORY_ENTRIES) memory.splice(0, memory.length - MAX_MEMORY_ENTRIES);

  try {
    appendFileSync(AUDIT_PATH, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  } catch {
    // auditing must never break the request path
  }

  return entry;
}

const SECRET_KEYS = /password|secret|token|hash|key/i;

function redact(params) {
  if (!params || typeof params !== "object") return params;
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (SECRET_KEYS.test(key)) {
      out[key] = "[redacted]";
    } else if (typeof value === "string" && value.length > 500) {
      out[key] = `${value.slice(0, 500)}…[truncated]`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function readAudit(limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 2000);
  if (!existsSync(AUDIT_PATH)) return memory.slice(-safeLimit);

  try {
    const content = readFileSync(AUDIT_PATH, "utf8");
    if (content.length > 4 * 1024 * 1024) {
      return content
        .slice(-4 * 1024 * 1024)
        .split("\n")
        .filter(Boolean)
        .slice(-safeLimit)
        .map(parseLine)
        .filter(Boolean);
    }
    return content
      .split("\n")
      .filter(Boolean)
      .slice(-safeLimit)
      .map(parseLine)
      .filter(Boolean);
  } catch {
    return memory.slice(-safeLimit);
  }
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
