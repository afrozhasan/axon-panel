import { run } from "./exec.js";

export async function listPm2() {
  const result = await run("pm2", ["jlist"], { timeout: 25000, maxBuffer: 8 * 1024 * 1024 });
  if (!result.ok) {
    return { ok: false, error: (result.stderr || "PM2 is not available").trim(), apps: [] };
  }
  try {
    const raw = JSON.parse(result.stdout.trim() || "[]");
    const apps = raw.map((app) => ({
      name: app.name,
      pid: app.pid || null,
      status: app.pm2_env?.status || "unknown",
      cpu: app.monit?.cpu ?? 0,
      memory: app.monit?.memory ?? 0,
      restarts: app.pm2_env?.restart_time ?? 0,
      uptimeMs: app.pm2_env?.pm_uptime ?? null,
      mode: app.pm2_env?.exec_mode || "fork",
      script: app.pm2_env?.pm_exec_path || null,
      cwd: app.pm2_env?.pm_cwd || null,
      namespace: app.pm2_env?.namespace || "default",
      version: app.pm2_env?.version || null,
      instances: app.pm2_env?.instances ?? 1,
    }));
    return { ok: true, apps };
  } catch {
    return { ok: false, error: "Could not parse PM2 output", apps: [] };
  }
}

export const PM2_ACTIONS = ["restart", "reload", "stop", "start", "delete"];

export async function controlPm2(action, name) {
  return run("pm2", [action, name], { timeout: 30000 });
}
