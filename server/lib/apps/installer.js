import { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { run } from "../exec.js";
import { audit } from "../audit.js";
import { getApp, TEMPLATES, WORDPRESS_SALT_KEYS } from "../../apps/catalog.js";
import * as mariadb from "../mariadb.js";
import * as postgres from "../postgres.js";
import { loadConfig } from "../../config.js";
import { deleteSite, enableSite, writeSiteValidated } from "../nginx.js";
import { diskUsage } from "../metrics.js";
import { ValidationError } from "../validate.js";

const BINARIES = {
  curl: ["/usr/bin/curl", "/usr/local/bin/curl"],
  unzip: ["/usr/bin/unzip", "/usr/local/bin/unzip"],
  php: ["/usr/bin/php", "/usr/local/bin/php"],
  composer: ["/usr/local/bin/composer", "/usr/bin/composer"],
  npm: ["/usr/bin/npm", "/usr/local/bin/npm"],
  node: ["/usr/bin/node", "/usr/local/bin/node"],
};

// Character set for randomly generated passwords (gitleaks:allow)
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ" + "abcdefghijkmnopqrstuvwxyz" + "23456789";

function generatePassword(length = 24) {
  let out = "";
  for (let index = 0; index < length; index += 1) out += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)];
  return out;
}

function slugify(domain) {
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function findBinary(name) {
  for (const candidate of BINARIES[name] ?? []) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function applyVars(input, vars) {
  return String(input).replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (!(key in vars)) throw new Error(`Internal error: unknown placeholder {{${key}}}`);
    return vars[key] === undefined || vars[key] === null ? "" : String(vars[key]);
  });
}

function availableRamMb() {
  const meminfo = readFileSync("/proc/meminfo", "utf8");
  const match = meminfo.match(/^MemAvailable:\s+(\d+)\s+kB/m);
  return match ? Math.floor(Number(match[1]) / 1024) : 0;
}

async function freeDiskMb() {
  const disks = await diskUsage();
  const root = disks.find((disk) => disk.mount === "/") ?? disks[0];
  return root ? Math.floor(root.available / 1024 / 1024) : 0;
}

async function phpModules() {
  const result = await run("php", ["-m"], { timeout: 15000 });
  if (!result.ok) return null;
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("[")),
  );
}

async function nodeMajor() {
  const result = await run("node", ["-p", "process.versions.node.split('.')[0]"], { timeout: 15000 });
  if (!result.ok) return null;
  return Number(result.stdout.trim());
}

async function headStatus(url) {
  const result = await run(
    "curl",
    ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "-L", "--max-time", "25", "-r", "0-2048", url],
    { timeout: 40000 },
  );
  const code = Number(result.stdout.trim().slice(-3));
  return { ok: result.ok && code >= 200 && code < 400, code, error: result.stderr.trim() };
}

