import { Router } from "express";
import { assertUnit, assertPm2Name, assertEnum } from "../lib/validate.js";
import { listUnits, controlUnit, unitLogs, SERVICE_ACTIONS } from "../lib/systemd.js";
import { listPm2, controlPm2, PM2_ACTIONS } from "../lib/pm2.js";
import { run } from "../lib/exec.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";

const router = Router();

router.get("/", async (_req, res, next) => {
  try {
    res.json({ units: await listUnits() });
  } catch (error) {
    next(error);
  }
});

router.get("/units/:unit/logs", async (req, res, next) => {
  try {
    const unit = assertUnit(req.params.unit);
    const result = await unitLogs(unit, req.query.lines);
    res.json({ unit, ok: result.ok, lines: result.stdout.split("\n"), error: result.ok ? null : result.stderr });
  } catch (error) {
    next(error);
  }
});

router.post("/units/:unit/:action", async (req, res, next) => {
  try {
    const unit = assertUnit(req.params.unit);
    const action = assertEnum(req.params.action, SERVICE_ACTIONS, "action");
    const result = await controlUnit(action, unit);
    audit({
      action: `service.${action}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { unit },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: result.stderr || `${action} failed`, code: result.code });
    return res.json({ ok: true, unit, action });
  } catch (error) {
    return next(error);
  }
});

router.get("/pm2", async (_req, res, next) => {
  try {
    res.json(await listPm2());
  } catch (error) {
    next(error);
  }
});

router.post("/pm2/:name/:action", async (req, res, next) => {
  try {
    const name = assertPm2Name(req.params.name);
    const action = assertEnum(req.params.action, PM2_ACTIONS, "action");
    if (action === "delete" && req.body?.confirm !== name) {
      return res.status(400).json({ error: "Confirmation does not match the process name" });
    }
    const result = await controlPm2(action, name);
    audit({
      action: `pm2.${action}`,
      actor: req.actor.username,
      ip: clientIp(req),
      params: { name },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : result.stderr,
    });
    if (!result.ok) return res.status(500).json({ error: result.stderr || `pm2 ${action} failed` });
    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

router.get("/pm2/:name/logs", async (req, res, next) => {
  try {
    assertPm2Name(req.params.name);
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 1), 2000);
    const result = await run("pm2", ["logs", req.params.name, "--lines", String(lines), "--nostream"], {
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    res.json({ ok: result.ok, lines: `${result.stdout}${result.stderr}`.split("\n") });
  } catch (error) {
    next(error);
  }
});

router.get("/redis", async (_req, res, next) => {
  try {
    const ping = await run("redis-cli", ["ping"], { timeout: 10000 });
    if (!ping.ok || !ping.stdout.includes("PONG")) {
      return res.json({ ok: false, error: "Redis is not responding" });
    }
    const info = await run("redis-cli", ["info"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
    const parsed = {};
    for (const line of info.stdout.split("\n")) {
      const [key, value] = line.split(":");
      if (key && value && !key.startsWith("#")) parsed[key.trim()] = value.trim();
    }
    return res.json({
      ok: true,
      version: parsed.redis_version,
      uptimeSeconds: Number(parsed.uptime_in_seconds) || 0,
      connectedClients: Number(parsed.connected_clients) || 0,
      usedMemory: Number(parsed.used_memory) || 0,
      maxMemory: Number(parsed.maxmemory) || 0,
      totalCommands: Number(parsed.total_commands_processed) || 0,
      keyspace: Object.fromEntries(Object.entries(parsed).filter(([k]) => k.startsWith("db"))),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
