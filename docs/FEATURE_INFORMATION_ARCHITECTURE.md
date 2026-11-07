# Axon Panel — Feature Information Architecture Specification

**Document Version:** 2.0.0  
**Status:** Architecture Blueprint  
**Date:** November 2026  
**Scope:** Information Architecture, Navigation Hierarchy, Site Workspace, and Customer Portal Design  

---

## 1. Executive Summary & Goals

Axon Panel has grown from a single-admin server tool into a multi-stack, multi-tenant Linux hosting control panel. To maintain operational clarity, intuitive usability, and strict security isolation between administrators and customers, this document defines the reorganized **Feature Information Architecture (IA)**.

### Core Objectives
1. **Clear Mental Model:** Group features logically by operational domain (Websites, Server Infrastructure, Security, Storage, Monitoring, Commercial Administration).
2. **Contextual Website Workspaces:** Elevate website management from a modal popup into a dedicated full-page workspace with dynamic, stack-aware tabs (WordPress, Astro, Laravel, Node.js, Static/PHP).
3. **Role-Enforced Portal Separation:** Provide an uncompromised Customer Portal tailored strictly to hosting self-service while shielding all root-level system controls.
4. **Internal Architecture Encapsulation:** Maintain engine internals (SQLite WAL, task queue, exec allowlist, path resolution) strictly within the backend boundary without exposing them as raw navigation endpoints.
5. **Zero Feature Loss & Non-Breaking Evolution:** Maintain 100% backward compatibility for existing URLs, APIs, and background daemons.

---

## 2. Administrator Navigation Architecture

The Administrator navigation is organized into 9 distinct functional clusters:

```
[ADMINISTRATOR PORTAL]
├── 1. OVERVIEW
│   ├── Dashboard              (/)
│   ├── Notifications          (/notifications)
│   └── System Health          (/system/health)
├── 2. WEBSITES
│   ├── All Websites           (/sites)
│   ├── Domains & Subdomains   (/domains)
│   ├── One-Click Applications (/apps)
│   ├── Astro & Headless CMS   (/astro)
│   ├── Git & Deployments      (/deployments)
│   └── WordPress Toolkit      (/wordpress)
├── 3. SERVER MANAGEMENT
│   ├── Server Overview        (/server)
│   ├── PHP Management         (/php)
│   ├── Node.js & PM2          (/services/pm2)
│   ├── Nginx Management       (/webserver)
│   ├── Databases              (/databases)
│   ├── Redis Management       (/services/redis)
│   ├── Cron Jobs              (/cron)
│   └── Process Manager        (/services)
├── 4. SECURITY
│   ├── Security Overview      (/security)
│   ├── Firewall (UFW)         (/security/firewall)
│   ├── Fail2Ban               (/security/fail2ban)
│   ├── SSH & Access Keys      (/security/ssh)
│   ├── Security Scanner       (/security/scanner)
│   ├── File Integrity         (/security/integrity)
│   └── Audit Logs             (/security/audit)
├── 5. SSL & DNS
│   ├── SSL Certificates       (/ssl)
│   └── DNS Zone Manager       (/dns)
├── 6. BACKUPS & STORAGE
│   ├── Backup Manager         (/backups)
│   ├── Backup Schedules       (/backups/schedules)
│   ├── Remote Storage         (/backups/remote)
│   └── File Manager           (/files)
├── 7. MONITORING & LOGS
│   ├── Resource Monitoring    (/monitoring)
│   ├── Website Logs           (/logs/websites)
│   ├── System Logs            (/logs)
│   └── Service Status         (/monitoring/services)
├── 8. HOSTING ADMINISTRATION
│   ├── Customers              (/users/customers)
│   ├── Resellers              (/users/resellers)
│   ├── Hosting Plans          (/plans)
│   ├── Users & Permissions    (/users)
│   ├── Integrations & API     (/settings/integrations)
│   └── Panel Settings         (/settings)
└── 9. ADMIN TOOLS
    └── Web Terminal           (/terminal)
```

---

## 3. Customer Portal Architecture

