import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { getDb, closeDb } from "./lib/db.js";
import { startWorker, stopWorker } from "./lib/worker.js";
import { initWorkerHandlers } from "./lib/worker-handlers.js";
import { requireAuth, requireCsrf, requireIpAllowlist } from "./middleware/auth.js";
import { attachTerminal, terminalBackend } from "./lib/terminal.js";
import authRoutes from "./routes/auth.js";
import systemRoutes from "./routes/system.js";
import serviceRoutes from "./routes/services.js";
import siteRoutes from "./routes/sites.js";
import sslRoutes from "./routes/ssl.js";
import appRoutes from "./routes/apps.js";
import databaseRoutes from "./routes/databases.js";
import fileRoutes from "./routes/files.js";
import logRoutes from "./routes/logs.js";
import settingsRoutes from "./routes/settings.js";
import phpRoutes from "./routes/php.js";
import webserverRoutes from "./routes/webserver.js";
import dnsRoutes from "./routes/dns.js";
import cronRoutes from "./routes/cron.js";
import securityRoutes from "./routes/security.js";
import taskRoutes from "./routes/tasks.js";
import backupRoutes from "./routes/backups.js";
import userRoutes from "./routes/users.js";
import planRoutes from "./routes/plans.js";
import domainRoutes from "./routes/domains.js";
import astroRoutes from "./routes/astro.js";
import wpRoutes from "./routes/wp.js";
import notificationRoutes from "./routes/notifications.js";
import { runAlertChecks, checkDailyReportDue } from "./lib/notifications.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(here, "..", "dist");

const config = loadConfig();
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", "loopback");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 15552000, includeSubDomains: true },
  }),
);

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/api", requireIpAllowlist);

const guarded = express.Router();
guarded.use(requireAuth, requireCsrf);
guarded.use("/system", systemRoutes);
guarded.use("/services", serviceRoutes);
guarded.use("/sites", siteRoutes);
guarded.use("/php", phpRoutes);
guarded.use("/webserver", webserverRoutes);
guarded.use("/dns", dnsRoutes);
guarded.use("/cron", cronRoutes);
guarded.use("/security", securityRoutes);
guarded.use("/ssl", sslRoutes);
guarded.use("/apps", appRoutes);
guarded.use("/databases", databaseRoutes);
guarded.use("/files", fileRoutes);
guarded.use("/logs", logRoutes);
guarded.use("/settings", settingsRoutes);
guarded.use("/tasks", taskRoutes);
guarded.use("/backups", backupRoutes);
guarded.use("/users", userRoutes);
guarded.use("/plans", planRoutes);
guarded.use("/domains", domainRoutes);
guarded.use("/astro", astroRoutes);
guarded.use("/wp", wpRoutes);
guarded.use("/notifications", notificationRoutes);

// Public Git Automated Push Webhook (GitHub, GitLab, Bitbucket)
app.post(["/api/sites/:name/git/webhook", "/api/v1/sites/:name/deploy"], express.json(), async (req, res) => {
  try {
    const { readSite } = await import("./lib/nginx.js");
    const { run } = await import("./lib/exec.js");
    const { enqueueTask } = await import("./lib/queue.js");
    const name = req.params.name;
    const site = readSite(name);
    if (!site) return res.status(404).json({ error: "Site not found" });

    const root = site.summary?.roots?.[0];
    const docroot = (root && (root.endsWith("/public") || root.endsWith("/dist")))
      ? path.dirname(root)
      : (root || path.join("/var/www", name));

    if (!existsSync(path.join(docroot, ".git"))) {
      return res.status(400).json({ error: "No git repository initialized in site root" });
    }

    const branchRes = await run("git", ["-C", docroot, "branch", "--show-current"]);
    const branch = branchRes.stdout.trim() || "main";

    const pullRes = await run("git", ["-C", docroot, "pull", "origin", branch], { timeout: 120000 });
    await run("chown", ["-R", "www-data:www-data", docroot]).catch(() => {});

    let buildTask = null;
    if (existsSync(path.join(docroot, "package.json"))) {
      buildTask = enqueueTask({
        taskType: "app.build",
        payload: { siteName: name, docroot },
        userId: null,
      });
    }

    res.json({ ok: true, output: pullRes.stdout, branch, buildTask });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Mount versioned API v1 first (so /api/v1 isn't captured by /api prefix)
const v1 = express.Router();
v1.use("/auth", authRoutes);
v1.use(guarded);
app.use("/api/v1", v1);

// Mount unversioned /api for existing frontend clients and scripts
app.use("/api/auth", authRoutes);
app.use("/api", guarded);

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Unknown API endpoint" });
});

if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR, { index: false, maxAge: "1h" }));
  app.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || req.path.startsWith("/api")) return next();
    return res.sendFile(path.join(DIST_DIR, "index.html"));
  });
} else {
  app.use((_req, res) => {
    res
      .status(503)
      .type("text/plain")
      .send("The panel UI has not been built yet.\n\nRun:  npm run build\n");
  });
}

app.use((error, _req, res, _next) => {
  if (error?.name === "ValidationError") {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (error?.name === "ExecError") {
    return res.status(500).json({ error: error.message });
  }
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: `File exceeds the ${config.maxUploadMb} MB upload limit` });
  }
  if (error?.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("[axon-panel] unhandled error:", error);
  return res.status(500).json({ error: error?.message || "Internal server error" });
});

const server = createServer(app);
attachTerminal(server);

let alertCheckTimer = null;
let dailyReportTimer = null;

server.listen(config.port, config.host, () => {
  // Initialize SQLite database and bootstrap tables/admin
  getDb();
  // Register background task handlers and start worker
  initWorkerHandlers();
  startWorker();

  // Periodic alert check: every 3 minutes
  alertCheckTimer = setInterval(() => {
    runAlertChecks().catch((err) => console.error("[axon-alerts] periodic check error:", err));
  }, 3 * 60 * 1000);

  // Daily report schedule check: every 60 seconds
  dailyReportTimer = setInterval(() => {
    checkDailyReportDue().catch((err) => console.error("[axon-alerts] daily report check error:", err));
  }, 60 * 1000);

  // Run initial check after 10s warmup
  setTimeout(() => {
    runAlertChecks().catch(() => {});
    checkDailyReportDue().catch(() => {});
  }, 10000).unref();

  const banner = [
    "",
    "  Axon Panel is listening",
    "  by AxonWP (https://axonwp.com) — Developed by Afroz Hasan (https://afroz.me)",
    `  address      http://${config.host}:${config.port}`,
    `  public URL   https://${config.panelDomain}`,
    `  terminal     ${terminalBackend}`,
    `  backups      ${config.backupDir}`,
    "  database     SQLite (WAL mode enabled)",
    "  task worker  active (bounded concurrency)",
    "",
  ].join("\n");

  console.log(banner);
  if (!config.passwordHash) {
    console.warn("[axon] No admin password is set. Run install.sh to initialise the panel.\n");
  }
});

function shutdown(signal) {
  console.log(`[axon] received ${signal}, shutting down`);
  if (alertCheckTimer) clearInterval(alertCheckTimer);
  if (dailyReportTimer) clearInterval(dailyReportTimer);
  stopWorker();
  closeDb();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
