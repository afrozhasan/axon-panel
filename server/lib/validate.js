import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const IDENT_RE = /^[A-Za-z0-9_$]{1,64}$/;
const UNIT_RE = /^[A-Za-z0-9@._-]+\.(service|timer|socket|target|mount|path)$/;
const PM2_RE = /^[A-Za-z0-9._-]{1,64}$/;
const SITE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CERT_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const LOG_SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9._/:-]{0,199}$/;

export const PROTECTED_UNITS = new Set([
  "ssh.service",
  "sshd.service",
  "dbus.service",
  "dbus.socket",
  "systemd-journald.service",
  "systemd-logind.service",
  "systemd-networkd.service",
  "systemd-resolved.service",
  "systemd-udevd.service",
  "networking.service",
  "axon-panel.service",
  "axonpanel.service",
  "webpanel.service",
  "pm2-root.service",
  "polkit.service",
  "user@0.service",
]);

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

function fail(message) {
  throw new ValidationError(message);
}

export function assertDomain(value, { allowWildcard = false } = {}) {
  if (typeof value !== "string") fail("Domain must be a string");
  const v = value.trim().toLowerCase();
  if (allowWildcard && v.startsWith("*.")) {
    const rest = v.slice(2);
    assertDomain(rest, { allowWildcard: false });
    return v;
  }
  if (v.length > 253) fail("Domain is too long");
  if (v.startsWith("-") || v.endsWith("-")) fail("Domain may not start or end with a hyphen");
  if (!DOMAIN_RE.test(v)) fail(`Invalid domain name: ${value}`);
  if (v.includes("..")) fail("Invalid domain name");
  return v;
}

export function assertIdent(value, label = "identifier") {
  if (typeof value !== "string" || !IDENT_RE.test(value)) {
    fail(`Invalid ${label}: only letters, digits, underscore and $ are allowed (max 64 chars)`);
  }
  return value;
}

export function assertDatabaseName(value) {
  return assertIdent(value, "database name");
}

export function assertDbUser(value) {
  return assertIdent(value, "database user");
}

const DB_HOST_RE = /^[A-Za-z0-9_.%:-]{1,255}$/;

export function assertDbHost(value) {
  const host = value === undefined || value === null || value === "" ? "localhost" : String(value);
  if (!DB_HOST_RE.test(host)) fail(`Invalid database host: ${value}`);
  return host;
}

const BACKUP_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

export function assertBackupFile(value) {
  if (typeof value !== "string" || !BACKUP_FILE_RE.test(value)) fail(`Invalid backup file name: ${value}`);
  if (value.includes("..")) fail("Invalid backup file name");
  return value;
}

const SENSITIVE_PATTERNS = [
  /(^|\/)\.ssh(\/|$)/,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.|$)/,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)\.gnupg(\/|$)/,
  /(^|\/)shadow$/,
];

export function assertNotSensitive(target) {
  const normalized = path.resolve(target);
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      fail("This file holds private key material and cannot be read or modified from the panel");
    }
  }
  return target;
}

export function assertUnit(value) {
  if (typeof value !== "string" || !UNIT_RE.test(value)) fail(`Invalid systemd unit: ${value}`);
  if (PROTECTED_UNITS.has(value)) fail(`Unit ${value} is protected and cannot be controlled from the panel`);
  if (value.startsWith("systemd-")) fail("systemd internal units are protected");
  return value;
}

export function assertPm2Name(value) {
  if (typeof value !== "string" || !PM2_RE.test(value)) fail(`Invalid PM2 process name: ${value}`);
  return value;
}

export function assertSiteName(value) {
  if (typeof value !== "string" || !SITE_NAME_RE.test(value)) fail(`Invalid site name: ${value}`);
  if (value.includes("..")) fail("Invalid site name");
  return value;
}

export function assertCertName(value) {
  if (typeof value !== "string" || !CERT_NAME_RE.test(value)) fail(`Invalid certificate name: ${value}`);
  return value;
}

export function assertPort(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) fail(`Invalid port: ${value}`);
  return n;
}

export function assertEnum(value, allowed, label = "value") {
  if (!allowed.includes(value)) fail(`Invalid ${label}: expected one of ${allowed.join(", ")}`);
  return value;
}

export function assertEmail(value) {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    fail(`Invalid email address: ${value}`);
  }
  return value;
}

export function assertLogSource(value) {
  if (typeof value !== "string" || !LOG_SOURCE_RE.test(value)) fail(`Invalid log source: ${value}`);
  if (value.includes("..")) fail("Invalid log source");
  return value;
}

export function assertSql(value) {
  if (typeof value !== "string") fail("SQL must be a string");
  if (value.length > 512 * 1024) fail("SQL statement is too large");
  if (value.includes("\0")) fail("SQL may not contain null bytes");
  return value;
}

export function assertShellFree(value, label = "value") {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (value.includes("\0")) fail(`${label} may not contain null bytes`);
  if (value.startsWith("-")) fail(`${label} may not start with a hyphen`);
  return value;
}

export function assertNoNewlines(value, label = "value") {
  if (typeof value !== "string") fail(`${label} must be a string`);
  if (/[\r\n]/.test(value)) fail(`${label} may not contain newlines`);
  return value;
}

function nearestExistingAncestor(target) {
  let current = target;
  const suffix = [];
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  return { existing: current, suffix };
}

export function resolveSafePath(input, roots) {
  if (typeof input !== "string" || input.length === 0) fail("Path is required");
  if (input.includes("\0")) fail("Path may not contain null bytes");
  if (!path.isAbsolute(input)) fail("Path must be absolute");

  const normalized = path.resolve(input);
  const { existing, suffix } = nearestExistingAncestor(normalized);

  let resolvedAncestor = existing;
  try {
    resolvedAncestor = realpathSync(existing);
  } catch {
    resolvedAncestor = existing;
  }

  const resolved = suffix.length ? path.join(resolvedAncestor, ...suffix) : resolvedAncestor;

  const permitted = roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${path.sep}`);
  });

  if (!permitted) fail(`Path is outside the permitted directories: ${input}`);
  return normalized;
}

export function isProtectedUnit(unit) {
  return PROTECTED_UNITS.has(unit) || unit.startsWith("systemd-");
}

export const is = {
  domain: (v) => typeof v === "string" && DOMAIN_RE.test(v.trim().toLowerCase()),
  ident: (v) => typeof v === "string" && IDENT_RE.test(v),
  unit: (v) => typeof v === "string" && UNIT_RE.test(v),
};
