import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync, renameSync } from "node:fs";
import { run } from "./exec.js";
import { cpuUsage, memoryUsage, loadAverage, uptimeSeconds, diskUsage } from "./metrics.js";
import { listCertificates } from "./certbot.js";
import { getDb } from "./db.js";
import { CONFIG_DIR, loadConfig as loadServerConfig } from "../config.js";

export const NOTIFICATIONS_CONFIG_PATH = `${CONFIG_DIR}/notifications.json`;
export const ALERT_STATE_PATH = `${CONFIG_DIR}/alert-state.json`;

const DEFAULT_CONFIG = {
  telegram: {
    enabled: false,
    botToken: "",
    chatId: "",
  },
  slack: {
    enabled: false,
    webhookUrl: "",
    channel: "",
  },
  thresholds: {
    cpuPercent: 85,
    memoryPercent: 85,
    diskPercent: 85,
    sslDaysRemaining: 15,
  },
  monitoredServices: [
    "nginx",
    "mariadb",
    "redis-server",
    "php8.4-fpm",
    "ssh",
    "axon-panel",
    "fail2ban",
  ],
  dailyReport: {
    enabled: true,
    time: "08:00",
    lastSentDate: null,
  },
  alertCooldownMinutes: 60,
};

let cachedConfig = null;

export function loadNotificationConfig({ force = false } = {}) {
  if (cachedConfig && !force) return cachedConfig;
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }

  if (!existsSync(NOTIFICATIONS_CONFIG_PATH)) {
    return saveNotificationConfig(DEFAULT_CONFIG, true);
  }

  try {
    const raw = readFileSync(NOTIFICATIONS_CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      telegram: { ...DEFAULT_CONFIG.telegram, ...(parsed.telegram || {}) },
      slack: { ...DEFAULT_CONFIG.slack, ...(parsed.slack || {}) },
      thresholds: { ...DEFAULT_CONFIG.thresholds, ...(parsed.thresholds || {}) },
      dailyReport: { ...DEFAULT_CONFIG.dailyReport, ...(parsed.dailyReport || {}) },
      monitoredServices: Array.isArray(parsed.monitoredServices)
        ? parsed.monitoredServices
        : DEFAULT_CONFIG.monitoredServices,
    };
    return cachedConfig;
  } catch (err) {
    console.error("[notifications] Failed to read notifications.json:", err);
    return DEFAULT_CONFIG;
  }
}