The Customer Portal provides a purpose-built, simplified experience scoped exclusively to tenant-owned resources. Global server controls (Terminal, Nginx vhost direct edits, UFW firewall, systemd daemons, root filesystem) are strictly inaccessible.

```
[CUSTOMER PORTAL]
├── MY HOSTING
│   ├── Dashboard              (/)
│   ├── My Websites            (/sites)
│   ├── Domains                (/domains)
│   ├── Applications           (/apps)
│   └── Git Deployments        (/deployments)
├── WEBSITE SERVICES
│   ├── Databases              (/databases)
│   ├── File Manager           (/files)
│   ├── SSL Certificates       (/ssl)
│   ├── Backups                (/backups)
│   └── WordPress Toolkit      (/wordpress)
└── ACCOUNT
    ├── Hosting Plan           (/plans)
    ├── Usage & Quotas         (/account/usage)
    ├── Profile & Security     (/settings)
    └── Support                (/support)
```

---

## 4. Dedicated Website Detail Architecture

Every website receives its own dedicated full-page workspace accessible at `/sites/:name` with dynamic breadcrumb navigation (`Websites > domain.com > [Active Tab]`).

### 4.1 Base Tab Structure (Available to all sites)
| Tab | Identifier | Core Capabilities |
| :--- | :--- | :--- |
| **Overview** | `overview` | Site health, primary IP, SSL status, quick stats, quick toggle (Enable/Disable), root path |
| **Settings** | `settings` | PHP version switcher, site kind, document root, delete site with backup |
| **Domains** | `domains` | Primary domain, subdomains, domain aliases, 301/302 redirects, per-domain SSL |
| **Git & Deployments** | `git` | Git branch, commit status, auto-pull triggers, deployment history, manual pull |
| **Databases** | `databases` | Linked MariaDB/PostgreSQL databases, database users, direct SQL query launcher |
| **Files** | `files` | Direct file browser scoped strictly to the site's document root (`docroot`) |
| **SSL** | `ssl` | Let's Encrypt status, issue/renew certificate, force HTTPS redirect |
| **Security** | `security` | Directory permission repair, hotlink protection, blocked IP lists, sensitive file blocking |
| **Performance** | `performance` | Server response timing (TTFB), asset compression, Gzip/Brotli settings |
| **Cache** | `cache` | Microcaching toggle, FastCGI cache status, purge disk cache |
| **Backups** | `backups` | Website snapshot listing, one-click backup of docroot + DB, instant restore |
| **Logs** | `logs` | Dedicated Nginx access log, error log, and application stdout/stderr streams |

### 4.2 Application Stack Adaptations

Depending on the detected application stack (`stack.type`), the website workspace dynamically activates specialized tabs and toolkits:

#### A. WordPress Websites
* **Security Hardening:** Multi-vector security audit, CVE database matching, Basic/Advanced/Strict hardening profiles with atomic rollbacks, XML-RPC & REST API lockdown, upload script execution block.
* **Performance Optimization:** Post revision pruner, transient cleanup, spam/trash purge, orphaned metadata cleaner, table defragmentation (`OPTIMIZE TABLE`), and automated WebP conversion via `cwebp`/ImageMagick with `.original` rollback safety.
* **Cache Manager:** 6-layer cache control (FastCGI, Redis Object Cache with tenant key isolation, PHP OPcache reset, Browser caching, Cloudflare CDN integration, WooCommerce safe checkout bypass rules).
* **Plugins & Themes:** Live version status, one-click updates, activation toggling, and vulnerability warnings.
* **WP-CLI Console:** Execute safe WP-CLI commands directly within the site context.
* **Database Tools:** WP table repair, table optimization, prefix verification, and database search-and-replace.

#### B. Astro Websites
* **Static vs. SSR Deployment:** One-click toggle between pure static Nginx hosting and Node.js SSR daemon mode.
* **Build Configuration:** Custom build command (`npm run build`, `pnpm build`), package manager selection, output directory specification (`dist/`).
* **Node Runtime & Systemd Daemon:** Dedicated systemd service manager (`axon-site-{name}.service`), port reservation (3000–3999 range), and crash restart supervisor.
* **Headless CMS Configuration:** Connected CMS backend management (WordPress REST/GraphQL, Directus, Decap CMS).
* **Environment Variables:** Secure `.env` variable editor with encrypted storage.
* **Deployment History:** Timestamped release directories with instantaneous symlink rollbacks (`releases/{timestamp} -> current`).

