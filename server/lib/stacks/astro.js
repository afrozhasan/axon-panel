import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, rmSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { run } from "../exec.js";
import { allocatePort } from "../ports.js";
import { getDb } from "../db.js";
import { readSite, writeSiteValidated, reloadNginx, enableSite } from "../nginx.js";
import { createDatabase, createUser } from "../mariadb.js";
import { loadConfig } from "../../config.js";
import { renderTemplate } from "../../templates/index.js";

export const ASTRO_TEMPLATES = [
  {
    id: "starter",
    name: "Clean Astro Starter",
    description: "Lightweight, blazing fast Astro foundation with modern responsive layout.",
    category: "minimal",
  },
  {
    id: "blog",
    name: "Content Collections Blog",
    description: "Markdown & MDX powered publishing with type-safe schema validation.",
    category: "content",
  },
  {
    id: "portfolio",
    name: "Agency & Portfolio",
    description: "Showcase case studies, dynamic project grids, and lead forms.",
    category: "showcase",
  },
  {
    id: "ecommerce",
    name: "E-Commerce Storefront",
    description: "Headless catalog with product routing, cart state, and checkout hooks.",
    category: "commerce",
  },
  {
    id: "custom_git",
    name: "Existing GitHub Repository",
    description: "Clone and deploy your own Astro project from GitHub with automated webhooks.",
    category: "custom",
  },
];

export const HEADLESS_CMS_PRESETS = [
  {
    id: "none",
    name: "No CMS (Standalone)",
    tagline: "Static or SSR Astro site without an external CMS backend",
    port: null,
    backendRequired: false,
    minRamMb: 0,
  },
  {
    id: "wordpress",
    name: "WordPress Headless",
    tagline: "PHP-FPM, MariaDB, WP REST API & optional WPGraphQL",
    port: null,
    backendRequired: true,
    minRamMb: 128,
  },
  {
    id: "directus",
    name: "Directus Headless CMS",
    tagline: "Instant TypeScript REST & GraphQL data platform on Node.js",
    port: 8055,
    backendRequired: true,
    minRamMb: 512,
  },
  {
    id: "decap",
    name: "Decap CMS (Git-based)",
    tagline: "In-repo single-page admin committing directly to your Git repository",
    port: null,
    backendRequired: false,
    minRamMb: 0,
  },
];

export function isAstro(docroot) {
  if (!docroot || !existsSync(docroot)) return false;
  const pkgPath = path.join(docroot, "package.json");
  if (!existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return "astro" in deps;
  } catch {
    return false;
  }
}

export async function getAstroOverview(docroot) {
  if (!isAstro(docroot)) {
    return { installed: false };
  }

  const pkgPath = path.join(docroot, "package.json");
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {}

  const hasNodeAdapter = Boolean(pkg.dependencies?.["@astrojs/node"] || pkg.devDependencies?.["@astrojs/node"]);
  const mode = hasNodeAdapter ? "ssr" : "static";

  const envPath = path.join(docroot, ".env");
  const envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

  const distExists = existsSync(path.join(docroot, "dist"));

  return {
    installed: true,
    name: pkg.name || "Astro Application",
    mode,
    hasNodeAdapter,
    distExists,
    scripts: pkg.scripts || {},
    envVars: parseEnv(envContent),
  };
}

function parseEnv(content) {
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx > 0) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      vars[key] = val;
    }
  }
  return vars;
}