export function saveNotificationConfig(patch, isInitial = false) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  const current = isInitial ? DEFAULT_CONFIG : loadNotificationConfig({ force: true });
  const merged = {
    ...current,
    ...patch,
    telegram: { ...current.telegram, ...(patch.telegram || {}) },
    slack: { ...current.slack, ...(patch.slack || {}) },
    thresholds: { ...current.thresholds, ...(patch.thresholds || {}) },
    dailyReport: { ...current.dailyReport, ...(patch.dailyReport || {}) },
    monitoredServices: Array.isArray(patch.monitoredServices)
      ? patch.monitoredServices
      : current.monitoredServices,
  };

  const tmp = `${NOTIFICATIONS_CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, NOTIFICATIONS_CONFIG_PATH);
  cachedConfig = merged;
  return merged;
}

export function maskSecret(secret) {
  if (!secret || typeof secret !== "string") return "";
  if (secret.length <= 8) return "********";
  return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
}

export function publicNotificationConfig() {
  const cfg = loadNotificationConfig();
  return {
    telegram: {
      enabled: Boolean(cfg.telegram?.enabled),
      chatId: cfg.telegram?.chatId || "",
      hasToken: Boolean(cfg.telegram?.botToken),
      maskedToken: maskSecret(cfg.telegram?.botToken),
    },
    slack: {
      enabled: Boolean(cfg.slack?.enabled),
      channel: cfg.slack?.channel || "",
      hasWebhook: Boolean(cfg.slack?.webhookUrl),
      maskedWebhook: maskSecret(cfg.slack?.webhookUrl),
    },
    thresholds: cfg.thresholds,
    monitoredServices: cfg.monitoredServices,
    dailyReport: cfg.dailyReport,
    alertCooldownMinutes: cfg.alertCooldownMinutes,
  };
}

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a message via Telegram Bot API
 */
export async function sendTelegramMessage({ botToken, chatId, text, parseMode = "HTML" }) {
  if (!botToken || !chatId) {
    throw new Error("Telegram botToken and chatId are required");
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const errMsg = data.description || `HTTP ${res.status}: ${res.statusText}`;
      throw new Error(`Telegram error: ${errMsg}`);
    }
    return { ok: true, data };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch updates from Telegram to help user discover their Chat ID
 */
export async function getTelegramUpdates(botToken) {
  if (!botToken) throw new Error("Bot token is required");
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.description || `HTTP ${res.status}: ${res.statusText}`);
    }

    const chats = [];
    const seen = new Set();
    for (const update of data.result || []) {
      const msg = update.message || update.channel_post || update.my_chat_member;
      const chat = msg?.chat;
      if (chat && !seen.has(chat.id)) {
        seen.add(chat.id);
        chats.push({
          id: String(chat.id),
          type: chat.type,
          title: chat.title || chat.username || `${chat.first_name || ""} ${chat.last_name || ""}`.trim() || String(chat.id),
          username: chat.username || null,
        });
      }
    }
    return chats;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send a message via Slack Webhook
 */
export async function sendSlackMessage({ webhookUrl, text, blocks = null, channel = null }) {
  if (!webhookUrl) throw new Error("Slack webhookUrl is required");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  const payload = { text };
  if (blocks && Array.isArray(blocks)) {
    payload.blocks = blocks;
  }
  if (channel) {
    payload.channel = channel;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const bodyText = await res.text().catch(() => "");
    if (!res.ok || (bodyText && bodyText !== "ok" && !bodyText.startsWith("{"))) {
      throw new Error(`Slack error HTTP ${res.status}: ${bodyText || res.statusText}`);
    }
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}

function logNotificationToDb({ channel, level, title, message, status, error = null }) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO notification_history (channel, level, title, message, status, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(channel, level, title, message.slice(0, 2000), status, error ? String(error).slice(0, 1000) : null);
  } catch (err) {
    console.error("[notifications] Failed to log notification into DB:", err);
  }
}

export function getNotificationHistory(limit = 50) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, channel, level, title, message, status, error, created_at
      FROM notification_history
      ORDER BY id DESC
      LIMIT ?
    `).all(Math.min(limit, 200));
    return rows;
  } catch (err) {
    console.error("[notifications] Failed to query notification_history:", err);
    return [];
  }
}

/**
 * High-level notification dispatcher
 */
export async function notify({
  title,
  message,
  level = "info", // "critical" | "warning" | "success" | "info"
  fields = [], // array of { label, value }
  rawTelegramHtml = null,
  rawSlackBlocks = null,
  channelOverride = null, // "telegram" | "slack" | null (both)
}) {
  const config = loadNotificationConfig();
  const serverConfig = loadServerConfig();
  const hostname = serverConfig.panelDomain || "Server";

  // Emoji mapping
  const emojiMap = {
    critical: "🚨",
    warning: "⚠️",
    success: "✅",
    info: "ℹ️",
  };
  const icon = emojiMap[level] || "ℹ️";

  // Build Telegram HTML
  let tgText = rawTelegramHtml;
  if (!tgText) {
    const parts = [
      `${icon} <b>[${hostname.toUpperCase()}] ${escapeHtml(title)}</b>`,
      "",
      escapeHtml(message),
    ];

    if (fields.length > 0) {
      parts.push("");
      for (const f of fields) {
        parts.push(`• <b>${escapeHtml(f.label)}:</b> <code>${escapeHtml(f.value)}</code>`);
      }
    }

    parts.push("");
    parts.push(`<i>Time: ${new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })} (CET)</i>`);
    tgText = parts.join("\n");
  }

  // Build Slack Blocks
  let slackBlocks = rawSlackBlocks;
  if (!slackBlocks) {
    const sectionFields = fields.map((f) => ({
      type: "mrkdwn",
      text: `*${f.label}:*\n\`${f.value}\``,
    }));

    slackBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${icon} [${hostname}] ${title}`.slice(0, 150),
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: message,
        },
      },
    ];

    if (sectionFields.length > 0) {
      slackBlocks.push({
        type: "section",
        fields: sectionFields.slice(0, 10),
      });
    }

    slackBlocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Host:* \`${hostname}\` | *Time:* ${new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })} CET`,
        },
      ],
    });
  }

  const results = [];

  // Telegram dispatch
  if ((!channelOverride || channelOverride === "telegram") && config.telegram?.enabled) {
    if (config.telegram.botToken && config.telegram.chatId) {
      try {
        await sendTelegramMessage({
          botToken: config.telegram.botToken,
          chatId: config.telegram.chatId,
          text: tgText,
        });
        logNotificationToDb({
          channel: "telegram",
          level,
          title,
          message: tgText,
          status: "sent",
        });
        results.push({ channel: "telegram", ok: true });
      } catch (err) {
        logNotificationToDb({
          channel: "telegram",
          level,
          title,
          message: tgText,
          status: "failed",
          error: err.message,
        });
        results.push({ channel: "telegram", ok: false, error: err.message });
      }
    } else {
      results.push({ channel: "telegram", ok: false, error: "Missing botToken or chatId" });
    }
  }

  // Slack dispatch
  if ((!channelOverride || channelOverride === "slack") && config.slack?.enabled) {
    if (config.slack.webhookUrl) {
      try {
        await sendSlackMessage({
          webhookUrl: config.slack.webhookUrl,
          text: `${icon} [${hostname}] ${title}: ${message}`,
          blocks: slackBlocks,
          channel: config.slack.channel || undefined,
        });
        logNotificationToDb({
          channel: "slack",
          level,
          title,
          message,
          status: "sent",
        });
        results.push({ channel: "slack", ok: true });
      } catch (err) {
        logNotificationToDb({
          channel: "slack",
          level,
          title,
          message,
          status: "failed",
          error: err.message,
        });
        results.push({ channel: "slack", ok: false, error: err.message });
      }
    } else {
      results.push({ channel: "slack", ok: false, error: "Missing webhookUrl" });
    }
  }

  return {
    ok: results.length > 0 && results.every((r) => r.ok),
    results,
  };
}