#### C. Laravel Websites
* **PHP Runtime & Extensions:** Dedicated PHP version and required extension audit (`pdo_mysql`, `mbstring`, `bcmath`, `xml`, `curl`).
* **Environment Configuration:** Safe `.env` file management, `php artisan key:generate` trigger.
* **Artisan Command Runner:** Safe execution of common Artisan tasks (`migrate`, `cache:clear`, `config:cache`, `route:cache`, `storage:link`).
* **Queue Worker Supervisor:** Automated generation and management of `axon-worker-{site}.service` running `artisan queue:work --sleep=3 --tries=3`.
* **Task Scheduler:** Background cron trigger for `artisan schedule:run`.
* **Database & Migrations:** Migration status, pending migrations runner, and rollback controls.
* **Deployment History:** Multi-release deployment pipeline with storage directory persistence.

#### D. Node.js & Next.js Websites
* **Node Runtime:** Node.js version selection (Node 20, 22), package manager (`npm`, `pnpm`, `yarn`).
* **Process Manager:** Systemd user unit or PM2 daemon supervisor, auto-restart on memory threshold, start/stop/restart controls.
* **Environment Variables:** Production environment variable key-value editor.
* **Build Settings:** Install command (`npm ci`), build script (`npm run build`), startup command (`npm start` or custom entry point).
* **Logs & Telemetry:** Real-time stdout/stderr stream with log download.
* **Git Deployments:** Webhook trigger URL for automated git push deployments.

---

## 5. Internal Architecture Encapsulation

The following core components represent internal system architecture and infrastructure mechanisms. They must **never** be exposed as raw, standalone navigation items in either portal:

1. **SQLite Database Layer & WAL Engine:** Internal persistence mechanism (`/etc/webpanel/axon.db`) managed transparently via `server/lib/db.js`.
2. **Asynchronous Task Queue & Worker Daemon:** Internal SQLite queue (`server/lib/queue.js`, `server/lib/worker.js`) executing long-running background tasks. Exposed contextually via task status badges and notification toasts, not as an infrastructure control page.
3. **Command Execution Allowlist (`server/lib/exec.js`):** Security enforcement boundary ensuring zero shell interpolation across 56 permitted system binaries.
4. **Path Confinement & Root Resolution (`server/lib/validate.js`):** Security mechanism confining filesystem access strictly to authorized directories.
5. **Session JWT & CSRF Token Internals:** Transparent authentication and CSRF headers (`x-requested-with: webpanel`).
6. **Server Agent & Socket Bridge:** Architectural abstraction layer (`ServerAgentClient`) preparing for compiled Go agent communication via `/run/axon-agent.sock`.
7. **Server-Sent Events (SSE) Bus:** Real-time data transport layer for streaming journal logs and task progress.

---

## 6. Layout, Visual Design & Responsiveness

1. **Design System Tokens:** Strict adherence to the Axon dark theme (`#080F19` background, `#111D2A` cards, `#14CFC4` primary teal) and light theme (`#F7F9FC` background, `#FFFFFF` cards, `#0DADA5` primary teal).
2. **Responsive Breakpoints:**
   * **Desktop (≥ 1024px):** Fixed 240px sidebar with persistent section headers, top telemetry bar, multi-column data grids.
   * **Tablet (768px – 1023px):** Collapsible sidebar with icon-only or overlay drawer, fluid card layouts.
   * **Mobile (< 768px):** Hamburger menu drawer, stacked cards, full-width touch targets, horizontally scrollable contextual tabs.
3. **Breadcrumbs:** Universal breadcrumb bar on all nested and detail views (e.g., `Home / Websites / example.com / Security Hardening`).
4. **Contextual Status Badges:** Visual indicators for service health, SSL expiration countdowns, stack type, and background task progress.
