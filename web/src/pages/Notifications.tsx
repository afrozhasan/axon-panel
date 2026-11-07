import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { Badge, Button, Card, EmptyState, Field, Spinner, Tabs, useToast } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

type Task = {
  id: string;
  task_type: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  error?: string | null;
  created_at: string;
  updated_at: string;
};

type AuditEntry = {
  time?: string;
  timestamp?: string;
  actor: string;
  action: string;
  ip: string;
  params?: any;
};

type SslCert = {
  domain: string;
  daysRemaining: number;
  status: string;
};

type NotificationSettings = {
  telegram: {
    enabled: boolean;
    chatId: string;
    hasToken: boolean;
    maskedToken: string;
  };
  slack: {
    enabled: boolean;
    channel: string;
    hasWebhook: boolean;
    maskedWebhook: string;
  };
  thresholds: {
    cpuPercent: number;
    memoryPercent: number;
    diskPercent: number;
    sslDaysRemaining: number;
  };
  monitoredServices: string[];
  dailyReport: {
    enabled: boolean;
    time: string;
    lastSentDate: string | null;
  };
  alertCooldownMinutes: number;
};

type NotificationLog = {
  id: number;
  channel: string;
  level: string;
  title: string;
  message: string;
  status: "sent" | "failed";
  error: string | null;
  created_at: string;
};

type TelegramChat = {
  id: string;
  type: string;
  title: string;
  username: string | null;
};

