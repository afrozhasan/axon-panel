import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  unlinkSync,
  mkdirSync,
  chownSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";
import { run } from "./exec.js";
import { assertSiteName } from "./validate.js";

export const NGINX_AVAILABLE = "/etc/nginx/sites-available";
export const NGINX_ENABLED = "/etc/nginx/sites-enabled";
export const NGINX_BACKUP_DIR = "/etc/nginx/panel-backups";

function safeRead(file) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function summarize(content) {
  const serverNames = [...content.matchAll(/server_name\s+([^;]+);/g)]
    .flatMap((m) => m[1].trim().split(/\s+/))
    .filter(Boolean);
  const listens = [...content.matchAll(/listen\s+([^;]+);/g)].map((m) => m[1].trim());
  const roots = [...content.matchAll(/^\s*root\s+([^;]+);/gm)].map((m) => m[1].trim());
  const proxies = [...content.matchAll(/proxy_pass\s+([^;]+);/g)].map((m) => m[1].trim());
  const certificates = [...content.matchAll(/ssl_certificate\s+([^;]+);/g)].map((m) => m[1].trim());
  const fastcgi = [...content.matchAll(/fastcgi_pass\s+([^;]+);/g)].map((m) => m[1].trim());
  const redirects = [...content.matchAll(/return\s+(301|302)\s+([^;]+);/g)].map((m) => m[2].trim());

  let kind = "other";
  if (fastcgi.length > 0) kind = "php";
  else if (proxies.length > 0) kind = "proxy";
  else if (roots.length > 0) kind = "static";
  else if (redirects.length > 0) kind = "redirect";

  const phpVersionMatch = content.match(/php([0-9]+\.[0-9]+)-fpm\.sock/);
  const phpVersion = phpVersionMatch ? phpVersionMatch[1] : null;

  return {
    serverNames: [...new Set(serverNames)],
    listens: [...new Set(listens)],
    roots: [...new Set(roots)],
    proxies: [...new Set(proxies)],
    certificates: [...new Set(certificates)],
    fastcgi: [...new Set(fastcgi)],
    redirects: [...new Set(redirects)],
    serverBlocks: (content.match(/server\s*\{/g) || []).length,
    ssl: certificates.length > 0,
    kind,
    phpVersion,
    bytes: Buffer.byteLength(content),
  };
}

export function listSites() {
  if (!existsSync(NGINX_AVAILABLE)) return [];
  return readdirSync(NGINX_AVAILABLE)
    .filter((name) => !name.startsWith(".") && !name.endsWith(".bak"))
    .map((name) => {
      const availablePath = path.join(NGINX_AVAILABLE, name);
      try {
        if (!lstatSync(availablePath).isFile()) return null;
      } catch {
        return null;
      }

      const enabled = existsSync(path.join(NGINX_ENABLED, name));
      const content = safeRead(availablePath);
      return { name, enabled, ...summarize(content) };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readSite(name) {
  const site = assertSiteName(name);
  const file = path.join(NGINX_AVAILABLE, site);
  if (!existsSync(file)) {
    const error = new Error(`Site not found: ${site}`);
    error.status = 404;
    throw error;
  }
  const content = readFileSync(file, "utf8");
  return { name: site, content, summary: summarize(content) };
}

export async function testConfig() {
  const result = await run("nginx", ["-t"], { timeout: 20000 });
  const output = `${result.stdout}${result.stderr}`.trim();
  return { ok: result.ok, output, error: result.ok ? null : output };
}

export async function reloadNginx() {
  const test = await testConfig();
  if (!test.ok) return { ok: false, error: `Configuration is invalid, not reloading:\n${test.error}` };
  const result = await run("nginx", ["-s", "reload"], { timeout: 20000 });
  return { ok: result.ok, error: result.ok ? null : result.stderr.trim() };
}

export async function writeSiteValidated(name, content) {
  const site = assertSiteName(name);
  const file = path.join(NGINX_AVAILABLE, site);
  const previous = existsSync(file) ? readFileSync(file, "utf8") : null;

  writeFileSync(file, content, { mode: 0o644 });
  const test = await testConfig();

  if (!test.ok) {
    if (previous !== null) writeFileSync(file, previous, { mode: 0o644 });
    else unlinkSync(file);
    return { ok: false, error: test.error };
  }
  return { ok: true, summary: summarize(content) };
}

export function backupSite(name) {
  const site = assertSiteName(name);
  const file = path.join(NGINX_AVAILABLE, site);
  if (!existsSync(file)) return null;
  if (!existsSync(NGINX_BACKUP_DIR)) mkdirSync(NGINX_BACKUP_DIR, { recursive: true, mode: 0o700 });
  const target = path.join(NGINX_BACKUP_DIR, `${site}.${Date.now()}.bak`);
  writeFileSync(target, readFileSync(file), { mode: 0o600 });
  return target;
}

export async function enableSite(name) {
  const site = assertSiteName(name);
  const source = path.join(NGINX_AVAILABLE, site);
  const link = path.join(NGINX_ENABLED, site);

  if (!existsSync(source)) {
    const error = new Error(`Site not found: ${site}`);
    error.status = 404;
    throw error;
  }
  if (existsSync(link)) return { ok: true, alreadyEnabled: true };

  symlinkSync(source, link);
  const test = await testConfig();
  if (!test.ok) {
    unlinkSync(link);
    return { ok: false, error: test.error };
  }

  const reload = await reloadNginx();
  return { ok: reload.ok, error: reload.error };
}

export async function disableSite(name) {
  const site = assertSiteName(name);
  const link = path.join(NGINX_ENABLED, site);
  if (!existsSync(link)) return { ok: true, alreadyDisabled: true };

  unlinkSync(link);
  const reload = await reloadNginx();
  return { ok: reload.ok, error: reload.error };
}

export function deleteSite(name) {
  const site = assertSiteName(name);
  const source = path.join(NGINX_AVAILABLE, site);
  const link = path.join(NGINX_ENABLED, site);

  const backup = backupSite(site);
  if (existsSync(link)) unlinkSync(link);
  if (existsSync(source)) unlinkSync(source);
  return { ok: true, backup };
}

export function ensureDirectory(target, mode = 0o755) {
  if (!existsSync(target)) mkdirSync(target, { recursive: true, mode });
  return target;
}

function idsFromSystem(userName, groupName) {
  const result = { uid: undefined, gid: undefined };

  if (userName) {
    try {
      for (const line of readFileSync("/etc/passwd", "utf8").split("\n")) {
        const [name, , uid, gid] = line.split(":");
        if (name === userName) {
          result.uid = Number(uid);
          result.gid = Number(gid);
          break;
        }
      }
    } catch {
      /* leave uid/gid undefined */
    }
  }

  if (groupName) {
    try {
      for (const line of readFileSync("/etc/group", "utf8").split("\n")) {
        const [name, , gid] = line.split(":");
        if (name === groupName) {
          result.gid = Number(gid);
          break;
        }
      }
    } catch {
      /* leave gid as resolved above */
    }
  }

  return result;
}

export function chownPath(target, userName, groupName) {
  const { uid, gid } = idsFromSystem(userName, groupName);
  if (uid === undefined && gid === undefined) return false;
  try {
    chownSync(target, uid ?? -1, gid ?? -1);
    return true;
  } catch {
    return false;
  }
}