/**
 * Send a test alert to verify Telegram or Slack connection
 */
export async function testChannel({ channel, configOverride = {} }) {
  const config = loadNotificationConfig();
  const serverConfig = loadServerConfig();
  const hostname = serverConfig.panelDomain || "Server";

  if (channel === "telegram") {
    const botToken = configOverride.botToken || config.telegram.botToken;
    const chatId = configOverride.chatId || config.telegram.chatId;

    if (!botToken || !chatId) {
      throw new Error("Telegram Bot Token and Chat ID are required for testing");
    }

    const testHtml = [
      `🎉 <b>Axon Server Notifications Test</b>`,
      ``,
      `Hello! This is a test alert from <b>${escapeHtml(hostname)}</b>.`,
      `Your Telegram Bot connection is operating properly and ready to receive real-time server alerts.`,
      ``,
      `• <b>Server:</b> <code>${escapeHtml(hostname)}</code>`,
      `• <b>Status:</b> <code>ONLINE &amp; ACTIVE</code>`,
      `• <b>Test Timestamp:</b> <code>${new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })} CET</code>`,
    ].join("\n");

    try {
      await sendTelegramMessage({ botToken, chatId, text: testHtml });
      logNotificationToDb({
        channel: "telegram",
        level: "info",
        title: "Test Alert",
        message: testHtml,
        status: "sent",
      });
      return { ok: true, channel: "telegram", message: "Test message sent to Telegram successfully!" };
    } catch (err) {
      logNotificationToDb({
        channel: "telegram",
        level: "info",
        title: "Test Alert",
        message: testHtml,
        status: "failed",
        error: err.message,
      });
      throw err;
    }
  }

  if (channel === "slack") {
    const webhookUrl = configOverride.webhookUrl || config.slack.webhookUrl;
    const slackChannel = configOverride.channel || config.slack.channel;

    if (!webhookUrl) {
      throw new Error("Slack Webhook URL is required for testing");
    }

    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `🎉 [${hostname}] Axon Alert Test`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hello! This is a test alert from *${hostname}*.\nYour Slack Incoming Webhook connection is properly verified and ready to receive server notifications and daily reports.`,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Server Host:*\n\`${hostname}\`` },
          { type: "mrkdwn", text: `*Status:*\n\`ONLINE & HEALTHY\`` },
          { type: "mrkdwn", text: `*Time:*\n${new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })} CET` },
        ],
      },
    ];

    try {
      await sendSlackMessage({
        webhookUrl,
        text: `🎉 Axon Panel Test Alert from ${hostname}`,
        blocks,
        channel: slackChannel || undefined,
      });

      logNotificationToDb({
        channel: "slack",
        level: "info",
        title: "Test Alert",
        message: `Axon Panel Test Alert from ${hostname}`,
        status: "sent",
      });
      return { ok: true, channel: "slack", message: "Test message sent to Slack successfully!" };
    } catch (err) {
      logNotificationToDb({
        channel: "slack",
        level: "info",
        title: "Test Alert",
        message: `Axon Panel Test Alert from ${hostname}`,
        status: "failed",
        error: err.message,
      });
      throw err;
    }
  }

  throw new Error(`Unsupported test channel: ${channel}`);
}