export default function Notifications() {
  const [activeTab, setActiveTab] = useState<"channels" | "activity" | "history">("channels");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [certs, setCerts] = useState<SslCert[]>([]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [history, setHistory] = useState<NotificationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  // Form state
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [slackEnabled, setSlackEnabled] = useState(false);
  const [slackWebhook, setSlackWebhook] = useState("");
  const [slackChannel, setSlackChannel] = useState("");
  const [cpuThresh, setCpuThresh] = useState(85);
  const [ramThresh, setRamThresh] = useState(85);
  const [diskThresh, setDiskThresh] = useState(85);
  const [sslThresh, setSslThresh] = useState(15);
  const [cooldown, setCooldown] = useState(60);
  const [services, setServices] = useState<string[]>([]);
  const [newService, setNewService] = useState("");
  const [dailyReportEnabled, setDailyReportEnabled] = useState(true);
  const [dailyReportTime, setDailyReportTime] = useState("08:00");

  // Action busy states
  const [saving, setSaving] = useState(false);
  const [testingTg, setTestingTg] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [detectingChats, setDetectingChats] = useState(false);
  const [sendingReport, setSendingReport] = useState(false);
  const [discoveredChats, setDiscoveredChats] = useState<TelegramChat[]>([]);

  const loadData = async () => {
    try {
      const [tasksRes, auditRes, sslRes, settingsRes, historyRes] = await Promise.all([
        api.get<{ tasks: Task[] }>("/tasks").catch(() => ({ tasks: [] })),
        api.get<{ entries: AuditEntry[] }>("/security/audit").catch(() => ({ entries: [] })),
        api.get<{ certificates: SslCert[] }>("/ssl").catch(() => ({ certificates: [] })),
        api.get<{ settings: NotificationSettings }>("/notifications/settings").catch(() => null),
        api.get<{ history: NotificationLog[] }>("/notifications/history?limit=50").catch(() => ({ history: [] })),
      ]);

      setTasks(tasksRes.tasks || []);
      setAuditEntries(auditRes.entries || []);
      setCerts(sslRes.certificates || []);
      setHistory(historyRes.history || []);

      if (settingsRes?.settings) {
        const s = settingsRes.settings;
        setSettings(s);
        setTgEnabled(s.telegram.enabled);
        setTgChatId(s.telegram.chatId || "");
        setSlackEnabled(s.slack.enabled);
        setSlackChannel(s.slack.channel || "");
        setCpuThresh(s.thresholds?.cpuPercent ?? 85);
        setRamThresh(s.thresholds?.memoryPercent ?? 85);
        setDiskThresh(s.thresholds?.diskPercent ?? 85);
        setSslThresh(s.thresholds?.sslDaysRemaining ?? 15);
        setCooldown(s.alertCooldownMinutes ?? 60);
        setServices(s.monitoredServices || []);
        setDailyReportEnabled(s.dailyReport?.enabled ?? true);
        setDailyReportTime(s.dailyReport?.time || "08:00");
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      // Background poll for tasks and history
      api.get<{ history: NotificationLog[] }>("/notifications/history?limit=30")
        .then((res) => setHistory(res.history || []))
        .catch(() => {});
    }, 12000);
    return () => clearInterval(interval);
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const payload: any = {
        telegram: {
          enabled: tgEnabled,
          chatId: tgChatId,
        },
        slack: {
          enabled: slackEnabled,
          channel: slackChannel,
        },
        thresholds: {
          cpuPercent: Number(cpuThresh),
          memoryPercent: Number(ramThresh),
          diskPercent: Number(diskThresh),
          sslDaysRemaining: Number(sslThresh),
        },
        monitoredServices: services,
        dailyReport: {
          enabled: dailyReportEnabled,
          time: dailyReportTime,
        },
        alertCooldownMinutes: Number(cooldown),
      };

      if (tgToken.trim()) {
        payload.telegram.botToken = tgToken.trim();
      }
      if (slackWebhook.trim()) {
        payload.slack.webhookUrl = slackWebhook.trim();
      }

      const res = await api.put<{ ok: boolean; settings: NotificationSettings }>("/notifications/settings", payload);
      if (res.ok && res.settings) {
        setSettings(res.settings);
        setTgToken("");
        setSlackWebhook("");
        toast("ok", "Notification settings saved successfully!");
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleTestTelegram = async () => {
    setTestingTg(true);
    try {
      const configOverride: any = {};
      if (tgToken.trim()) configOverride.botToken = tgToken.trim();
      if (tgChatId.trim()) configOverride.chatId = tgChatId.trim();

      const res = await api.post<{ ok: boolean; message: string }>("/notifications/test", {
        channel: "telegram",
        configOverride,
      });
      if (res.ok) {
        toast("ok", "Telegram test alert sent successfully! Check your Telegram chat.");
        loadData();
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setTestingTg(false);
    }
  };

  const handleTestSlack = async () => {
    setTestingSlack(true);
    try {
      const configOverride: any = {};
      if (slackWebhook.trim()) configOverride.webhookUrl = slackWebhook.trim();
      if (slackChannel.trim()) configOverride.channel = slackChannel.trim();

      const res = await api.post<{ ok: boolean; message: string }>("/notifications/test", {
        channel: "slack",
        configOverride,
      });
      if (res.ok) {
        toast("ok", "Slack test alert sent successfully! Check your Slack channel.");
        loadData();
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setTestingSlack(false);
    }
  };

  const handleAutoDetectTelegram = async () => {
    setDetectingChats(true);
    try {
      const res = await api.post<{ chats: TelegramChat[] }>("/notifications/telegram/get-updates", {
        botToken: tgToken.trim() || undefined,
      });
      if (res.chats && res.chats.length > 0) {
        setDiscoveredChats(res.chats);
        // If single chat, set immediately
        if (res.chats.length === 1) {
          setTgChatId(res.chats[0].id);
          toast("ok", `Detected Chat ID: ${res.chats[0].id} (${res.chats[0].title})`);
        } else {
          toast("info", `Found ${res.chats.length} active chats with your bot.`);
        }
      } else {
        toast(
          "error",
          "No incoming chats found. Please open your Telegram bot and send a message (like /start) first, then try again."
        );
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setDetectingChats(false);
    }
  };

  const handleSendDailyReportNow = async () => {
    if (!confirm("Generate and send the Daily Server Health Report to enabled channels now?")) return;
    setSendingReport(true);
    try {
      const res = await api.post<{ ok: boolean; summary: any }>("/notifications/report/send-now", {});
      if (res.ok) {
        toast("ok", "Daily Server Report sent successfully to your configured channels!");
        loadData();
      }
    } catch (err) {
      toast("error", errorMessage(err));
    } finally {
      setSendingReport(false);
    }
  };

  const toggleService = (svc: string) => {
    if (services.includes(svc)) {
      setServices(services.filter((s) => s !== svc));
    } else {
      setServices([...services, svc]);
    }
  };

  const addCustomService = () => {
    const trimmed = newService.trim();
    if (!trimmed) return;
    if (!services.includes(trimmed)) {
      setServices([...services, trimmed]);
    }
    setNewService("");
  };

  const expiringCerts = certs.filter((c) => c.daysRemaining <= 30);
  const runningTasks = tasks.filter((t) => t.status === "running" || t.status === "queued");
  const failedTasks = tasks.filter((t) => t.status === "failed");

  const commonServices = [
    { id: "nginx", label: "Nginx Web Server" },
    { id: "mariadb", label: "MariaDB SQL Database" },
    { id: "redis-server", label: "Redis In-Memory Cache" },
    { id: "php8.4-fpm", label: "PHP 8.4-FPM" },
    { id: "ssh", label: "OpenSSH Server" },
    { id: "axon-panel", label: "Axon Panel Service" },
    { id: "fail2ban", label: "Fail2ban Intrusion Defense" },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Server Notifications & Alerts" }]} />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-[var(--axon-text)]">Server Notifications &amp; Alerts</h1>
            <div className="flex items-center gap-1.5">
              {settings?.telegram.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" /> Telegram Active
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                  Telegram Off
                </span>
              )}
              {settings?.slack.enabled ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Slack Active
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                  Slack Off
                </span>
              )}
            </div>
          </div>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Real-time alerting via Telegram Bot &amp; Slack for service failures, system load spikes, and scheduled daily health reports.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            loading={sendingReport}
            onClick={handleSendDailyReportNow}
            title="Generate and dispatch daily health report right now"
          >
            📊 Send Daily Report Now
          </Button>
          <Button variant="ghost" onClick={loadData}>
            ↻ Refresh
          </Button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--axon-muted)] font-medium">Daily Report</p>
            <p className="text-lg font-bold text-[var(--axon-text)] mt-0.5">
              {dailyReportEnabled ? `Daily at ${dailyReportTime}` : "Disabled"}
            </p>
            <p className="text-[10px] text-[var(--axon-muted)] mt-0.5">
              {settings?.dailyReport.lastSentDate ? `Last sent: ${settings.dailyReport.lastSentDate}` : "Not sent yet"}
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-[var(--axon-primary)]/15 flex items-center justify-center text-[var(--axon-primary)]">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--axon-muted)] font-medium">Active Channels</p>
            <p className="text-2xl font-bold text-[var(--axon-primary)] mt-1">
              {(settings?.telegram.enabled ? 1 : 0) + (settings?.slack.enabled ? 1 : 0)} / 2
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-sky-500/15 flex items-center justify-center text-sky-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--axon-muted)] font-medium">SSL Expiry Warnings</p>
            <p className={`text-2xl font-bold mt-1 ${expiringCerts.length > 0 ? "text-amber-400" : "text-emerald-400"}`}>
              {expiringCerts.length}
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-amber-500/15 flex items-center justify-center text-amber-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--axon-muted)] font-medium">Failed Operations</p>
            <p className={`text-2xl font-bold mt-1 ${failedTasks.length > 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {failedTasks.length}
            </p>
          </div>
          <div className="h-10 w-10 rounded-lg bg-rose-500/15 flex items-center justify-center text-rose-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <Tabs
        tabs={[
          { id: "channels", label: "Alert Channels & Daily Report" },
          { id: "history", label: "Notification History", badge: history.length },
          { id: "activity", label: "Active Tasks & Audit Log", badge: runningTasks.length || undefined },
        ]}
        active={activeTab}
        onChange={(id) => setActiveTab(id as any)}
      />

      {loading ? (
        <div className="py-12 flex items-center justify-center gap-2 text-sm text-[var(--axon-muted)]">
          <Spinner /> Loading notification configuration…
        </div>
      ) : (
        <>
          {/* TAB 1: CHANNELS & CONFIGURATION */}
          {activeTab === "channels" && (
            <div className="space-y-6">
              {/* Telegram Bot Card */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span className="text-lg">✈️</span>
                    <span>Telegram Bot Integration</span>
                  </div>
                }
                subtitle="Instant alerts sent directly to your Telegram chat, group, or channel."
                actions={
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--axon-text)]">
                      <input
                        type="checkbox"
                        checked={tgEnabled}
                        onChange={(e) => setTgEnabled(e.target.checked)}
                        className="rounded border-[var(--axon-border)] text-[var(--axon-primary)] h-4 w-4"
                      />
                      Enable Telegram
                    </label>
                  </div>
                }
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field
                      label="Telegram Bot Token"
                      hint={
                        settings?.telegram.hasToken
                          ? `Configured: ${settings.telegram.maskedToken} (leave blank to keep current)`
                          : "Create a bot with @BotFather to get this token"
                      }
                    >
                      <input
                        type="password"
                        className="field mono text-xs"
                        placeholder={settings?.telegram.hasToken ? "••••••••••••••••••••••••" : "e.g. 7123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"}
                        value={tgToken}
                        onChange={(e) => setTgToken(e.target.value)}
                      />
                    </Field>

                    <Field
                      label="Telegram Chat ID"
                      hint="Numeric user or group ID (e.g. 12345678 or -100123456789)"
                    >
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="field mono text-xs"
                          placeholder="e.g. 987654321"
                          value={tgChatId}
                          onChange={(e) => setTgChatId(e.target.value)}
                        />
                        <Button
                          variant="ghost"
                          loading={detectingChats}
                          onClick={handleAutoDetectTelegram}
                          title="Detect chat ID automatically from recent messages sent to your bot"
                          className="text-xs shrink-0"
                        >
                          Auto-Detect
                        </Button>
                      </div>
                    </Field>
                  </div>

                  {discoveredChats.length > 0 && (
                    <div className="p-3 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs space-y-2">
                      <p className="font-semibold text-sky-300">Discovered Telegram Chats (Click to select):</p>
                      <div className="flex flex-wrap gap-2">
                        {discoveredChats.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setTgChatId(c.id);
                              toast("ok", `Selected Chat ID: ${c.id}`);
                            }}
                            className="px-2.5 py-1 rounded bg-[var(--axon-card)] border border-sky-500/40 text-[var(--axon-text)] hover:border-sky-400 text-xs font-mono transition"
                          >
                            {c.title} ({c.type}) — ID: {c.id}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--axon-border)]">
                    <div className="text-[11px] text-[var(--axon-muted)]">
                      Tip: Start a chat with <code className="text-sky-400">@userinfobot</code> or message your bot and click Auto-Detect.
                    </div>
                    <Button
                      variant="ghost"
                      loading={testingTg}
                      onClick={handleTestTelegram}
                      disabled={!tgChatId && !settings?.telegram.chatId}
                    >
                      ✈️ Send Test Telegram
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Slack Card */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span className="text-lg">💬</span>
                    <span>Slack Webhook Integration</span>
                  </div>
                }
                subtitle="Post server alerts and daily digests into your team's Slack channels via Incoming Webhooks."
                actions={
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--axon-text)]">
                      <input
                        type="checkbox"
                        checked={slackEnabled}
                        onChange={(e) => setSlackEnabled(e.target.checked)}
                        className="rounded border-[var(--axon-border)] text-[var(--axon-primary)] h-4 w-4"
                      />
                      Enable Slack
                    </label>
                  </div>
                }
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Field
                      label="Slack Incoming Webhook URL"
                      hint={
                        settings?.slack.hasWebhook
                          ? `Configured: ${settings.slack.maskedWebhook} (leave blank to keep current)`
                          : "https://hooks.slack.com/services/..."
                      }
                    >
                      <input
                        type="password"
                        className="field mono text-xs"
                        placeholder={settings?.slack.hasWebhook ? "••••••••••••••••••••••••" : "https://hooks.slack.com/services/T00/B00/XXXX"}
                        value={slackWebhook}
                        onChange={(e) => setSlackWebhook(e.target.value)}
                      />
                    </Field>

                    <Field
                      label="Channel Override (Optional)"
                      hint="e.g. #server-alerts or #devops (leave empty to use webhook default)"
                    >
                      <input
                        type="text"
                        className="field text-xs"
                        placeholder="#server-alerts"
                        value={slackChannel}
                        onChange={(e) => setSlackChannel(e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-[var(--axon-border)]">
                    <div className="text-[11px] text-[var(--axon-muted)]">
                      Supports Slack Incoming Webhooks and Slack-compatible endpoints (Mattermost, Discord).
                    </div>
                    <Button
                      variant="ghost"
                      loading={testingSlack}
                      onClick={handleTestSlack}
                      disabled={!slackWebhook && !settings?.slack.hasWebhook}
                    >
                      💬 Send Test Slack
                    </Button>
                  </div>
                </div>
              </Card>

              {/* Daily Report Settings Card */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span className="text-lg">📊</span>
                    <span>Daily Server Health Report</span>
                  </div>
                }
                subtitle="Automated daily executive summary: resource utilization, service checklist, security logins, and SSL certificates."
                actions={
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-[var(--axon-text)]">
                      <input
                        type="checkbox"
                        checked={dailyReportEnabled}
                        onChange={(e) => setDailyReportEnabled(e.target.checked)}
                        className="rounded border-[var(--axon-border)] text-[var(--axon-primary)] h-4 w-4"
                      />
                      Enable Daily Report
                    </label>
                  </div>
                }
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="Dispatch Schedule (CET Local Time)" hint="24-hour format (HH:MM)">
                      <input
                        type="time"
                        className="field text-xs"
                        value={dailyReportTime}
                        onChange={(e) => setDailyReportTime(e.target.value)}
                      />
                    </Field>

                    <Field label="Last Dispatched Date" hint="Prevents multiple dispatches in a single day">
                      <input
                        type="text"
                        disabled
                        className="field text-xs bg-[var(--axon-bg)] opacity-70"
                        value={settings?.dailyReport.lastSentDate || "Never sent"}
                      />
                    </Field>

                    <Field label="Manual Trigger" hint="Test or dispatch report immediately">
                      <Button
                        variant="ghost"
                        loading={sendingReport}
                        onClick={handleSendDailyReportNow}
                        className="w-full text-xs h-[38px]"
                      >
                        📊 Dispatch Report Now
                      </Button>
                    </Field>
                  </div>
                </div>
              </Card>

              {/* Alert Thresholds Card */}
              <Card
                title={
                  <div className="flex items-center gap-2">
                    <span className="text-lg">⚡</span>
                    <span>Alert Thresholds &amp; Monitored Services</span>
                  </div>
                }
                subtitle="Configure metric alert sensitivity, auto-recovery notifications, and system services."
              >
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <Field label="CPU Warning Threshold" hint="Triggers alert when sustained CPU exceeds %">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={20}
                          max={100}
                          className="field text-xs font-mono"
                          value={cpuThresh}
                          onChange={(e) => setCpuThresh(Number(e.target.value))}
                        />
                        <span className="text-xs text-[var(--axon-muted)] font-semibold">%</span>
                      </div>
                    </Field>

                    <Field label="RAM Warning Threshold" hint="Triggers alert when system RAM exceeds %">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={20}
                          max={100}
                          className="field text-xs font-mono"
                          value={ramThresh}
                          onChange={(e) => setRamThresh(Number(e.target.value))}
                        />
                        <span className="text-xs text-[var(--axon-muted)] font-semibold">%</span>
                      </div>
                    </Field>

                    <Field label="Disk Warning Threshold" hint="Triggers alert when partition space exceeds %">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={20}
                          max={100}
                          className="field text-xs font-mono"
                          value={diskThresh}
                          onChange={(e) => setDiskThresh(Number(e.target.value))}
                        />
                        <span className="text-xs text-[var(--axon-muted)] font-semibold">%</span>
                      </div>
                    </Field>

                    <Field label="SSL Expiry Notice (Days)" hint="Warns before certificates expire">
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={90}
                          className="field text-xs font-mono"
                          value={sslThresh}
                          onChange={(e) => setSslThresh(Number(e.target.value))}
                        />
                        <span className="text-xs text-[var(--axon-muted)] font-semibold">days</span>
                      </div>
                    </Field>
                  </div>

                  {/* Monitored Services */}
                  <div className="space-y-2 pt-2 border-t border-[var(--axon-border)]">
                    <label className="block text-xs font-semibold text-[var(--axon-text)]">
                      Monitored System Services (Alerts immediately if any service stops or fails)
                    </label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {commonServices.map((svc) => {
                        const isMonitored = services.includes(svc.id);
                        return (
                          <button
                            key={svc.id}
                            type="button"
                            onClick={() => toggleService(svc.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
                              isMonitored
                                ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30"
                                : "bg-[var(--axon-card)] text-[var(--axon-muted)] border-[var(--axon-border)] hover:border-[var(--axon-muted)]"
                            }`}
                          >
                            <span>{isMonitored ? "✓" : "+"}</span>
                            <span>{svc.label}</span>
                            <span className="text-[10px] opacity-60 font-mono">({svc.id})</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="flex items-center gap-2 pt-2 max-w-sm">
                      <input
                        type="text"
                        className="field text-xs font-mono"
                        placeholder="Add custom systemd service (e.g. redis-server)"
                        value={newService}
                        onChange={(e) => setNewService(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addCustomService()}
                      />
                      <Button variant="ghost" onClick={addCustomService} className="text-xs">
                        Add
                      </Button>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--axon-border)]">
                    <Field label="Alert Cooldown (Minutes)" hint="Minimum minutes between recurring alerts for the same condition to prevent alert spam">
                      <div className="flex items-center gap-2 max-w-xs">
                        <input
                          type="number"
                          min={5}
                          max={1440}
                          className="field text-xs font-mono"
                          value={cooldown}
                          onChange={(e) => setCooldown(Number(e.target.value))}
                        />
                        <span className="text-xs text-[var(--axon-muted)] font-semibold">minutes</span>
                      </div>
                    </Field>
                  </div>
                </div>
              </Card>

              {/* Save Button Bar */}
              <div className="flex items-center justify-end gap-3 p-4 rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)]">
                <Button variant="primary" loading={saving} onClick={handleSaveSettings} className="px-6 py-2">
                  💾 Save All Notification Settings
                </Button>
              </div>
            </div>
          )}

          {/* TAB 2: NOTIFICATION HISTORY */}
          {activeTab === "history" && (
            <Card
              title="Recent Notification &amp; Alert Deliveries"
              subtitle="Audit log of alert dispatches, recovery notices, and daily reports."
              actions={
                <Button variant="ghost" onClick={loadData}>
                  ↻ Refresh History
                </Button>
              }
            >
              {history.length === 0 ? (
                <EmptyState
                  message="No notifications dispatched yet. When server alerts or daily reports are triggered, their delivery status will appear here."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                        <th className="px-4 py-2.5">Time (CET)</th>
                        <th className="px-4 py-2.5">Channel</th>
                        <th className="px-4 py-2.5">Level</th>
                        <th className="px-4 py-2.5">Title</th>
                        <th className="px-4 py-2.5">Delivery Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--axon-border)]">
                      {history.map((h) => (
                        <tr key={h.id} className="hover:bg-[var(--axon-card-hover)] transition">
                          <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">
                            {formatDate(h.created_at)}
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                h.channel === "telegram"
                                  ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                                  : "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              }`}
                            >
                              {h.channel}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                h.level === "critical"
                                  ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                                  : h.level === "warning"
                                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                  : h.level === "success"
                                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                  : "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                              }`}
                            >
                              {h.level}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-medium text-[var(--axon-text)]">
                            {h.title}
                          </td>
                          <td className="px-4 py-2.5">
                            {h.status === "sent" ? (
                              <span className="text-emerald-400 font-semibold flex items-center gap-1">
                                ✓ Sent
                              </span>
                            ) : (
                              <span className="text-rose-400 font-semibold flex items-center gap-1" title={h.error || ""}>
                                ✕ Failed {h.error ? `(${h.error.slice(0, 40)})` : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* TAB 3: TASKS & AUDIT TRAIL */}
          {activeTab === "activity" && (
            <div className="space-y-6">
              {/* Background Tasks Feed */}
              <Card title="Background Task Activity">
                {tasks.length === 0 ? (
                  <EmptyState message="No background tasks recorded yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                          <th className="px-4 py-2.5">Task ID</th>
                          <th className="px-4 py-2.5">Type</th>
                          <th className="px-4 py-2.5">Status</th>
                          <th className="px-4 py-2.5">Progress</th>
                          <th className="px-4 py-2.5">Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--axon-border)]">
                        {tasks.map((task) => (
                          <tr key={task.id} className="hover:bg-[var(--axon-card-hover)] transition">
                            <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">{task.id}</td>
                            <td className="px-4 py-2.5 font-medium text-[var(--axon-text)]">{task.task_type}</td>
                            <td className="px-4 py-2.5">
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                                  task.status === "completed"
                                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                    : task.status === "failed"
                                    ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                                    : task.status === "running"
                                    ? "bg-[var(--axon-primary)]/15 text-[var(--axon-primary)] border border-[var(--axon-primary)]/30 animate-pulse"
                                    : "bg-slate-500/15 text-slate-400 border border-slate-500/30"
                                }`}
                              >
                                {task.status}
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="w-24 bg-[var(--axon-input-bg)] rounded-full h-1.5 overflow-hidden">
                                <div
                                  className="bg-[var(--axon-primary)] h-1.5 rounded-full"
                                  style={{ width: `${task.progress || 0}%` }}
                                />
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-[var(--axon-muted)]">
                              {formatDate(task.created_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              {/* Security Audit Events */}
              <Card title="Security &amp; Admin Audit Trail">
                {auditEntries.length === 0 ? (
                  <EmptyState message="No security actions recorded yet." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--axon-border)] text-[var(--axon-muted)]">
                          <th className="px-4 py-2.5">Time</th>
                          <th className="px-4 py-2.5">Actor</th>
                          <th className="px-4 py-2.5">Action</th>
                          <th className="px-4 py-2.5">Source IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--axon-border)]">
                        {auditEntries.slice(0, 30).map((entry, idx) => (
                          <tr key={idx} className="hover:bg-[var(--axon-card-hover)] transition">
                            <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">
                              {formatDate(entry.time || entry.timestamp || "")}
                            </td>
                            <td className="px-4 py-2.5 font-semibold text-[var(--axon-text)]">
                              @{entry.actor}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[var(--axon-primary)]">
                              {entry.action}
                            </td>
                            <td className="px-4 py-2.5 font-mono text-[var(--axon-muted)]">
                              {entry.ip}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