export async function preflightAstroResources({ cmsType, outputMode, frontendDomain, backendDomain }) {
  const checks = [];

  // 1. RAM Check
  const meminfo = readFileSync("/proc/meminfo", "utf8");
  const memAvailableMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
  const freeRamMb = memAvailableMatch ? Math.round(Number(memAvailableMatch[1]) / 1024) : 512;

  let minRamNeeded = 100;
  if (cmsType === "directus") minRamNeeded = 512;
  else if (cmsType === "wordpress") minRamNeeded = 250;

  if (freeRamMb < minRamNeeded) {
    checks.push({
      id: "ram",
      name: "Available Memory",
      status: "fail",
      detail: `${freeRamMb} MB available, but ${minRamNeeded} MB recommended for ${cmsType || "Astro"}.`,
      blocker: cmsType === "directus",
    });
  } else {
    checks.push({
      id: "ram",
      name: "Available Memory",
      status: "ok",
      detail: `${freeRamMb} MB available (Minimum ${minRamNeeded} MB met).`,
      blocker: false,
    });
  }

  // 2. Disk Space Check
  const dfRes = await run("df", ["-m", "/var/www"]);
  let freeDiskMb = 5000;
  if (dfRes.ok) {
    const lines = dfRes.stdout.trim().split("\n");
    if (lines.length > 1) {
      const cols = lines[1].split(/\s+/);
      freeDiskMb = Number(cols[3]) || 5000;
    }
  }
  checks.push({
    id: "disk",
    name: "Free Disk Space",
    status: freeDiskMb >= 1000 ? "ok" : "warn",
    detail: `${freeDiskMb} MB free on /var/www.`,
    blocker: freeDiskMb < 300,
  });

  // 3. Node.js & Package Managers
  const [nodeRes, npmRes] = await Promise.all([
    run("node", ["-v"]),
    run("npm", ["-v"]),
  ]);
  checks.push({
    id: "node",
    name: "Node.js Runtime",
    status: nodeRes.ok ? "ok" : "fail",
    detail: nodeRes.ok ? `Node ${nodeRes.stdout.trim()} & npm ${npmRes.stdout.trim()}` : "Node.js is not installed",
    blocker: !nodeRes.ok,
  });

  // 4. PHP & MariaDB if WordPress selected
  if (cmsType === "wordpress") {
    const [phpRes, mysqlRes] = await Promise.all([
      run("php", ["-v"]),
      run("mysql", ["--version"]),
    ]);
    checks.push({
      id: "php_mysql",
      name: "PHP-FPM & MariaDB",
      status: phpRes.ok && mysqlRes.ok ? "ok" : "fail",
      detail: phpRes.ok && mysqlRes.ok ? "PHP and MariaDB online" : "Required PHP or MariaDB service missing",
      blocker: !(phpRes.ok && mysqlRes.ok),
    });
  }

  // 5. Domain Uniqueness
  const db = getDb();
  const fCheck = db.prepare("SELECT domain FROM domains WHERE domain = ?").get(frontendDomain);
  if (fCheck) {
    checks.push({
      id: "domain_frontend",
      name: "Frontend Domain",
      status: "fail",
      detail: `Domain "${frontendDomain}" is already in use on this server.`,
      blocker: true,
    });
  } else {
    checks.push({
      id: "domain_frontend",
      name: "Frontend Domain",
      status: "ok",
      detail: `Domain "${frontendDomain}" is available.`,
      blocker: false,
    });
  }

  if (backendDomain) {
    const bCheck = db.prepare("SELECT domain FROM domains WHERE domain = ?").get(backendDomain);
    if (bCheck) {
      checks.push({
        id: "domain_backend",
        name: "Backend Domain",
        status: "fail",
        detail: `Domain "${backendDomain}" is already in use on this server.`,
        blocker: true,
      });
    } else {
      checks.push({
        id: "domain_backend",
        name: "Backend Domain",
        status: "ok",
        detail: `Domain "${backendDomain}" is available.`,
        blocker: false,
      });
    }
  }

  return {
    ok: checks.every((c) => !c.blocker),
    checks,
    freeRamMb,
    freeDiskMb,
  };
}

export function buildSystemdUnitContent({ siteName, docroot, port, env = {} }) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join("\n");

  return `[Unit]
Description=Axon Panel Astro SSR App: ${siteName}
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${docroot}
Environment="NODE_ENV=production"
Environment="HOST=127.0.0.1"
Environment="PORT=${port}"
${envLines}
ExecStart=/usr/bin/node dist/server/entry.mjs
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`;
}

export function buildDirectusSystemdUnit({ siteName, docroot, port }) {
  return `[Unit]
Description=Axon Panel Directus CMS: ${siteName}
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${docroot}
Environment="NODE_ENV=production"
ExecStart=/usr/bin/npx directus start
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`;
}

export const LUMOS_CSS = `/* Lumos for Astro - Verified Component & Styling Framework */
/* Official repository: lumosframework/lumos-for-astro */
:root {
  --lumos-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --lumos-color-primary: #14CFC4;
  --lumos-color-primary-hover: #0DADA5;
  --lumos-color-bg: #080F19;
  --lumos-color-surface: #111D2A;
  --lumos-color-border: #223244;
  --lumos-color-text: #F1F5F9;
  --lumos-color-muted: #94A3B8;
  --lumos-space-xs: 0.5rem;
  --lumos-space-sm: 0.75rem;
  --lumos-space-md: 1.25rem;
  --lumos-space-lg: 2rem;
  --lumos-space-xl: 3.5rem;
  --lumos-radius-sm: 6px;
  --lumos-radius-md: 12px;
  --lumos-radius-lg: 20px;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: var(--lumos-font-family);
  background-color: var(--lumos-color-bg);
  color: var(--lumos-color-text);
  line-height: 1.6;
}
.lumos-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: var(--lumos-space-lg) var(--lumos-space-md);
}
.lumos-card {
  background: var(--lumos-color-surface);
  border: 1px solid var(--lumos-color-border);
  border-radius: var(--lumos-radius-md);
  padding: var(--lumos-space-md);
  transition: transform 0.2s ease, border-color 0.2s ease;
}
.lumos-card:hover {
  transform: translateY(-2px);
  border-color: var(--lumos-color-primary);
}
.lumos-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.25rem 0.75rem;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  background: rgba(20, 207, 196, 0.12);
  color: var(--lumos-color-primary);
  border: 1px solid rgba(20, 207, 196, 0.25);
}
.lumos-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.65rem 1.25rem;
  border-radius: var(--lumos-radius-sm);
  background: var(--lumos-color-primary);
  color: #080F19;
  font-weight: 600;
  font-size: 0.875rem;
  text-decoration: none;
  cursor: pointer;
  border: none;
  transition: background 0.15s ease;
}
.lumos-btn:hover {
  background: var(--lumos-color-primary-hover);
}
`;