/**
 * Load and save alert state for deduplication
 */
function loadAlertState() {
  if (existsSync(ALERT_STATE_PATH)) {
    try {
      return JSON.parse(readFileSync(ALERT_STATE_PATH, "utf8"));
    } catch {
      return {};
    }
  }
  return {};
}

function saveAlertState(state) {
  try {
    writeFileSync(ALERT_STATE_PATH, JSON.stringify(state, null, 2), { mode: 0o600 });
  } catch (err) {
    console.error("[notifications] Failed to save alert-state.json:", err);
  }
}

/**
 * Run periodic server metric & service checks against thresholds
 */
export async function runAlertChecks() {
  const config = loadNotificationConfig();
  if (!config.telegram?.enabled && !config.slack?.enabled) {
    return { checked: false, reason: "No notification channels enabled" };
  }

  const state = loadAlertState();
  const now = Date.now();
  const cooldownMs = (config.alertCooldownMinutes || 60) * 60 * 1000;
  const dispatchEvents = [];

  // Helper for deduplicated alerts
  const checkCondition = (key, isTriggered, alertPayload, resolvePayload) => {
    const existing = state[key] || { active: false, lastSent: 0 };

    if (isTriggered) {
      if (!existing.active || now - existing.lastSent > cooldownMs) {
        dispatchEvents.push({
          type: "alert",
          key,
          payload: alertPayload,
        });
        state[key] = { active: true, lastSent: now, payload: alertPayload };
      }
    } else {
      if (existing.active) {
        dispatchEvents.push({
          type: "resolve",
          key,
          payload: resolvePayload || {
            title: `Resolved: ${key}`,
            message: `Condition ${key} has returned to normal levels.`,
            level: "success",
          },
        });
        state[key] = { active: false, lastSent: now };
      }
    }
  };

  try {
    // 1. CPU Check
    const cpu = cpuUsage();
    const cpuThresh = config.thresholds?.cpuPercent || 85;
    checkCondition(
      "high_cpu",
      cpu.percent >= cpuThresh,
      {
        title: `High CPU Load (${cpu.percent}%)`,
        message: `CPU usage on server exceeded the warning threshold of ${cpuThresh}%. Current utilization: ${cpu.percent}% across ${cpu.cores} cores.`,
        level: "warning",
        fields: [
          { label: "Current CPU", value: `${cpu.percent}%` },
          { label: "Threshold", value: `${cpuThresh}%` },
          { label: "Cores", value: String(cpu.cores) },
        ],
      },
      {
        title: "CPU Load Normalized",
        message: `CPU usage has dropped back to ${cpu.percent}% (below the ${cpuThresh}% threshold).`,
        level: "success",
      },
    );

    // 2. RAM Check
    const mem = memoryUsage();
    const memThresh = config.thresholds?.memoryPercent || 85;
    const memUsedGb = (mem.used / 1024 / 1024 / 1024).toFixed(1);
    const memTotalGb = (mem.total / 1024 / 1024 / 1024).toFixed(1);
    checkCondition(
      "high_ram",
      mem.percent >= memThresh,
      {
        title: `High Memory Usage (${mem.percent}%)`,
        message: `System RAM utilization has reached ${mem.percent}% (${memUsedGb} GB / ${memTotalGb} GB), exceeding the ${memThresh}% threshold.`,
        level: "warning",
        fields: [
          { label: "RAM Used", value: `${memUsedGb} / ${memTotalGb} GB (${mem.percent}%)` },
          { label: "Threshold", value: `${memThresh}%` },
          { label: "Swap Used", value: `${mem.swapPercent}%` },
        ],
      },
      {
        title: "Memory Usage Normalized",
        message: `RAM utilization has dropped to ${mem.percent}% (${memUsedGb} GB used).`,
        level: "success",
      },
    );

    // 3. Disk Check
    const disks = await diskUsage();
    const diskThresh = config.thresholds?.diskPercent || 85;
    for (const d of disks) {
      const mountKey = `disk_${d.mount.replace(/\//g, "_")}`;
      const usedGb = (d.used / 1024 / 1024 / 1024).toFixed(1);
      const totalGb = (d.size / 1024 / 1024 / 1024).toFixed(1);

      checkCondition(
        mountKey,
        d.percent >= diskThresh,
        {
          title: `Disk Space Low on ${d.mount} (${d.percent}%)`,
          message: `Disk storage on mount point \`${d.mount}\` has reached ${d.percent}% full (${usedGb} GB used of ${totalGb} GB). Threshold is ${diskThresh}%.`,
          level: "critical",
          fields: [
            { label: "Mount", value: d.mount },
            { label: "Used", value: `${usedGb} GB / ${totalGb} GB` },
            { label: "Capacity", value: `${d.percent}%` },
          ],
        },
        {
          title: `Disk Space Recovered on ${d.mount}`,
          message: `Storage utilization on ${d.mount} is back down to ${d.percent}% (${usedGb} GB used).`,
          level: "success",
        },
      );
    }

    // 4. Monitored Services Check
    const monitoredServices = config.monitoredServices || [];
    if (monitoredServices.length > 0) {
      for (const service of monitoredServices) {
        let svcToCheck = service;
        if (service === "axon-panel" || service === "axonpanel" || service === "webpanel") {
          const isAxon = (await run("systemctl", ["is-active", "axon-panel"], { timeout: 5000 })).stdout.trim() === "active";
          svcToCheck = isAxon ? "axon-panel" : service;
        }
        const checkRes = await run("systemctl", ["is-active", svcToCheck], { timeout: 8000 });
        const isActive = (checkRes.stdout || "").trim() === "active";
        const serviceKey = `service_down_${service}`;

        checkCondition(
          serviceKey,
          !isActive,
          {
            title: `CRITICAL: Service Down (${service})`,
            message: `The core system service \`${service}\` is NOT active (status: \`${(checkRes.stdout || "").trim() || "failed/inactive"}\`). Immediate investigation may be required.`,
            level: "critical",
            fields: [
              { label: "Service Unit", value: `${service}.service` },
              { label: "State", value: (checkRes.stdout || "").trim() || "inactive" },
            ],
          },
          {
            title: `RESOLVED: Service Restored (${service})`,
            message: `The system service \`${service}\` is now active and running normally.`,
            level: "success",
            fields: [
              { label: "Service Unit", value: `${service}.service` },
              { label: "State", value: "active" },
            ],
          },
        );
      }
    }

    // 5. SSL Certificate Expiry Check
    const certsRes = await listCertificates();
    if (certsRes.ok && Array.isArray(certsRes.certificates)) {
      const sslThresh = config.thresholds?.sslDaysRemaining || 15;
      for (const cert of certsRes.certificates) {
        if (typeof cert.daysRemaining === "number") {
          const certKey = `ssl_expiry_${cert.name}`;
          const isExpiring = cert.daysRemaining <= sslThresh;

          checkCondition(
            certKey,
            isExpiring,
            {
              title: `SSL Certificate Expiring Soon: ${cert.name}`,
              message: `SSL certificate for \`${cert.name}\` (${(cert.domains || []).join(", ")}) will expire in ${cert.daysRemaining} days (on ${cert.expiry}).`,
              level: "warning",
              fields: [
                { label: "Certificate", value: cert.name },
                { label: "Days Left", value: `${cert.daysRemaining} days` },
                { label: "Expiry Date", value: cert.expiry || "Unknown" },
              ],
            },
            {
              title: `SSL Certificate Renewed: ${cert.name}`,
              message: `SSL certificate for \`${cert.name}\` has been renewed. Valid for ${cert.daysRemaining} days.`,
              level: "success",
            },
          );
        }
      }
    }

    saveAlertState(state);

    // Dispatch all triggered alerts
    for (const event of dispatchEvents) {
      await notify(event.payload).catch((err) => {
        console.error(`[notifications] Error dispatching alert for ${event.key}:`, err);
      });
    }

    return {
      checked: true,
      eventsDispatched: dispatchEvents.length,
      events: dispatchEvents.map((e) => ({ key: e.key, type: e.type, title: e.payload.title })),
    };
  } catch (err) {
    console.error("[notifications] runAlertChecks error:", err);
    return { checked: false, error: err.message };
  }
}

