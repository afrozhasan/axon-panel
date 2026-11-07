import { Router } from "express";
import { run } from "../lib/exec.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { randomUUID } from "node:crypto";

const router = Router();
const ALLOWED_USERS = ["root", "www-data"];

async function readCrontab(user) {
  const result = await run("crontab", ["-u", user, "-l"], { timeout: 5000 });
  if (!result.ok && !/no crontab/i.test(result.stderr)) {
    throw new Error(`Failed to read crontab for ${user}: ${result.stderr}`);
  }
  const lines = (result.stdout || "").split("\n");
  const jobs = [];

  let idx = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // standard cron syntax: m h dom mon dow command
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 6) {
      const schedule = parts.slice(0, 5).join(" ");
      const command = parts.slice(5).join(" ");
      jobs.push({
        id: `${user}-${idx++}`,
        user,
        schedule,
        minute: parts[0],
        hour: parts[1],
        dom: parts[2],
        month: parts[3],
        dow: parts[4],
        command,
        raw: trimmed,
      });
    }
  }

  return jobs;
}

async function writeCrontab(user, rawContent) {
  const result = await run("crontab", ["-u", user, "-"], {
    timeout: 5000,
    input: rawContent.endsWith("\n") ? rawContent : `${rawContent}\n`,
  });
  if (!result.ok) {
    throw new Error(`Failed to write crontab for ${user}: ${result.stderr}`);
  }
}

router.get("/", async (_req, res, next) => {
  try {
    const [rootJobs, wwwJobs] = await Promise.all([
      readCrontab("root"),
      readCrontab("www-data"),
    ]);

    res.json({
      jobs: [...rootJobs, ...wwwJobs],
      users: ALLOWED_USERS,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { user = "www-data", schedule, command } = req.body ?? {};
    if (!ALLOWED_USERS.includes(user)) {
      return res.status(400).json({ error: "Invalid user. Must be root or www-data" });
    }
    if (!schedule || !command || typeof schedule !== "string" || typeof command !== "string") {
      return res.status(400).json({ error: "Schedule and command are required" });
    }

    const schedParts = schedule.trim().split(/\s+/);
    if (schedParts.length !== 5) {
      return res.status(400).json({ error: "Schedule must contain exactly 5 fields (minute hour day month weekday)" });
    }

    const currentResult = await run("crontab", ["-u", user, "-l"], { timeout: 5000 });
    let content = currentResult.ok ? currentResult.stdout.trim() : "";
    const newLine = `${schedule.trim()} ${command.trim()}`;
    content = content ? `${content}\n${newLine}\n` : `${newLine}\n`;

    await writeCrontab(user, content);
    audit({ action: "cron.add", actor: req.actor?.username, ip: clientIp(req), params: { user, schedule, command }, result: "ok" });
    res.status(201).json({ ok: true, message: "Cron job added successfully" });
  } catch (error) {
    next(error);
  }
});

router.delete("/:user/:index", async (req, res, next) => {
  try {
    const { user, index } = req.params;
    if (!ALLOWED_USERS.includes(user)) {
      return res.status(400).json({ error: "Invalid user" });
    }
    const idx = Number.parseInt(index, 10);
    if (Number.isNaN(idx)) {
      return res.status(400).json({ error: "Invalid job index" });
    }

    const currentResult = await run("crontab", ["-u", user, "-l"], { timeout: 5000 });
    if (!currentResult.ok) return res.status(404).json({ error: "No crontab found" });

    const lines = currentResult.stdout.split("\n");
    let activeIdx = 0;
    const newLines = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        newLines.push(line);
        continue;
      }
      if (activeIdx === idx) {
        // Skip this one (delete)
        activeIdx++;
        continue;
      }
      activeIdx++;
      newLines.push(line);
    }

    await writeCrontab(user, newLines.join("\n"));
    audit({ action: "cron.delete", actor: req.actor?.username, ip: clientIp(req), params: { user, index }, result: "ok" });
    res.json({ ok: true, message: "Cron job removed" });
  } catch (error) {
    next(error);
  }
});

router.post("/run-now", async (req, res, next) => {
  try {
    const { user = "www-data", command } = req.body ?? {};
    if (!ALLOWED_USERS.includes(user)) return res.status(400).json({ error: "Invalid user" });
    if (!command || typeof command !== "string") return res.status(400).json({ error: "Command is required" });

    const start = Date.now();
    const result = await run("su", ["-s", "/bin/bash", user, "-c", command], { timeout: 60000 });
    const durationMs = Date.now() - start;

    res.json({
      ok: result.ok,
      durationMs,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
