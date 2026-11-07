import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, existsSync } from "node:fs";
import path from "node:path";

function resolveConfigDir() {
  if (process.env.AXONPANEL_CONFIG_DIR) return process.env.AXONPANEL_CONFIG_DIR;
  if (process.env.WEBPANEL_CONFIG_DIR) return process.env.WEBPANEL_CONFIG_DIR;
  for (const dir of ["/etc/axon-panel", "/etc/axonpanel", "/etc/webpanel"]) {
    if (existsSync(dir)) return dir;
  }
  if (process.getuid && process.getuid() !== 0) {
    return path.join(process.env.HOME || "/tmp", ".axon-panel");
  }
  return "/etc/axon-panel";
}

function resolveLogDir() {
  if (process.env.AXONPANEL_LOG_DIR) return process.env.AXONPANEL_LOG_DIR;
  if (process.env.WEBPANEL_LOG_DIR) return process.env.WEBPANEL_LOG_DIR;
  for (const dir of ["/var/log/axon-panel", "/var/log/axonpanel", "/var/log/webpanel"]) {
    if (existsSync(dir)) return dir;
  }
  if (process.getuid && process.getuid() !== 0) {
    return path.join(resolveConfigDir(), "logs");
  }
  return "/var/log/axon-panel";
}

export const CONFIG_DIR = resolveConfigDir();
export const CONFIG_PATH = `${CONFIG_DIR}/config.json`;
export const LOG_DIR = resolveLogDir();

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

function defaults() {
  return {
    host: "127.0.0.1",
    port: Number(process.env.PORT || process.env.AXONPANEL_PORT || process.env.WEBPANEL_PORT || 9090),
    panelDomain: process.env.PANEL_DOMAIN || process.env.AXONPANEL_DOMAIN || "localhost",
    adminUser: "admin",
    passwordHash: "",
    jwtSecret: randomSecret(48),
    totpSecret: null,
    totpEnabled: false,
    sessionHours: 12,
    ipAllowlist: [],
    allowedRoots: ["/var/www", "/etc/nginx", "/etc/letsencrypt", "/root", "/var/log", "/etc/postgresql", "/etc/php", "/opt/axon-panel", "/opt/axonpanel"],
    backupDir: "/var/backups/axon-panel",
    letsencryptEmail: process.env.LETSENCRYPT_EMAIL || "admin@localhost",
    phpFpmSocket: "/var/run/php/php8.3-fpm.sock",
    maxUploadMb: 512,
    commandTimeoutMs: 120000,
  };
}

let cached = null;

export function ensureConfigDir() {
  for (const dir of [CONFIG_DIR, LOG_DIR]) {
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch {
      /* ignore if unprivileged or read-only system dir */
    }
  }
}

export function loadConfig({ force = false } = {}) {
  if (cached && !force) return cached;
  ensureConfigDir();
  if (!existsSync(CONFIG_PATH)) {
    try {
      return writeConfig(defaults());
    } catch {
      cached = defaults();
      return cached;
    }
  }
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    cached = { ...defaults(), ...parsed };
    return cached;
  } catch {
    cached = defaults();
    return cached;
  }
}

export function writeConfig(cfg) {
  ensureConfigDir();
  const tmp = `${CONFIG_PATH}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, CONFIG_PATH);
  } catch {
    /* fallback to in-memory config if filesystem path is unwritable */
  }
  cached = cfg;
  return cfg;
}

export function saveConfig(patch) {
  return writeConfig({ ...loadConfig({ force: true }), ...patch });
}

export function publicConfig() {
  const c = loadConfig();
  return {
    panelDomain: c.panelDomain,
    adminUser: c.adminUser,
    sessionHours: c.sessionHours,
    ipAllowlist: c.ipAllowlist,
    allowedRoots: c.allowedRoots,
    backupDir: c.backupDir,
    letsencryptEmail: c.letsencryptEmail,
    phpFpmSocket: c.phpFpmSocket,
    port: c.port,
    totpEnabled: !!c.totpEnabled,
    maxUploadMb: c.maxUploadMb,
  };
}