/**
 * Generate and dispatch comprehensive daily server health report
 */
export async function generateDailyReport() {
  const config = loadNotificationConfig();
  const serverConfig = loadServerConfig();
  const hostname = serverConfig.panelDomain || "Server";

  try {
    // 1. System Host & OS info
    let publicIp = "";
    try {
      const ipRes = await run("hostname", ["-I"], { timeout: 5000 });
      publicIp = (ipRes.stdout || "").trim().split(/\s+/)[0] || "";
    } catch {
      /* ignore */
    }

    let osName = "Linux";
    try {
      const osRes = await run("lsb_release", ["-ds"], { timeout: 5000 });
      if (osRes.ok) osName = osRes.stdout.trim().replace(/^"/, "").replace(/"$/, "");
    } catch {
      /* ignore */
    }

    // 2. Metrics
    const cpu = cpuUsage();
    const mem = memoryUsage();
    const load = loadAverage();
    const uptimeSec = uptimeSeconds();
    const disks = await diskUsage();

    const uptimeDays = Math.floor(uptimeSec / 86400);
    const uptimeHours = Math.floor((uptimeSec % 86400) / 3600);
    const uptimeMins = Math.floor((uptimeSec % 3600) / 60);
    const uptimeStr = `${uptimeDays}d ${uptimeHours}h ${uptimeMins}m`;

    const ramUsedGb = (mem.used / 1024 / 1024 / 1024).toFixed(2);
    const ramTotalGb = (mem.total / 1024 / 1024 / 1024).toFixed(2);

    // 3. Monitored Services Status
    const services = config.monitoredServices || [];
    const serviceStatuses = [];
    let anyServiceDown = false;
    for (const s of services) {
      const sRes = await run("systemctl", ["is-active", s], { timeout: 5000 });
      const active = (sRes.stdout || "").trim() === "active";
      if (!active) anyServiceDown = true;
      serviceStatuses.push({ name: s, active, state: (sRes.stdout || "").trim() || "inactive" });
    }

    // 4. Security summary (SSH logins in last 24h & Fail2ban)
    let sshLogins24h = 0;
    let uniqueSshIps = new Set();
    try {
      const lastRes = await run("last", ["-s", "-24hours"], { timeout: 5000 });
      if (lastRes.ok) {
        const lines = (lastRes.stdout || "").split("\n").filter((l) => l.startsWith("root") || l.match(/^[a-z0-9_-]+\s+pts/));
        sshLogins24h = lines.length;
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts[2] && parts[2].includes(".")) uniqueSshIps.add(parts[2]);
        }
      }
    } catch {
      /* ignore */
    }

    let fail2banStats = { activeJails: 0, currentlyBanned: 0, totalBanned: 0 };
    try {
      const f2bRes = await run("fail2ban-client", ["status"], { timeout: 5000 });
      if (f2bRes.ok) {
        const jailMatch = f2bRes.stdout.match(/Jail list:\s*(.+)$/m);
        if (jailMatch) {
          const jails = jailMatch[1].split(",").map((j) => j.trim()).filter(Boolean);
          fail2banStats.activeJails = jails.length;
          for (const j of jails) {
            const jRes = await run("fail2ban-client", ["status", j], { timeout: 5000 });
            if (jRes.ok) {
              const curMatch = jRes.stdout.match(/Currently banned:\s*(\d+)/);
              const totMatch = jRes.stdout.match(/Total banned:\s*(\d+)/);
              if (curMatch) fail2banStats.currentlyBanned += Number(curMatch[1]);
              if (totMatch) fail2banStats.totalBanned += Number(totMatch[1]);
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    // 5. Websites & SSL Certificates
    let siteCount = 0;
    let siteNames = [];
    try {
      const db = getDb();
      const sites = db.prepare("SELECT name FROM websites").all();
      siteCount = sites.length;
      siteNames = sites.map((s) => s.name);
    } catch {
      /* ignore */
    }

    const certsRes = await listCertificates();
    const certList = certsRes.ok ? certsRes.certificates || [] : [];
    const expiringSoonCerts = certList.filter((c) => typeof c.daysRemaining === "number" && c.daysRemaining <= 30);

    // Disk summary
    const rootDisk = disks.find((d) => d.mount === "/") || disks[0];
    const diskUsedGb = rootDisk ? (rootDisk.used / 1024 / 1024 / 1024).toFixed(1) : "0";
    const diskTotalGb = rootDisk ? (rootDisk.size / 1024 / 1024 / 1024).toFixed(1) : "0";
    const diskPercent = rootDisk ? rootDisk.percent : 0;

    // Overall Health Verdict
    const hasWarnings = anyServiceDown || mem.percent > 85 || diskPercent > 85 || expiringSoonCerts.length > 0;
    const overallIcon = hasWarnings ? "⚠️" : "🟢";
    const overallText = hasWarnings
      ? "Attention required: some services or storage thresholds need review."
      : "All systems, services, and websites are operating normally.";

    // Format for Telegram (HTML)
    const tgLines = [
      `📊 <b>DAILY SERVER REPORT — ${escapeHtml(hostname.toUpperCase())}</b>`,
      `📅 <i>${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Berlin" })} (CET)</i>`,
      ``,
      `${overallIcon} <b>Overall Status:</b> ${overallText}`,
      ``,
      `🖥️ <b>System Overview:</b>`,
      `• <b>Host:</b> <code>${escapeHtml(hostname)}</code> (${escapeHtml(publicIp || "N/A")})`,
      `• <b>OS:</b> <code>${escapeHtml(osName)}</code>`,
      `• <b>Uptime:</b> <code>${escapeHtml(uptimeStr)}</code>`,
      `• <b>Load Avg:</b> <code>${load.one.toFixed(2)}, ${load.five.toFixed(2)}, ${load.fifteen.toFixed(2)}</code>`,
      ``,
      `⚡ <b>Resource Utilization:</b>`,
      `• <b>CPU:</b> <code>${cpu.percent}%</code> (${cpu.cores} Cores)`,
      `• <b>RAM:</b> <code>${ramUsedGb} / ${ramTotalGb} GB (${mem.percent}%)</code>`,
      `• <b>Swap:</b> <code>${mem.swapPercent}%</code>`,
      `• <b>Disk (/):</b> <code>${diskUsedGb} / ${diskTotalGb} GB (${diskPercent}%)</code>`,
      ``,
      `⚙️ <b>Core Services:</b>`,
      serviceStatuses
        .map((s) => `• ${s.active ? "✅" : "❌"} <b>${escapeHtml(s.name)}:</b> <code>${escapeHtml(s.state)}</code>`)
        .join("\n"),
      ``,
      `🔒 <b>Security & Access:</b>`,
      `• <b>SSH Logins (24h):</b> <code>${sshLogins24h} sessions</code> (${uniqueSshIps.size} distinct IPs)`,
      `• <b>Fail2ban:</b> <code>${fail2banStats.currentlyBanned} banned IPs</code> (${fail2banStats.totalBanned} total in ${fail2banStats.activeJails} jails)`,
      ``,
      `🌐 <b>Hosting & SSL:</b>`,
      `• <b>Hosted Websites:</b> <code>${siteCount} sites</code> ${siteNames.length > 0 ? `(${siteNames.slice(0, 4).join(", ")}${siteNames.length > 4 ? "…" : ""})` : ""}`,
      `• <b>SSL Certificates:</b> <code>${certList.length} valid</code>${expiringSoonCerts.length > 0 ? ` ⚠️ (${expiringSoonCerts.length} expiring &lt; 30d)` : ""}`,
    ];

    if (expiringSoonCerts.length > 0) {
      tgLines.push(``);
      tgLines.push(`⚠️ <b>Expiring Certificates:</b>`);
      for (const c of expiringSoonCerts) {
        tgLines.push(`• <code>${escapeHtml(c.name)}</code>: <b>${c.daysRemaining} days left</b> (exp ${escapeHtml(c.expiry)})`);
      }
    }

    const tgHtml = tgLines.join("\n");

    // Format for Slack (Block Kit)
    const slackBlocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📊 Daily Server Health Report: ${hostname}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${overallIcon} Status:* ${overallText}\n*OS:* ${osName} | *Uptime:* ${uptimeStr} | *IP:* \`${publicIp || "N/A"}\``,
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*CPU Utilization:*\n\`${cpu.percent}%\` (${cpu.cores} Cores)` },
          { type: "mrkdwn", text: `*Load Averages:*\n\`${load.one.toFixed(2)}, ${load.five.toFixed(2)}, ${load.fifteen.toFixed(2)}\`` },
          { type: "mrkdwn", text: `*Memory Used:*\n\`${ramUsedGb} / ${ramTotalGb} GB (${mem.percent}%)\`` },
          { type: "mrkdwn", text: `*Disk (/) Used:*\n\`${diskUsedGb} / ${diskTotalGb} GB (${diskPercent}%)\`` },
          { type: "mrkdwn", text: `*Hosted Sites:*\n\`${siteCount} websites\`` },
          { type: "mrkdwn", text: `*SSL Certificates:*\n\`${certList.length} active\`` },
          { type: "mrkdwn", text: `*SSH Logins (24h):*\n\`${sshLogins24h} sessions\`` },
          { type: "mrkdwn", text: `*Fail2ban Bans:*\n\`${fail2banStats.currentlyBanned} active\`` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Core Services Status:*\n${serviceStatuses.map((s) => `${s.active ? "✅" : "❌"} *${s.name}* (\`${s.state}\`)`).join("  •  ")}`,
        },
      },
    ];

    if (expiringSoonCerts.length > 0) {
      slackBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `⚠️ *Certificates Expiring Soon:*\n${expiringSoonCerts.map((c) => `• \`${c.name}\`: *${c.daysRemaining} days remaining*`).join("\n")}`,
        },
      });
    }

    slackBlocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Axon Panel Automated Daily Digest • Generated at ${new Date().toLocaleString("en-US", { timeZone: "Europe/Berlin" })} CET`,
        },
      ],
    });

    const dispatchResult = await notify({
      title: `Daily Server Health Report`,
      message: `Daily system overview for ${hostname}: ${overallText}`,
      level: hasWarnings ? "warning" : "info",
      rawTelegramHtml: tgHtml,
      rawSlackBlocks: slackBlocks,
    });

    // Mark today as sent
    const todayStr = new Date().toISOString().slice(0, 10);
    saveNotificationConfig({
      dailyReport: {
        ...config.dailyReport,
        lastSentDate: todayStr,
      },
    });

    return {
      ok: true,
      sentDate: todayStr,
      dispatchResult,
      summary: {
        hostname,
        uptime: uptimeStr,
        cpuPercent: cpu.percent,
        memPercent: mem.percent,
        diskPercent,
        servicesRunning: serviceStatuses.filter((s) => s.active).length,
        totalServices: serviceStatuses.length,
      },
    };
  } catch (err) {
    console.error("[notifications] Failed to generate daily report:", err);
    throw err;
  }
}

