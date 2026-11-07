/**
 * Catalogue of one-click installable applications.
 */

export const CATEGORIES = ["cms", "framework", "ecommerce", "nodejs", "static"];

const PHP_SOCKET = "{{socket}}";

const WORDPRESS_CONFIG = `<?php
define('DB_NAME', '{{dbName}}');
define('DB_USER', '{{dbUser}}');
define('DB_PASSWORD', '{{dbPassword}}');
define('DB_HOST', '127.0.0.1');
define('DB_CHARSET', 'utf8mb4');
define('DB_COLLATE', '');

{{salts}}
$table_prefix = 'wp_';

define('WP_DEBUG', false);
define('WP_DEBUG_LOG', false);
define('WP_DEBUG_DISPLAY', false);
define('DISALLOW_FILE_EDIT', true);
define('AUTOMATIC_UPDATER_DISABLED', false);
define('WP_MEMORY_LIMIT', '256M');

if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}
require_once ABSPATH . 'wp-settings.php';
`;

const WORDPRESS_SALTS = [
  "AUTH_KEY",
  "SECURE_AUTH_KEY",
  "LOGGED_IN_KEY",
  "NONCE_KEY",
  "AUTH_SALT",
  "SECURE_AUTH_SALT",
  "LOGGED_IN_SALT",
  "NONCE_SALT",
];

const LARAVEL_ENV = `APP_NAME="{{siteTitle}}"
APP_ENV=production
APP_KEY={{appKey}}
APP_DEBUG=false
APP_TIMEZONE=UTC
APP_URL={{siteUrl}}

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US

APP_MAINTENANCE_DRIVER=file

BCRYPT_ROUNDS=12

LOG_CHANNEL=stack
LOG_STACK=single
LOG_DEPRECATIONS_CHANNEL=null
LOG_LEVEL=debug

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE={{dbName}}
DB_USERNAME={{dbUser}}
DB_PASSWORD={{dbPassword}}

SESSION_DRIVER=file
SESSION_LIFETIME=120
SESSION_ENCRYPT=false
SESSION_PATH=/
SESSION_DOMAIN=null

BROADCAST_CONNECTION=log
FILESYSTEM_DISK=local
QUEUE_CONNECTION=database

CACHE_STORE=file
CACHE_PREFIX=

MEMCACHED_HOST=127.0.0.1

REDIS_CLIENT=phpredis
REDIS_HOST=127.0.0.1
REDIS_PASSWORD=null
REDIS_PORT=6379

MAIL_MAILER=log
MAIL_HOST=127.0.0.1
MAIL_PORT=2525
MAIL_USERNAME=null
MAIL_PASSWORD=null
MAIL_ENCRYPTION=null
MAIL_FROM_ADDRESS="hello@{{domain}}"
MAIL_FROM_NAME="\${APP_NAME}"
`;

const NODEJS_PACKAGE = `{
  "name": "{{slug}}",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.21.2",
    "cors": "^2.8.5"
  }
}
`;

const NODEJS_SERVER = `import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || {{port}};

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    app: '{{siteTitle}}',
    domain: '{{domain}}',
    port,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send(\`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{siteTitle}}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0b0f19; color: #f8fafc; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 20px; }
    .card { background: #131b2e; border: 1px solid #1e293b; border-radius: 16px; padding: 40px; max-width: 520px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); }
    h1 { margin: 0 0 10px; font-size: 26px; color: #38bdf8; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.6; }
    .badge { display: inline-block; background: #0284c7; color: white; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
    .meta { margin-top: 25px; padding-top: 20px; border-top: 1px solid #1e293b; display: flex; justify-content: space-around; font-size: 13px; color: #64748b; }
    .meta strong { color: #cbd5e1; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Node.js Express App</span>
    <h1>{{siteTitle}}</h1>
    <p>Your Node.js backend is running smoothly via PM2 on port <strong>\${port}</strong> with an automated Nginx reverse proxy.</p>
    <div class="meta">
      <div>Domain: <strong>{{domain}}</strong></div>
      <div>Status: <strong>Online</strong></div>
    </div>
  </div>
</body>
</html>\`);
});

app.listen(port, () => {
  console.log(\`[{{siteTitle}}] running on http://127.0.0.1:\${port}\`);
});
`;

const ASTRO_PACKAGE = `{
  "name": "{{slug}}",
  "version": "1.0.0",
  "private": true
}
`;

