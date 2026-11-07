import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../exec.js";

const ALLOWED_ARTISAN_COMMANDS = new Set([
  "key:generate",
  "storage:link",
  "migrate",
  "migrate:status",
  "cache:clear",
  "config:clear",
  "config:cache",
  "route:clear",
  "route:cache",
  "view:clear",
  "view:cache",
  "optimize:clear",
  "queue:restart",
]);

export function isLaravel(docroot) {
  if (!docroot || !existsSync(docroot)) return false;
  return existsSync(path.join(docroot, "artisan")) && existsSync(path.join(docroot, "bootstrap", "app.php"));
}

export async function runArtisan(docroot, command, extraArgs = []) {
  if (!ALLOWED_ARTISAN_COMMANDS.has(command)) {
    throw new Error(`Artisan command not permitted: ${command}`);
  }

  const args = ["artisan", command, ...extraArgs];
  const result = await run("php", args, {
    cwd: docroot,
    timeout: 120000,
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `Artisan command ${command} failed`);
  }

  return { ok: true, output: `${result.stdout}\n${result.stderr}`.trim() };
}

export async function getLaravelOverview(docroot) {
  if (!isLaravel(docroot)) {
    return { installed: false };
  }

  const versionRes = await run("php", ["artisan", "--version"], { cwd: docroot, timeout: 15000 }).catch(() => ({
    ok: false,
    stdout: "Laravel Framework",
  }));

  const envPath = path.join(docroot, ".env");
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  const storageLinked = existsSync(path.join(docroot, "public", "storage"));

  return {
    installed: true,
    version: versionRes.stdout.trim(),
    storageLinked,
    envSummary: {
      appName: (envContent.match(/^APP_NAME=(.*)$/m) || [])[1]?.replace(/^["']|["']$/g, "") || "Laravel",
      appEnv: (envContent.match(/^APP_ENV=(.*)$/m) || [])[1] || "production",
      appDebug: (envContent.match(/^APP_DEBUG=(.*)$/m) || [])[1] === "true",
      appUrl: (envContent.match(/^APP_URL=(.*)$/m) || [])[1] || "",
      dbConnection: (envContent.match(/^DB_CONNECTION=(.*)$/m) || [])[1] || "mysql",
    },
  };
}

export function readLaravelEnv(docroot) {
  const envPath = path.join(docroot, ".env");
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  }
  return env;
}

export function writeLaravelEnv(docroot, patch = {}) {
  const envPath = path.join(docroot, ".env");
  const current = readLaravelEnv(docroot);
  const updated = { ...current, ...patch };

  const lines = Object.entries(updated).map(([k, v]) => `${k}=${v.includes(" ") ? `"${v}"` : v}`);
  writeFileSync(envPath, lines.join("\n") + "\n", { mode: 0o600 });
  return { ok: true };
}