export function generateAstroConfig({ outputMode = "static" }) {
  if (outputMode === "ssr") {
    return `import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: node({
    mode: 'standalone',
  }),
});
`;
  }

  return `import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  output: 'static',
});
`;
}

export function generatePackageJson({ name, outputMode = "static", useLumos = false, cmsType = "none" }) {
  const deps = {
    astro: "^5.0.0",
  };

  if (outputMode === "ssr") {
    deps["@astrojs/node"] = "^9.0.0";
  }

  if (cmsType === "directus") {
    deps["@directus/sdk"] = "^18.0.0";
  }

  return JSON.stringify(
    {
      name,
      type: "module",
      version: "0.0.1",
      scripts: {
        dev: "astro dev",
        start: outputMode === "ssr" ? "node ./dist/server/entry.mjs" : "astro preview",
        build: "astro build",
        preview: "astro preview",
        astro: "astro",
      },
      dependencies: deps,
      devDependencies: {},
    },
    null,
    2,
  );
}

export function generateAstroLayout({ title = "Astro + Headless CMS", useLumos = false }) {
  return `---
interface Props {
  title?: string;
  description?: string;
}

const { title = "Astro Project", description = "Powered by Axon Panel & Headless Architecture" } = Astro.props;
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content={description} />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
    ${useLumos ? '<link rel="stylesheet" href="/styles/lumos.css" />' : ""}
    <style is:global>
      :root {
        --color-bg: #080F19;
        --color-card: #111D2A;
        --color-border: #223244;
        --color-primary: #14CFC4;
        --color-text: #F1F5F9;
        --color-muted: #94A3B8;
      }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        background: var(--color-bg);
        color: var(--color-text);
        min-height: 100vh;
      }
    </style>
  </head>
  <body>
    <slot />
  </body>
</html>
`;
}