const ASTRO_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{siteTitle}} - Astro</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0a0a0c; color: #f4f4f5; display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; padding: 24px; }
    .box { background: #18181b; border: 1px solid #27272a; border-radius: 20px; padding: 48px; max-width: 580px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.6); }
    .astro-badge { display: inline-flex; align-items: center; gap: 6px; background: linear-gradient(90deg, #bc52ee, #ff5d01); color: white; padding: 6px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; margin-bottom: 24px; }
    h1 { margin: 0 0 12px; font-size: 32px; font-weight: 800; background: linear-gradient(135deg, #ffffff, #a1a1aa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #a1a1aa; font-size: 15px; line-height: 1.6; margin: 0 0 28px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; text-align: left; }
    .item { background: #27272a; border-radius: 12px; padding: 16px; }
    .item h3 { margin: 0 0 4px; font-size: 14px; color: #e4e4e7; }
    .item p { margin: 0; font-size: 12px; color: #71717a; }
  </style>
</head>
<body>
  <div class="box">
    <div class="astro-badge">🚀 Astro Static Delivery</div>
    <h1>{{siteTitle}}</h1>
    <p>Your Astro site is pre-rendered and delivered with ultra-fast static file response times through Nginx.</p>
    <div class="grid">
      <div class="item">
        <h3>⚡ High Speed</h3>
        <p>Served directly as static HTML assets by Nginx.</p>
      </div>
      <div class="item">
        <h3>🔒 SSL Secured</h3>
        <p>Encrypted by Let's Encrypt with HTTP/2.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

const NEXTJS_PACKAGE = `{
  "name": "{{slug}}",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "^15.1.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
`;

const NEXTJS_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};
export default nextConfig;
`;

const NEXTJS_PAGE = `export default function Home() {
  return (
    <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#000", color: "#fff", fontFamily: "sans-serif", padding: "2rem" }}>
      <div style={{ textAlign: "center", maxWidth: "600px" }}>
        <h1 style={{ fontSize: "2.5rem", marginBottom: "1rem", letterSpacing: "-0.05em" }}>Welcome to {{siteTitle}}</h1>
        <p style={{ color: "#888", fontSize: "1.1rem", marginBottom: "2rem" }}>Powered by Next.js 15, React 19, PM2, and Nginx reverse proxy.</p>
        <div style={{ display: "inline-block", padding: "0.5rem 1rem", border: "1px solid #333", borderRadius: "8px", background: "#111", fontSize: "0.9rem" }}>
          Ready for deployment at <strong>{{domain}}</strong>
        </div>
      </div>
    </main>
  );
}
`;

const NEXTJS_LAYOUT = `export const metadata = {
  title: '{{siteTitle}}',
  description: 'Built with Next.js',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
`;

export const APPS = [
  // 1. WordPress (Core)
  {
    id: "wordpress",
    name: "WordPress",
    vendor: "WordPress Foundation",
    tagline: "The world's most popular CMS",
    description: "Install a clean, standalone WordPress setup. Powers over 40% of all websites worldwide for blogs, business sites, and publications.",
    category: "cms",
    runtime: "php",
    database: "mysql",
    weight: "light",
    verified: true,
    finishMode: "silent",
    adminPath: "/wp-admin",
    docrootSuffix: "",
    requirements: {
      phpExtensions: ["mysqli", "gd", "zip", "curl", "mbstring", "xml", "json"],
      binaries: ["unzip", "curl", "php"],
      minFreeRamMb: 150,
      minFreeDiskMb: 350,
    },
    notes: [
      "Installs the latest official WordPress release from wordpress.org.",
      "Configures MySQL database, database user, wp-config.php with cryptographic salts, and admin credentials.",
      "Sets up Nginx with FastCGI PHP 8.3/8.4 and issues Let's Encrypt SSL automatically.",
    ],
    downloads: {
      app: { url: "https://wordpress.org/latest.zip", archive: "zip", root: "wordpress" },
      wpCli: { from: "github", repo: "wp-cli/wp-cli", asset: "^wp-cli-[0-9.]+[.]phar$", checksumAsset: "[.]sha256$" },
    },
    plan: [
      { type: "download", source: "app", dest: "{{tmpDir}}/app.zip" },
      { type: "extract", archive: "{{tmpDir}}/app.zip", dest: "{{installDir}}", root: "wordpress" },
      { type: "createDatabase" },
      { type: "createDatabaseUser" },
      { type: "writeFile", path: "{{installDir}}/wp-config.php", template: "wordpress-config", mode: "0640" },
      { type: "chown", path: "{{installDir}}", owner: "www-data:www-data", recursive: true },
      { type: "createSite" },
      { type: "requestCertificate" },
      { type: "downloadWpCli" },
      {
        type: "run",
        bin: "php",
        label: "Running the WordPress installer (wp-cli)",
        args: [
          "{{wpCliPath}}",
          "core",
          "install",
          "--path={{installDir}}",
          "--url={{siteUrl}}",
          "--title={{siteTitle}}",
          "--admin_user={{adminUser}}",
          "--admin_password={{adminPassword}}",
          "--admin_email={{adminEmail}}",
          "--skip-email",
          "--allow-root",
        ],
      },
    ],
  },

  // 2. Laravel
  {
    id: "laravel",
    name: "Laravel",
    vendor: "Taylor Otwell",
    tagline: "The PHP Framework for Web Artisans",
    description: "A fresh Laravel 11/12 application with MVC structure, Eloquent ORM, Blade templating, routing, and database migrations ready out-of-the-box.",
    category: "framework",
    runtime: "php",
    database: "mysql",
    weight: "medium",
    verified: true,
    finishMode: "silent",
    adminPath: "/",
    docrootSuffix: "/public",
    requirements: {
      phpExtensions: ["mysqli", "curl", "mbstring", "xml", "zip", "bcmath"],
      binaries: ["composer", "php"],
      minFreeRamMb: 256,
      minFreeDiskMb: 600,
    },
    notes: [
      "Bootstraps a fresh Laravel project via Composer.",
      "Configures .env with MySQL credentials, generates APP_KEY, sets up storage symlink.",
      "Sets up Nginx pointing to public/ directory with PHP-FPM and SSL.",
    ],
    downloads: {
      app: { type: "composer", package: "laravel/laravel" },
    },
    plan: [
      {
        type: "run",
        bin: "composer",
        label: "Creating fresh Laravel project via Composer",
        args: ["create-project", "--prefer-dist", "laravel/laravel", "{{installDir}}", "--no-interaction"],
        env: { COMPOSER_ALLOW_SUPERUSER: "1", COMPOSER_MEMORY_LIMIT: "-1" },
        timeoutMs: 600000,
      },
      { type: "createDatabase" },
      { type: "createDatabaseUser" },
      { type: "writeFile", path: "{{installDir}}/.env", template: "laravel-env", mode: "0640" },
      {
        type: "run",
        bin: "php",
        label: "Generating application key",
        args: ["artisan", "key:generate", "--force"],
        cwd: "{{installDir}}",
      },
      {
        type: "run",
        bin: "php",
        label: "Creating storage symbolic link",
        args: ["artisan", "storage:link"],
        cwd: "{{installDir}}",
        optional: true,
      },
      { type: "chown", path: "{{installDir}}", owner: "www-data:www-data", recursive: true },
      { type: "createSite" },
      { type: "requestCertificate" },
    ],
  },

  // 3. Node.js Express App
  {
    id: "nodejs",
    name: "Node.js (Express)",
    vendor: "OpenJS Foundation",
    tagline: "Fast, unopinionated Node.js REST / web application",
    description: "Production Node.js service running on Express. Automatically configured with PM2 process manager and Nginx reverse proxy.",
    category: "nodejs",
    runtime: "node",
    database: "none",
    weight: "light",
    verified: true,
    finishMode: "silent",
    adminPath: "/api/health",
    portSource: true,
    requirements: {
      binaries: ["node", "npm"],
      minFreeRamMb: 120,
      minFreeDiskMb: 300,
    },
    notes: [
      "Scaffolds a clean Node.js Express application with health check and landing page.",
      "Runs npm install, launches with PM2 on a dedicated internal port, and saves the process state.",
      "Configures Nginx reverse proxy with WebSocket support and issues SSL.",
    ],
    downloads: {
      app: { type: "node", scaffold: "express" },
    },
    plan: [
      { type: "writeFile", path: "{{installDir}}/package.json", template: "nodejs-package", mode: "0644" },
      { type: "writeFile", path: "{{installDir}}/server.js", template: "nodejs-server", mode: "0644" },
      {
        type: "run",
        bin: "npm",
        label: "Installing Node.js dependencies",
        args: ["install", "--silent"],
        cwd: "{{installDir}}",
        timeoutMs: 180000,
      },
      {
        type: "pm2Start",
        name: "node-{{slug}}",
        script: "server.js",
        cwd: "{{installDir}}",
      },
      { type: "createProxySite" },
      { type: "requestCertificate" },
    ],
  },

  // 4. Next.js
  {
    id: "nextjs",
    name: "Next.js",
    vendor: "Vercel",
    tagline: "The React Framework for the Web",
    description: "Next.js application with React 19, App Router, server-side rendering, and production PM2 management.",
    category: "framework",
    runtime: "node",
    database: "none",
    weight: "medium",
    verified: true,
    finishMode: "silent",
    adminPath: "/",
    portSource: true,
    requirements: {
      binaries: ["node", "npm"],
      minFreeRamMb: 350,
      minFreeDiskMb: 800,
    },
    notes: [
      "Scaffolds a Next.js App Router project with React 19.",
      "Runs npm install, generates production build, and launches daemon with PM2.",
      "Configures Nginx reverse proxy with Next.js caching rules and SSL.",
    ],
    downloads: {
      app: { type: "node", scaffold: "nextjs" },
    },
    plan: [
      { type: "writeFile", path: "{{installDir}}/package.json", template: "nextjs-package", mode: "0644" },
      { type: "writeFile", path: "{{installDir}}/next.config.js", template: "nextjs-config", mode: "0644" },
      { type: "writeFile", path: "{{installDir}}/app/layout.jsx", template: "nextjs-layout", mode: "0644" },
      { type: "writeFile", path: "{{installDir}}/app/page.jsx", template: "nextjs-page", mode: "0644" },
      {
        type: "run",
        bin: "npm",
        label: "Installing Next.js and React dependencies",
        args: ["install", "--silent"],
        cwd: "{{installDir}}",
        timeoutMs: 300000,
      },
      {
        type: "run",
        bin: "npm",
        label: "Building Next.js production bundle",
        args: ["run", "build"],
        cwd: "{{installDir}}",
        timeoutMs: 300000,
      },
      {
        type: "pm2Start",
        name: "next-{{slug}}",
        script: "node_modules/next/dist/bin/next",
        args: ["start", "-p", "{{port}}"],
        cwd: "{{installDir}}",
      },
      { type: "createProxySite" },
      { type: "requestCertificate" },
    ],
  },

  // 5. Astro
  {
    id: "astro",
    name: "Astro",
    vendor: "Astro Technology Company",
    tagline: "The web framework for content-driven websites",
    description: "Ultra-fast content-focused website generator. Delivers pre-rendered HTML with zero client-side JavaScript overhead by default.",
    category: "static",
    runtime: "static",
    database: "none",
    weight: "light",
    verified: true,
    finishMode: "silent",
    adminPath: "/",
    docrootSuffix: "/dist",
    requirements: {
      binaries: ["curl"],
      minFreeRamMb: 80,
      minFreeDiskMb: 150,
    },
    notes: [
      "Sets up a high-performance Astro site structure with static dist/ directory.",
      "Configures Nginx static vhost with aggressive caching headers for assets.",
      "Automates Let's Encrypt SSL certificate issuance.",
    ],
    downloads: {
      app: { type: "static", scaffold: "astro" },
    },
    plan: [
      { type: "writeFile", path: "{{installDir}}/package.json", template: "astro-package", mode: "0644" },
      { type: "writeFile", path: "{{installDir}}/dist/index.html", template: "astro-index", mode: "0644" },
      { type: "chown", path: "{{installDir}}", owner: "www-data:www-data", recursive: true },
      { type: "createStaticSite" },
      { type: "requestCertificate" },
    ],
  },

  // 6. WooCommerce
  {
    id: "woocommerce",
    name: "WooCommerce",
    vendor: "Automattic",
    tagline: "WordPress + WooCommerce E-Commerce",
    description: "Full storefront, product catalogue, payments, shipping and tax built on WordPress.",
    category: "ecommerce",
    runtime: "php",
    database: "mysql",
    weight: "light",
    verified: true,
    finishMode: "silent",
    adminPath: "/wp-admin",
    docrootSuffix: "",
    requirements: {
      phpExtensions: ["mysqli", "gd", "zip", "curl", "mbstring", "xml", "json", "filter"],
      binaries: ["unzip", "curl", "php"],
      minFreeRamMb: 180,
      minFreeDiskMb: 500,
    },
    notes: [
      "Installed automatically with wp-cli, including an admin account with a generated password.",
      "WooCommerce is installed and activated automatically.",
    ],
    downloads: {
      app: { url: "https://wordpress.org/latest.zip", archive: "zip", root: "wordpress" },
      plugins: [
        { url: "https://downloads.wordpress.org/plugin/woocommerce.latest-stable.zip", archive: "zip", name: "woocommerce" },
      ],
      wpCli: { from: "github", repo: "wp-cli/wp-cli", asset: "^wp-cli-[0-9.]+[.]phar$", checksumAsset: "[.]sha256$" },
    },
    plan: [
      { type: "download", source: "app", dest: "{{tmpDir}}/app.zip" },
      { type: "extract", archive: "{{tmpDir}}/app.zip", dest: "{{installDir}}", root: "wordpress" },
      { type: "downloadPlugins" },
      { type: "createDatabase" },
      { type: "createDatabaseUser" },
      { type: "writeFile", path: "{{installDir}}/wp-config.php", template: "wordpress-config", mode: "0640" },
      { type: "chown", path: "{{installDir}}", owner: "www-data:www-data", recursive: true },
      { type: "createSite" },
      { type: "requestCertificate" },
      { type: "downloadWpCli" },
      {
        type: "run",
        bin: "php",
        label: "Running the WordPress installer (wp-cli)",
        args: [
          "{{wpCliPath}}",
          "core",
          "install",
          "--path={{installDir}}",
          "--url={{siteUrl}}",
          "--title={{siteTitle}}",
          "--admin_user={{adminUser}}",
          "--admin_password={{adminPassword}}",
          "--admin_email={{adminEmail}}",
          "--skip-email",
          "--allow-root",
        ],
      },
      {
        type: "run",
        bin: "php",
        label: "Activating WooCommerce",
        args: [
          "{{wpCliPath}}",
          "plugin",
          "activate",
          "woocommerce",
          "--path={{installDir}}",
          "--allow-root",
        ],
        optional: true,
      },
    ],
  },

  // 7. OpenCart
  {
    id: "opencart",
    name: "OpenCart",
    vendor: "OpenCart",
    tagline: "OpenCart 4 E-Commerce",
    description: "A lightweight PHP storefront with a large extension marketplace. Fast on modest hardware.",
    category: "ecommerce",
    runtime: "php",
    database: "mysql",
    weight: "light",
    verified: false,
    finishMode: "browser",
    finishPath: "/install",
    adminPath: "/admin",
    docrootSuffix: "",
    requirements: {
      phpExtensions: ["mysqli", "gd", "zip", "curl", "mbstring", "xml", "json"],
      binaries: ["unzip", "curl"],
      minFreeRamMb: 150,
      minFreeDiskMb: 400,
    },
    notes: [
      "Files, database, database user, permissions and the nginx vhost are set up automatically.",
      "Open the site and complete the setup wizard using the database details shown after installation.",
    ],
    downloads: {
      app: {
        from: "github",
        repo: "opencart/opencart",
        asset: "^opencart-[0-9.]+[.]zip$",
        archive: "zip",
        root: "upload",
      },
    },
    plan: [
      { type: "download", source: "app", dest: "{{tmpDir}}/app.zip" },
      { type: "extract", archive: "{{tmpDir}}/app.zip", dest: "{{installDir}}", root: "upload" },
      { type: "createDatabase" },
      { type: "createDatabaseUser" },
      { type: "chown", path: "{{installDir}}", owner: "www-data:www-data", recursive: true },
      { type: "createSite" },
      { type: "requestCertificate" },
    ],
  },
];

export function getApp(id) {
  return APPS.find((app) => app.id === id) ?? null;
}

export function listApps() {
  return APPS.map((app) => ({
    id: app.id,
    name: app.name,
    vendor: app.vendor,
    tagline: app.tagline,
    description: app.description,
    category: app.category,
    runtime: app.runtime,
    database: app.database,
    weight: app.weight,
    verified: app.verified,
    automated: app.automated !== false,
    finishMode: app.finishMode,
    adminPath: app.adminPath,
    notes: app.notes ?? [],
    manualRecipe: app.manualRecipe ?? [],
    portSource: Boolean(app.portSource),
    docrootSuffix: app.docrootSuffix ?? "",
  }));
}

export const TEMPLATES = {
  "wordpress-config": WORDPRESS_CONFIG,
  "laravel-env": LARAVEL_ENV,
  "nodejs-package": NODEJS_PACKAGE,
  "nodejs-server": NODEJS_SERVER,
  "astro-package": ASTRO_PACKAGE,
  "astro-index": ASTRO_INDEX,
  "nextjs-package": NEXTJS_PACKAGE,
  "nextjs-config": NEXTJS_CONFIG,
  "nextjs-page": NEXTJS_PAGE,
  "nextjs-layout": NEXTJS_LAYOUT,
};

export const WORDPRESS_SALT_KEYS = WORDPRESS_SALTS;
export const PHP_FPM_SOCKET = PHP_SOCKET;