/**
 * Check if the daily report should run right now (based on HH:MM match and not sent today)
 */
export async function checkDailyReportDue() {
  const config = loadNotificationConfig();
  if (!config.dailyReport?.enabled) return false;
  if (!config.telegram?.enabled && !config.slack?.enabled) return false;

  const now = new Date();
  // Format current local time in Europe/Berlin
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(now);
  const partMap = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const todayDate = `${partMap.year}-${partMap.month}-${partMap.day}`;
  const currentTime = `${partMap.hour}:${partMap.minute}`;

  const targetTime = config.dailyReport.time || "08:00";
  const lastSent = config.dailyReport.lastSentDate;

  // Compare hours and minutes
  const [currH, currM] = currentTime.split(":").map(Number);
  const [tgtH, tgtM] = targetTime.split(":").map(Number);

  // If already sent today, skip
  if (lastSent === todayDate) {
    return false;
  }

  // If current time has reached or passed target time today
  const currTotalMins = currH * 60 + currM;
  const tgtTotalMins = tgtH * 60 + tgtM;

  if (currTotalMins >= tgtTotalMins) {
    console.log(`[notifications] Daily report is due (current: ${currentTime}, target: ${targetTime}, lastSent: ${lastSent}). Generating...`);
    await generateDailyReport();
    return true;
  }

  return false;
}