export function generateAstroIndex({
  projectName,
  cmsType = "none",
  useLumos = false,
  outputMode = "static",
  backendDomain = "",
}) {
  return `---
import Layout from '../layouts/Layout.astro';

const projectName = "${projectName}";
const cmsType = "${cmsType}";
const outputMode = "${outputMode}";
const useLumos = ${useLumos ? "true" : "false"};
const backendDomain = "${backendDomain}";
---

<Layout title={projectName}>
  <main class="${useLumos ? "lumos-container" : "container"}" style="max-width: 900px; margin: 0 auto; padding: 48px 24px;">
    <div style="text-align: center; margin-bottom: 48px;">
      <div style="display: inline-flex; align-items: center; gap: 8px; background: rgba(20, 207, 196, 0.15); color: #14CFC4; border: 1px solid rgba(20, 207, 196, 0.3); border-radius: 999px; padding: 6px 16px; font-size: 12px; font-weight: bold; margin-bottom: 16px;">
        🚀 Astro + Headless CMS Architecture
      </div>
      <h1 style="font-size: 40px; font-weight: 800; margin: 0 0 12px; letter-spacing: -0.02em;">
        {projectName}
      </h1>
      <p style="color: #94A3B8; font-size: 16px; max-width: 600px; margin: 0 auto;">
        Your high-performance decoupled Astro application is live and managed by Axon Panel.
      </p>
    </div>

    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 40px;">
      <div style="background: #111D2A; border: 1px solid #223244; border-radius: 12px; padding: 24px;">
        <p style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94A3B8; margin-bottom: 8px;">Delivery Mode</p>
        <p style="font-size: 18px; font-weight: 700; color: #F1F5F9; text-transform: uppercase;">
          {outputMode === 'static' ? '⚡ Static HTML (Nginx)' : '⚙️ SSR (Node.js Service)'}
        </p>
        <p style="font-size: 12px; color: #94A3B8; margin-top: 6px;">
          {outputMode === 'static' ? 'Zero Node.js overhead, served directly from disk via Nginx with aggressive caching.' : 'Dynamically rendered server responses supervised by systemd.'}
        </p>
      </div>

      <div style="background: #111D2A; border: 1px solid #223244; border-radius: 12px; padding: 24px;">
        <p style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94A3B8; margin-bottom: 8px;">Headless Backend</p>
        <p style="font-size: 18px; font-weight: 700; color: #818CF8; text-transform: capitalize;">
          {cmsType === 'none' ? 'None (Standalone)' : cmsType === 'wordpress' ? 'WordPress REST & GraphQL' : cmsType === 'directus' ? 'Directus API Platform' : 'Decap CMS (Git-based)'}
        </p>
        <p style="font-size: 12px; color: #94A3B8; margin-top: 6px;">
          {cmsType !== 'none' && backendDomain ? \`Connected to https://\${backendDomain}\` : 'Independent headless deployment.'}
        </p>
      </div>

      <div style="background: #111D2A; border: 1px solid #223244; border-radius: 12px; padding: 24px;">
        <p style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #94A3B8; margin-bottom: 8px;">Design System</p>
        <p style="font-size: 18px; font-weight: 700; color: #14CFC4;">
          {useLumos ? '✨ Lumos for Astro' : 'Standard CSS'}
        </p>
        <p style="font-size: 12px; color: #94A3B8; margin-top: 6px;">
          {useLumos ? 'Centralized design tokens, cascade architecture and accessible UI primitives active.' : 'Clean default Astro styles.'}
        </p>
      </div>
    </div>

    ${
      cmsType === "decap"
        ? `
    <div style="background: rgba(129, 140, 248, 0.1); border: 1px solid rgba(129, 140, 248, 0.3); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
      <h3 style="margin-bottom: 8px; font-size: 16px;">📝 Decap CMS Admin Dashboard</h3>
      <p style="color: #94A3B8; font-size: 13px; margin-bottom: 16px;">Manage your content collections via Git-backed Decap CMS.</p>
      <a href="/admin/" style="display: inline-block; background: #818CF8; color: white; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px;">Open /admin/ CMS Portal</a>
    </div>
    `
        : ""
    }

    ${
      cmsType === "wordpress" && backendDomain
        ? `
    <div style="background: rgba(34, 197, 94, 0.08); border: 1px solid rgba(34, 197, 94, 0.25); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
      <h3 style="margin-bottom: 8px; font-size: 16px;">WordPress Headless Admin</h3>
      <p style="color: #94A3B8; font-size: 13px; margin-bottom: 16px;">Manage your headless content at your backend WordPress installation.</p>
      <a href="https://${backendDomain}/wp-admin/" target="_blank" rel="noreferrer" style="display: inline-block; background: #22C55E; color: #080F19; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px;">Open WordPress Admin →</a>
    </div>
    `
        : ""
    }

    ${
      cmsType === "directus" && backendDomain
        ? `
    <div style="background: rgba(20, 207, 196, 0.08); border: 1px solid rgba(20, 207, 196, 0.25); border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
      <h3 style="margin-bottom: 8px; font-size: 16px;">Directus Headless Suite</h3>
      <p style="color: #94A3B8; font-size: 13px; margin-bottom: 16px;">Manage your database schemas, collections and assets in Directus.</p>
      <a href="https://${backendDomain}" target="_blank" rel="noreferrer" style="display: inline-block; background: #14CFC4; color: #080F19; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 13px;">Open Directus Suite →</a>
    </div>
    `
        : ""
    }

    <footer style="text-align: center; border-top: 1px solid #223244; padding-top: 24px; color: #64748B; font-size: 12px;">
      Deployed and orchestrated via Axon Panel.
    </footer>
  </main>
</Layout>
`;
}

export function generateDecapAdminHtml() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Content Manager · Decap CMS</title>
    <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
  </head>
  <body>
  </body>
</html>
`;
}

export function generateDecapConfigYml({ gitRepo = "your-org/your-repo", branch = "main" }) {
  return `backend:
  name: github
  repo: ${gitRepo}
  branch: ${branch}
  auth_type: implicit

media_folder: "public/uploads"
public_folder: "/uploads"

collections:
  - name: "blog"
    label: "Blog Posts"
    folder: "src/content/blog"
    create: true
    slug: "{{year}}-{{month}}-{{day}}-{{slug}}"
    fields:
      - { label: "Title", name: "title", widget: "string" }
      - { label: "Publish Date", name: "pubDate", widget: "datetime" }
      - { label: "Description", name: "description", widget: "string" }
      - { label: "Cover Image", name: "image", widget: "image", required: false }
      - { label: "Body", name: "body", widget: "markdown" }
`;
}
