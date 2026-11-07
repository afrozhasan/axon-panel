import { Router } from "express";
import {
  publicNotificationConfig,
  loadNotificationConfig,
  saveNotificationConfig,
  testChannel,
  generateDailyReport,
  runAlertChecks,
  getNotificationHistory,
  getTelegramUpdates,
} from "../lib/notifications.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";

const router = Router();

// GET /api/notifications/settings
router.get("/settings", (_req, res, next) => {
  try {
    res.json({
      settings: publicNotificationConfig(),
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/notifications/settings
router.put("/settings", (req, res, next) => {
  try {
    const body = req.body ?? {};
    const patch = {};

    if (body.telegram) {
      patch.telegram = {};
      if (typeof body.telegram.enabled === "boolean") patch.telegram.enabled = body.telegram.enabled;
      if (typeof body.telegram.chatId === "string") patch.telegram.chatId = body.telegram.chatId.trim();
      // If a non-masked token is provided, update it
      if (typeof body.telegram.botToken === "string" && !body.telegram.botToken.includes("...")) {
        patch.telegram.botToken = body.telegram.botToken.trim();
      }
    }

    if (body.slack) {
      patch.slack = {};
      if (typeof body.slack.enabled === "boolean") patch.slack.enabled = body.slack.enabled;
      if (typeof body.slack.channel === "string") patch.slack.channel = body.slack.channel.trim();
      // If a non-masked webhook is provided, update it
      if (typeof body.slack.webhookUrl === "string" && !body.slack.webhookUrl.includes("...")) {
        patch.slack.webhookUrl = body.slack.webhookUrl.trim();
      }
    }

    if (body.thresholds && typeof body.thresholds === "object") {
      patch.thresholds = {};
      if (typeof body.thresholds.cpuPercent === "number") {
        patch.thresholds.cpuPercent = Math.max(10, Math.min(100, Math.round(body.thresholds.cpuPercent)));
      }
      if (typeof body.thresholds.memoryPercent === "number") {
        patch.thresholds.memoryPercent = Math.max(10, Math.min(100, Math.round(body.thresholds.memoryPercent)));
      }
      if (typeof body.thresholds.diskPercent === "number") {
        patch.thresholds.diskPercent = Math.max(10, Math.min(100, Math.round(body.thresholds.diskPercent)));
      }
      if (typeof body.thresholds.sslDaysRemaining === "number") {
        patch.thresholds.sslDaysRemaining = Math.max(1, Math.min(90, Math.round(body.thresholds.sslDaysRemaining)));
      }
    }

    if (Array.isArray(body.monitoredServices)) {
      patch.monitoredServices = body.monitoredServices
        .map((s) => String(s).trim())
        .filter((s) => /^[a-zA-Z0-9._-]+$/.test(s));
    }

    if (body.dailyReport && typeof body.dailyReport === "object") {
      patch.dailyReport = {};
      if (typeof body.dailyReport.enabled === "boolean") patch.dailyReport.enabled = body.dailyReport.enabled;
      if (typeof body.dailyReport.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.dailyReport.time)) {
        patch.dailyReport.time = body.dailyReport.time;
      }
    }

    if (typeof body.alertCooldownMinutes === "number") {
      patch.alertCooldownMinutes = Math.max(5, Math.min(1440, Math.round(body.alertCooldownMinutes)));
    }

    const updated = saveNotificationConfig(patch);

    audit({
      action: "notifications.update_settings",
      actor: req.actor?.username || "admin",
      ip: clientIp(req),
      params: {
        telegramEnabled: updated.telegram?.enabled,
        slackEnabled: updated.slack?.enabled,
        dailyReportEnabled: updated.dailyReport?.enabled,
      },
    });

    res.json({
      ok: true,
      settings: publicNotificationConfig(),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/notifications/test
router.post("/test", async (req, res, next) => {
  try {
    const { channel, configOverride } = req.body ?? {};
    if (!channel || (channel !== "telegram" && channel !== "slack")) {
      return res.status(400).json({ error: "Channel must be 'telegram' or 'slack'" });
    }

    const result = await testChannel({ channel, configOverride: configOverride || {} });
    audit({
      action: `notifications.test_${channel}`,
      actor: req.actor?.username || "admin",
      ip: clientIp(req),
      params: { channel },
      result: result.ok ? "ok" : "failed",
    });

    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/notifications/telegram/get-updates
router.post("/telegram/get-updates", async (req, res, next) => {
  try {
    const { botToken } = req.body ?? {};
    const effectiveToken = botToken || loadNotificationConfig().telegram?.botToken;
    if (!effectiveToken) {
      return res.status(400).json({ error: "Bot token is required" });
    }

    const chats = await getTelegramUpdates(effectiveToken);
    res.json({ chats });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/notifications/report/send-now
router.post("/report/send-now", async (req, res, next) => {
  try {
    const result = await generateDailyReport();
    audit({
      action: "notifications.manual_daily_report",
      actor: req.actor?.username || "admin",
      ip: clientIp(req),
      result: result.ok ? "ok" : "failed",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/notifications/check
router.post("/check", async (req, res, next) => {
  try {
    const result = await runAlertChecks();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/history
router.get("/history", (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const history = getNotificationHistory(limit);
    res.json({ history });
  } catch (err) {
    next(err);
  }
});

export default router;
