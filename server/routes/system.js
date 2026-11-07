import { Router } from "express";
import { collect } from "../lib/metrics.js";
import { run } from "../lib/exec.js";
import { listPm2 } from "../lib/pm2.js";
import { listCertificates } from "../lib/certbot.js";
import { unitStates, unitEnabledStates } from "../lib/systemd.js";
import { loadConfig } from "../config.js";
import { hasPermission } from "../lib/rbac.js";

const router = Router();

const WATCHED_UNITS = [
  "nginx.service",
  "mariadb.service",
  "postgresql.service",
  "redis-server.service",
  "php8.3-fpm.service",
  "pm2-root.service",
  "fail2ban.service",
  "axon-panel.service",
];

let overviewCache = { at: 0, data: null };
const OVERVIEW_TTL_MS = 15000;

router.get("/metrics", async (req, res, next) => {
  try {
    if (!hasPermission(req.actor?.role, "server:metrics_view")) {
      return res.status(403).json({ error: "Access denied: your role does not have permission to view server hardware metrics." });
    }
    res.json(await collect());
  } catch (error) {
    next(error);
  }
});

router.get("/overview", async (req, res, next) => {
  try {
    const role = req.actor?.role;
    const canSeeHealth = hasPermission(role, "server:health_view");
    const canSeeMetrics = hasPermission(role, "server:metrics_view");
    const canSeeServices = hasPermission(role, "server:services_view");
    const canSeeResources = hasPermission(role, "server:resources_view");

    if (!canSeeHealth && !canSeeMetrics) {
      return res.json({
        metrics: null,
        services: [],
        pm2: [],
        pm2Error: null,
        certificates: { total: 0, expiring: [], error: null },
        databases: { mariadb: { reachable: true, count: 0 }, postgres: { clusters: [], online: 0, total: 0 } },
        backups: "",
        restricted: true,
        at: new Date().toISOString(),
      });
    }

    if (overviewCache.data && Date.now() - overviewCache.at < OVERVIEW_TTL_MS) {
      const cached = { ...overviewCache.data, cached: true };
      if (!canSeeServices) {
        cached.services = [];
        cached.pm2 = [];
      }
      if (!canSeeMetrics) {
        cached.metrics = null;
      } else if (!canSeeResources && cached.metrics) {
        cached.metrics = { ...cached.metrics, disks: [] };
      }
      return res.json(cached);
    }

    const [metrics, states, enabled, pm2, certs, clusters, mariadbCount] = await Promise.all([
      canSeeMetrics ? collect() : Promise.resolve(null),
      canSeeServices ? unitStates(WATCHED_UNITS) : Promise.resolve({}),
      canSeeServices ? unitEnabledStates(WATCHED_UNITS) : Promise.resolve({}),
      canSeeServices ? listPm2() : Promise.resolve({ ok: true, apps: [] }),
      listCertificates(),
      run("pg_lsclusters", ["-h"], { timeout: 10000 }),
      run("mysql", ["--batch", "--skip-column-names", "-e", "SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN ('information_schema','mysql','performance_schema','sys')"], { timeout: 15000 }),
    ]);

    const services = canSeeServices
      ? WATCHED_UNITS.map((unit) => ({
          unit,
          active: states[unit] || "unknown",
          enabled: enabled[unit] || "unknown",
        }))
      : [];

    const expiringCerts = certs.certificates
      .filter((c) => c.daysRemaining !== null && c.daysRemaining <= 30)
      .sort((a, b) => a.daysRemaining - b.daysRemaining);

    const safeMetrics = metrics
      ? canSeeResources
        ? metrics
        : { ...metrics, disks: [] }
      : null;

    const data = {
      metrics: safeMetrics,
      services,
      pm2: pm2.apps || [],
      pm2Error: pm2.ok ? null : pm2.error,
      certificates: {
        total: certs.certificates.length,
        expiring: expiringCerts,
        error: certs.ok ? null : certs.error,
      },
      databases: {
        mariadb: {
          reachable: mariadbCount.ok,
          count: mariadbCount.ok ? Number(mariadbCount.stdout.trim()) || 0 : 0,
        },
        postgres: parseClusters(clusters.ok ? clusters.stdout : ""),
      },
      backups: loadConfig().backupDir,
      about: {
        name: "Axon Panel",
        organization: "AxonWP",
        organizationUrl: "https://axonwp.com",
        author: "Afroz Hasan",
        authorUrl: "https://afroz.me",
      },
      at: new Date().toISOString(),
    };

    overviewCache = { at: Date.now(), data };
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

function parseClusters(stdout) {
  const clusters = stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      return { version: cols[0], name: cols[1], port: Number(cols[2]), status: cols[3], owner: cols[4], dataDir: cols[5], logFile: cols[6] };
    });
  const online = clusters.filter((c) => c.status === "online").length;
  return { clusters, online, total: clusters.length };
}

export default router;