async function resolveGithubRelease(repo, assetPattern) {
  const result = await run(
    "curl",
    ["-sSL", "--max-time", "30", "-H", "Accept: application/vnd.github+json", `https://api.github.com/repos/${repo}/releases/latest`],
    { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (!result.ok) throw new Error(`Could not reach GitHub for ${repo}: ${result.stderr.trim()}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new Error(`GitHub returned an unexpected response for ${repo}`);
  }
  if (parsed.message) throw new Error(`GitHub API: ${parsed.message}`);

  const matcher = new RegExp(assetPattern, "i");
  const asset = (parsed.assets ?? []).find((entry) => matcher.test(entry.name));
  if (!asset) throw new Error(`No release asset matching ${assetPattern} in ${repo} ${parsed.tag_name ?? ""}`);

  return { name: asset.name, url: asset.browser_download_url, size: asset.size, tag: parsed.tag_name };
}

async function resolveAppDownload(app) {
  const spec = app.downloads?.app;
  if (!spec) throw new Error("This app does not define a download source");

  if (spec.from === "github") {
    const asset = await resolveGithubRelease(spec.repo, spec.asset);
    return { url: asset.url, name: asset.name, size: asset.size, label: `${spec.repo} ${asset.tag}` };
  }
  if (spec.from === "github-archive") {
    const url = `https://github.com/${spec.repo}/archive/refs/tags/${spec.tag}.zip`;
    return { url, name: `${spec.repo.replace("/", "-")}-${spec.tag}.zip`, size: 0, label: `${spec.repo} ${spec.tag}` };
  }
  if (spec.type === "composer") {
    return { url: null, label: `composer package ${spec.package}`, composer: spec.package };
  }
  if (spec.type === "node") {
    return { url: null, label: `npm scaffold ${spec.scaffold}`, scaffold: spec.scaffold };
  }
  if (spec.type === "static") {
    return { url: null, label: `static scaffold ${spec.scaffold}`, scaffold: spec.scaffold };
  }
  return { url: spec.url, name: path.basename(new URL(spec.url).pathname), size: 0, label: spec.url };
}

function binariesMissing(requirements) {
  return (requirements.binaries ?? []).filter((name) => !findBinary(name));
}

export async function preflight(app, { includeNetwork = false } = {}) {
  const checks = [];
  const add = (id, label, status, detail, remediation = null) => checks.push({ id, label, status, detail, remediation });
  const requirements = app.requirements ?? {};

  if (app.automated === false) {
    add("automated", "Automated install", "fail", "This application has no unattended installer.", "Use the manual recipe shown below.");
  }

  if (requirements.phpExtensions?.length) {
    const modules = await phpModules();
    if (!modules) {
      add("php", "PHP", "fail", "The php CLI is not available.", "apt-get install -y php8.3-cli");
    } else {
      const missing = requirements.phpExtensions.filter((name) => !modules.has(name.toLowerCase()));
      if (missing.length) {
        add(
          "php-ext",
          "PHP extensions",
          "fail",
          `Missing: ${missing.join(", ")}`,
          `apt-get install -y ${missing.map((name) => `php8.3-${name}`).join(" ")} && systemctl restart php8.3-fpm`,
        );
      } else {
        add("php-ext", "PHP extensions", "ok", `${requirements.phpExtensions.length} required extensions present`);
      }
    }
  }

  const missingBins = binariesMissing(requirements);
  if (missingBins.length) {
    add("binaries", "Required programs", "fail", `Missing: ${missingBins.join(", ")}`, `apt-get install -y ${missingBins.join(" ")}`);
  } else if (requirements.binaries?.length) {
    add("binaries", "Required programs", "ok", requirements.binaries.join(", "));
  }

  if (requirements.nodeMajorMin) {
    const major = await nodeMajor();
    if (major === null) add("node", "Node.js", "fail", "node is not available", "Install Node.js 20 or newer");
    else if (major < requirements.nodeMajorMin) {
      add("node", "Node.js", "fail", `Found v${major}, need v${requirements.nodeMajorMin}+`, "Upgrade Node.js");
    } else {
      add("node", "Node.js", "ok", `v${major}`);
    }
  }

  if (requirements.minFreeRamMb) {
    const available = availableRamMb();
    if (available < requirements.minFreeRamMb) {
      add(
        "ram",
        "Free memory",
        "fail",
        `${available} MB available, ${requirements.minFreeRamMb} MB needed`,
        "Free memory or add RAM before installing this application.",
      );
    } else {
      add("ram", "Free memory", "ok", `${available} MB available`);
    }
  }

  if (requirements.minFreeDiskMb) {
    const free = await freeDiskMb();
    if (free < requirements.minFreeDiskMb) {
      add("disk", "Free disk", "fail", `${free} MB free, ${requirements.minFreeDiskMb} MB needed`, "Free disk space.");
    } else {
      add("disk", "Free disk", "ok", `${free} MB free`);
    }
  }

  if (app.database === "mysql") {
    const reachable = await mariadb.isReachable();
    if (!reachable.ok) add("db", "MariaDB", "fail", reachable.error ?? "Not reachable", "systemctl start mariadb");
    else add("db", "MariaDB", "ok", "Reachable via the local socket");
  }

  if (app.database === "postgres" || requirements.postgres) {
    const clusters = await postgres.listClusters();
    const online = (clusters.clusters ?? []).some((cluster) => cluster.status === "online");
    if (!online) {
      add("db", "PostgreSQL", "fail", "No cluster is running", "Start the cluster from the Databases page");
    } else {
      add("db", "PostgreSQL", "ok", "Cluster online");
    }
  }

  if (requirements.services?.length) {
    add("services", "External services", "fail", `Not installed: ${requirements.services.join(", ")}`, "Install and configure these services first.");
  }

  if (includeNetwork && app.automated !== false) {
    try {
      const download = await resolveAppDownload(app);
      if (download.url) {
        const status = await headStatus(download.url);
        if (status.ok) add("download", "Download source", "ok", `${download.label} (HTTP ${status.code})`);
        else {
          add(
            "download",
            "Download source",
            "fail",
            `${download.label} is unreachable (HTTP ${status.code || "no response"})`,
            "The upstream mirror may be down. Try again later, or install this application manually.",
          );
        }
      } else {
        add("download", "Download source", "ok", download.label);
      }
    } catch (error) {
      add("download", "Download source", "fail", error.message, "The upstream mirror may be down. Try again later.");
    }
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    checks,
  };
}

const jobs = new Map();
const MAX_JOBS = 25;
let activeJobId = null;

function pushJob(job) {
  jobs.set(job.id, job);
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
    if (!oldest || oldest.status === "running") break;
    jobs.delete(oldest.id);
  }
  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function listJobs() {
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function activeJob() {
  return activeJobId ? jobs.get(activeJobId) ?? null : null;
}

async function allocatePort() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const port = 3100 + randomInt(800);
    const free = await new Promise((resolve) => {
      const tester = createServer();
      tester.once("error", () => resolve(false));
      tester.once("listening", () => tester.close(() => resolve(true)));
      tester.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("Could not find a free local port");
}

function phpVhost({ serverNames, docroot, socket }) {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    root ${docroot};
    index index.php index.html index.htm;
    charset utf-8;

    client_max_body_size 128M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    location ~ \\.php$ {
        fastcgi_pass unix:${socket};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
}

function proxyVhost({ serverNames, port }) {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    client_max_body_size 128M;

    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
`;
}

function staticVhost({ serverNames, docroot }) {
  return `server {
    listen 80;
    listen [::]:80;
    server_name ${serverNames};

    root ${docroot};
    index index.html index.htm;
    charset utf-8;

    location / {
        try_files $uri $uri/ /index.html =404;
    }

    location ~* \\.(?:css|js|woff2?|svg|png|jpg|jpeg|gif|ico|webp)$ {
        expires 30d;
        add_header Cache-Control "public, no-transform";
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
}

function moveContents(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    if (existsSync(target)) rmSync(target, { recursive: true, force: true });
    renameSync(source, target);
  }
}

async function sha256Of(file) {
  const hash = createHash("sha256");
  const { createReadStream } = await import("node:fs");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolve)
      .on("error", reject);
  });
  return hash.digest("hex");
}

const handlers = {
  async download(step, ctx) {
    const download = await resolveAppDownload(ctx.app);
    if (!download.url) throw new Error(`No direct download for ${ctx.app.name}`);
    const dest = applyVars(step.dest, ctx.vars);
    mkdirSync(path.dirname(dest), { recursive: true });
    const result = await run(
      "curl",
      ["-fSL", "--retry", "2", "--connect-timeout", "25", "--max-time", "900", "-o", dest, download.url],
      { timeout: 960000 },
    );
    if (!result.ok) throw new Error(`Download failed: ${(result.stderr || "").trim().slice(0, 300)}`);
    const size = statSync(dest).size;
    if (size < 1024) throw new Error("Downloaded file looks empty or truncated");
    ctx.job.steps.at(-1).detail = `${download.label} — ${(size / 1048576).toFixed(1)} MB`;
  },

  async extract(step, ctx) {
    const archive = applyVars(step.archive, ctx.vars);
    const dest = applyVars(step.dest, ctx.vars);
    const tmp = `${dest}-extract-${Date.now()}`;
    mkdirSync(tmp, { recursive: true });

    const unzip = await run("unzip", ["-q", "-o", archive, "-d", tmp], { timeout: 600000 });
    if (!unzip.ok) throw new Error(`Extraction failed: ${(unzip.stderr || "").trim().slice(0, 300)}`);

    let source = tmp;
    if (step.root) {
      source = path.join(tmp, step.root);
      if (!existsSync(source)) throw new Error(`Archive did not contain the expected "${step.root}" directory`);
    } else {
      const entries = readdirSync(tmp).filter((name) => !name.startsWith("__MACOSX"));
      if (entries.length === 1 && statSync(path.join(tmp, entries[0])).isDirectory()) {
        source = path.join(tmp, entries[0]);
      }
    }

    moveContents(source, dest);
    rmSync(tmp, { recursive: true, force: true });
    ctx.created.directory = dest;
  },

  async downloadPlugins(step, ctx) {
    const plugins = ctx.app.downloads?.plugins ?? [];
    if (plugins.length === 0) return;
    const target = path.join(ctx.vars.installDir, "wp-content", "plugins");
    mkdirSync(target, { recursive: true });

    for (const plugin of plugins) {
      const zipPath = path.join(target, `${plugin.name}.zip`);
      const download = await run(
        "curl",
        ["-fSL", "--retry", "2", "--connect-timeout", "25", "--max-time", "600", "-o", zipPath, plugin.url],
        { timeout: 660000 },
      );
      if (!download.ok) throw new Error(`Could not download the ${plugin.name} plugin`);
      const unzip = await run("unzip", ["-q", "-o", zipPath, "-d", target], { timeout: 300000 });
      rmSync(zipPath, { force: true });
      if (!unzip.ok) throw new Error(`Could not unpack the ${plugin.name} plugin`);
    }
    ctx.job.steps.at(-1).detail = `Installed ${plugins.map((plugin) => plugin.name).join(", ")}`;
  },

  async createDatabase(step, ctx) {
    const { dbName } = ctx.vars;
    if (ctx.app.database === "postgres") {
      const result = await postgres.createDatabase(dbName, null);
      if (!result.ok && !/already exists/i.test(result.stderr ?? "")) {
        throw new Error(`Could not create the database: ${(result.stderr || "").trim().slice(0, 300)}`);
      }
      ctx.created.database = { engine: "postgres", name: dbName };
      return;
    }
    const result = await mariadb.createDatabase(dbName);
    if (!result.ok && !/already exists/i.test(result.stderr ?? "")) {
      throw new Error(`Could not create the database: ${(result.stderr || "").trim().slice(0, 300)}`);
    }
    ctx.created.database = { engine: "mysql", name: dbName };
  },

  async createDatabaseUser(step, ctx) {
    const { dbName, dbUser, dbPassword } = ctx.vars;
    if (ctx.app.database === "postgres") {
      await postgres.createRole({ name: dbUser, password: dbPassword, canLogin: true, createDb: false, superuser: false });
      const grant = await postgres.grantDatabase(dbName, dbUser);
      if (!grant.ok) throw new Error(`Could not grant privileges: ${(grant.stderr || "").trim().slice(0, 300)}`);
      ctx.created.databaseUser = dbUser;
      return;
    }
    const result = await mariadb.createUser(dbUser, "localhost", dbPassword, [
      { database: dbName, privileges: "ALL PRIVILEGES" },
    ]);
    if (!result.ok) throw new Error(`Could not create the database user: ${(result.stderr || "").trim().slice(0, 300)}`);
    ctx.created.databaseUser = dbUser;
  },

  async writeFile(step, ctx) {
    const target = applyVars(step.path, ctx.vars);
    const template = TEMPLATES[step.template];
    if (!template) throw new Error(`Unknown configuration template ${step.template}`);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, applyVars(template, ctx.vars), { mode: step.mode ? Number.parseInt(step.mode, 8) : 0o640 });
    if (step.mode) chmodSync(target, Number.parseInt(step.mode, 8));
    ctx.created.files = [...(ctx.created.files ?? []), target];
  },

  async chown(step, ctx) {
    const target = applyVars(step.path, ctx.vars);
    const ownerSpec = String(step.owner);
    const args = step.recursive === false ? [ownerSpec, target] : ["-R", ownerSpec, target];
    const result = await run("chown", args, { timeout: 300000 });
    if (!result.ok) throw new Error(`chown failed: ${(result.stderr || "").trim().slice(0, 200)}`);
  },

  async createSite(step, ctx) {
    const docroot = ctx.vars.docroot;
    if (!existsSync(docroot)) mkdirSync(docroot, { recursive: true, mode: 0o755 });
    const content = phpVhost({
      serverNames: ctx.vars.serverNames,
      docroot,
      socket: ctx.vars.socket,
    });
    const result = await writeSiteValidated(ctx.vars.siteName, content);
    if (!result.ok) throw new Error(`nginx rejected the generated vhost:\n${result.error}`);
    const enabled = await enableSite(ctx.vars.siteName);
    if (!enabled.ok) throw new Error(enabled.error);
    ctx.created.site = ctx.vars.siteName;
  },

  async createProxySite(step, ctx) {
    const content = proxyVhost({ serverNames: ctx.vars.serverNames, port: ctx.vars.port });
    const result = await writeSiteValidated(ctx.vars.siteName, content);
    if (!result.ok) throw new Error(`nginx rejected the generated vhost:\n${result.error}`);
    const enabled = await enableSite(ctx.vars.siteName);
    if (!enabled.ok) throw new Error(enabled.error);
    ctx.created.site = ctx.vars.siteName;
  },

  async createStaticSite(step, ctx) {
    const docroot = ctx.vars.docroot;
    if (!existsSync(docroot)) mkdirSync(docroot, { recursive: true, mode: 0o755 });
    const content = staticVhost({ serverNames: ctx.vars.serverNames, docroot });
    const result = await writeSiteValidated(ctx.vars.siteName, content);
    if (!result.ok) throw new Error(`nginx rejected the generated vhost:\n${result.error}`);
    const enabled = await enableSite(ctx.vars.siteName);
    if (!enabled.ok) throw new Error(enabled.error);
    ctx.created.site = ctx.vars.siteName;
  },

  async pm2Start(step, ctx) {
    const name = applyVars(step.name, ctx.vars);
    const script = applyVars(step.script, ctx.vars);
    const cwd = applyVars(step.cwd, ctx.vars);
    const port = ctx.vars.port;
    const args = step.args ? step.args.map((a) => applyVars(a, ctx.vars)) : [];

    const pm2Args = ["start", script, "--name", name, "--cwd", cwd];
    if (args.length) pm2Args.push("--", ...args);

    const pm2Env = {
      PORT: String(port),
      NODE_ENV: "production",
      ...(step.env || {}),
    };

    const result = await run("pm2", pm2Args, { timeout: 30000, env: pm2Env });
    if (!result.ok) throw new Error(`PM2 process start failed: ${result.stderr || result.stdout}`);
    await run("pm2", ["save"], { timeout: 10000 });
    ctx.created.pm2 = name;
    ctx.job.steps.at(-1).detail = `Started process ${name} on port ${port}`;
  },

  async requestCertificate(step, ctx) {
    const domain = ctx.vars.domain;
    const { promises: dns } = await import("node:dns");

    let resolves = false;
    try {
      const records = await dns.resolve4(domain);
      resolves = records.length > 0;
    } catch {
      try {
        resolves = (await dns.resolve6(domain)).length > 0;
      } catch {
        resolves = false;
      }
    }

    if (!resolves) {
      ctx.vars.siteUrl = `http://${domain}`;
      ctx.job.steps.at(-1).detail = `${domain} does not resolve yet — site will run over http until you issue a certificate on the SSL page`;
      return;
    }

    const result = await run(
      "certbot",
      ["--nginx", "-d", domain, "--non-interactive", "--agree-tos", "-m", ctx.vars.certbotEmail, "--keep-until-expiring", "--redirect"],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
    );

    if (result.ok) {
      ctx.vars.siteUrl = `https://${domain}`;
      ctx.created.certificate = domain;
      ctx.job.steps.at(-1).detail = `Let's Encrypt certificate issued for ${domain}`;
    } else {
      ctx.vars.siteUrl = `http://${domain}`;
      const detail = `${result.stderr}\n${result.stdout}`
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("Saving debug log"))
        .slice(-2)
        .join(" ");
      ctx.job.steps.at(-1).detail = `Certificate not issued (${detail.slice(0, 200)}) — running over http for now`;
    }
  },

  async downloadWpCli(step, ctx) {
    const spec = ctx.app.downloads.wpCli;
    const asset = await resolveGithubRelease(spec.repo, spec.asset);
    const target = `${ctx.vars.tmpDir}/wp-cli.phar`;
    const result = await run(
      "curl",
      ["-fSL", "--retry", "2", "--max-time", "300", "-o", target, asset.url],
      { timeout: 360000 },
    );
    if (!result.ok) throw new Error("Could not download wp-cli");

    let verified = "checksum not published";
    if (spec.checksumAsset) {
      const checksumAsset = await resolveGithubRelease(spec.repo, spec.checksumAsset);
      const checksumResult = await run("curl", ["-fSL", "--max-time", "120", "-o", `${target}.sha256`, checksumAsset.url], {
        timeout: 180000,
      });
      if (checksumResult.ok) {
        const expected = readFileSync(`${target}.sha256`, "utf8").trim().split(/\s+/)[0].toLowerCase();
        const actual = await sha256Of(target);
        if (expected !== actual) throw new Error("wp-cli checksum verification failed — refusing to continue");
        verified = `sha256 ${actual.slice(0, 16)}… verified`;
      }
    }
    chmodSync(target, 0o755);
    ctx.vars.wpCliPath = target;
    ctx.job.steps.at(-1).detail = `${asset.name} — ${verified}`;
  },

  async run(step, ctx) {
    const args = step.args.map((arg) => applyVars(arg, ctx.vars));
    const cwd = step.cwd ? applyVars(step.cwd, ctx.vars) : undefined;
    const result = await run(applyVars(step.bin, ctx.vars), args, {
      timeout: step.timeoutMs ?? 600000,
      cwd,
      env: step.env,
      maxBuffer: 32 * 1024 * 1024,
    });
    if (!result.ok) {
      const detail = `${result.stderr}\n${result.stdout}`.trim().split("\n").slice(-6).join("\n");
      throw new Error(`${step.label ?? step.bin} failed:\n${detail.slice(0, 600)}`);
    }
  },

  async ensurePostgres(step, ctx) {
    const clusters = await postgres.listClusters();
    if (!(clusters.clusters ?? []).some((cluster) => cluster.status === "online")) {
      throw new Error("PostgreSQL is not running. Start the cluster from the Databases page and try again.");
    }
  },
};

function labelFor(step) {
  switch (step.type) {
    case "download": return "Downloading the application";
    case "extract": return "Unpacking files";
    case "downloadPlugins": return "Downloading plugins";
    case "createDatabase": return "Creating the database";
    case "createDatabaseUser": return "Creating the database user";
    case "writeFile": return `Writing ${path.basename(step.path)}`;
    case "chown": return "Setting file ownership";
    case "createSite": return "Creating the nginx site";
    case "createProxySite": return "Creating the nginx proxy site";
    case "createStaticSite": return "Creating the nginx static site";
    case "pm2Start": return `Starting ${step.name ?? "app"} via PM2`;
    case "requestCertificate": return "Requesting a Let's Encrypt certificate";
    case "downloadWpCli": return "Fetching wp-cli and verifying its checksum";
    case "run": return step.label ?? `Running ${step.bin}`;
    case "ensurePostgres": return "Checking PostgreSQL";
    default: return step.type;
  }
}

export function buildVars(app, options, jobId) {
  const config = loadConfig();
  const domain = options.domain;
  const slug = slugify(domain);
  const installDir = path.join("/var/www", domain);
  const docroot = app.docrootSuffix ? `${installDir}${app.docrootSuffix}` : installDir;

  return {
    domain,
    slug,
    siteName: domain,
    serverNames: [domain, ...(options.aliases ?? [])].join(" "),
    installDir,
    docroot,
    siteUrl: options.siteUrl ?? `https://${domain}`,
    siteTitle: options.siteTitle ?? app.name,
    dbName: `${slug}_db`,
    dbUser: `${slug}_usr`,
    dbPassword: generatePassword(28),
    pgUser: `${slug}_usr`,
    pgPassword: generatePassword(28),
    adminUser: options.adminUser ?? "admin",
    adminPassword: generatePassword(20),
    adminEmail: options.adminEmail ?? config.letsencryptEmail,
    certbotEmail: config.letsencryptEmail,
    appSecret: randomBytes(32).toString("base64url"),
    appKey: `base64:${randomBytes(32).toString("base64")}`,
    instanceId: randomBytes(16).toString("hex"),
    tmpDir: `${config.backupDir}/apptmp-${jobId}`,
    socket: config.phpFpmSocket,
    port: options.port ?? 0,
    wpCliPath: "",
    salts: WORDPRESS_SALT_KEYS.map((key) => `define('${key}', '${randomBytes(32).toString("base64url")}');`).join("\n"),
  };
}

async function rollback(ctx, job) {
  const step = { label: "Rolling back partial changes", status: "running" };
  job.steps.push(step);

  const notes = [];
  try {
    if (ctx.created.site) {
      deleteSite(ctx.created.site);
      notes.push(`removed nginx site ${ctx.created.site}`);
    }
    if (ctx.created.pm2) {
      await run("pm2", ["delete", ctx.created.pm2], { timeout: 10000 });
      await run("pm2", ["save"], { timeout: 10000 });
      notes.push(`stopped PM2 process ${ctx.created.pm2}`);
    }
    if (ctx.created.directory) {
      rmSync(ctx.created.directory, { recursive: true, force: true });
      notes.push(`removed ${ctx.created.directory}`);
    }
    if (ctx.created.databaseUser) {
      if (ctx.created.database?.engine === "postgres") await postgres.dropRole(ctx.created.databaseUser);
      else await mariadb.dropUser(ctx.created.databaseUser, "localhost");
      notes.push(`dropped database user ${ctx.created.databaseUser}`);
    }
    if (ctx.created.database) {
      if (ctx.created.database.engine === "postgres") await postgres.dropDatabase(ctx.created.database.name);
      else await mariadb.dropDatabase(ctx.created.database.name);
      notes.push(`dropped database ${ctx.created.database.name}`);
    }
    if (ctx.vars.tmpDir && existsSync(ctx.vars.tmpDir)) {
      rmSync(ctx.vars.tmpDir, { recursive: true, force: true });
    }
    step.status = "done";
    step.detail = notes.length ? notes.join(", ") : "nothing to undo";
  } catch (error) {
    step.status = "failed";
    step.detail = `cleanup incomplete: ${error.message}`;
  }
}

async function execute(app, job, options, actor, ip) {
  const vars = buildVars(app, options, job.id);
  if (app.portSource) vars.port = options.port ?? (await allocatePort());

  const ctx = { app, job, vars, created: {} };
  job.vars = {
    installDir: vars.installDir,
    docroot: vars.docroot,
    database: vars.dbName,
    databaseUser: vars.dbUser,
    databasePassword: vars.dbPassword,
    adminUser: vars.adminUser,
    adminPassword: vars.adminPassword,
    port: app.portSource ? vars.port : undefined,
  };

  job.status = "running";
  mkdirSync(vars.tmpDir, { recursive: true, mode: 0o700 });

  try {
    for (const step of app.plan) {
      const entry = { label: labelFor(step), status: "running", detail: null, startedAt: new Date().toISOString() };
      job.steps.push(entry);
      job.currentStep = entry.label;
      try {
        await handlers[step.type](step, ctx);
        entry.status = "done";
      } catch (error) {
        if (step.optional) {
          entry.status = "skipped";
          entry.detail = `Skipped: ${error.message.split("\n")[0].slice(0, 200)}`;
        } else {
          entry.status = "failed";
          entry.detail = error.message.slice(0, 1200);
          throw error;
        }
      } finally {
        entry.endedAt = new Date().toISOString();
      }
    }

    rmSync(vars.tmpDir, { recursive: true, force: true });
    job.status = "success";
    job.finishedAt = new Date().toISOString();
    job.result = {
      url: vars.siteUrl,
      domain: vars.domain,
      installDir: vars.installDir,
      finishMode: app.finishMode,
      finishUrl: `${vars.siteUrl}${app.finishPath ?? "/"}`,
      adminUrl: `${vars.siteUrl}${app.adminPath ?? "/"}`,
      credentials: {
        database: vars.dbName,
        databaseUser: vars.dbUser,
        databasePassword: vars.dbPassword,
        adminUser: vars.adminUser,
        adminPassword: vars.adminPassword,
      },
    };
    audit({ action: "app.install", actor, ip, params: { app: app.id, domain: vars.domain }, result: "ok" });
  } catch (error) {
    await rollback(ctx, job);
    job.status = "failed";
    job.error = error.message.slice(0, 2000);
    job.finishedAt = new Date().toISOString();
    audit({ action: "app.install", actor, ip, params: { app: app.id, domain: vars.domain }, result: "error", detail: job.error });
    throw error;
  } finally {
    if (activeJobId === job.id) activeJobId = null;
    job.currentStep = null;
  }
}

export async function startInstall(appId, options, actor, ip) {
  const app = getApp(appId);
  if (!app) {
    const error = new Error(`Unknown application: ${appId}`);
    error.status = 404;
    throw error;
  }
  if (app.automated === false) {
    throw new ValidationError(
      `${app.name} cannot be installed unattended because its official scaffolder is interactive. Use the manual recipe instead.`,
    );
  }
  if (!options.domain) throw new ValidationError("A domain is required");

  const running = activeJob();
  if (running && running.status === "running") {
    const error = new Error(`Another installation (${running.appName}) is already running. Wait for it to finish.`);
    error.status = 409;
    throw error;
  }

  if (existsSync(path.join("/var/www", options.domain))) {
    throw new ValidationError(`/var/www/${options.domain} already exists — choose another domain or remove it first.`);
  }

  const check = await preflight(app, { includeNetwork: true });
  if (!check.ok) {
    const failed = check.checks.filter((item) => item.status === "fail");
    throw new ValidationError(
      `Requirements not met:\n${failed.map((item) => `• ${item.label}: ${item.detail}`).join("\n")}`,
    );
  }

  const job = pushJob({
    id: randomBytes(8).toString("hex"),
    appId: app.id,
    appName: app.name,
    status: "queued",
    steps: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    result: null,
    currentStep: null,
  });

  activeJobId = job.id;
  execute(app, job, options, actor, ip).catch(() => {});
  return job;
}
