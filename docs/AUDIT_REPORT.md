# Axon Panel — Phase 0: Existing Project Audit Report

**Date:** November 2026  
**System:** Ubuntu 24.04.5 LTS (Noble Numbat) x86_64  
**Workspace:** `/opt/axon-panel`  
**Public Endpoint:** `https://panel.example.com`  
**Service:** `axon-panel.service` (Node.js on `127.0.0.1:9090` behind Nginx)  
**Author:** Principal Software Architect & Systems Engineering Team  

---

## 1. Executive Summary

Axon Panel (originally developed as `webpanel`) is a lightweight, Linux-native hosting control panel designed to manage virtual private servers (VPS), websites across diverse runtime stacks (WordPress, Laravel, Node.js, Next.js, Astro, PHP, static), databases, web server configurations, SSL certificates, system services, and server security.

This audit evaluates the codebase to establish a technical baseline prior to executing Phase 1 of the Master Development Specification. The existing application has a functional foundation with genuine Linux system integrations—it is **not** a mock UI. However, it currently operates as a single-admin system relying on flat JSON configuration files and filesystem inspection rather than a structured internal database, lacks role-based access control (RBAC), and lacks persistent asynchronous task queueing.

### Key Audit Metrics
| Metric | Measurement / Count | Notes |
| :--- | :--- | :--- |
| **Backend Endpoints** | 126 routes defined in Express | All defined in `server/routes/*.js` |
| **Frontend API Calls** | 114 endpoints actively invoked | Verified by `scripts/api-contract-check.js` |
| **Automated Tests** | 78 validation & security checks | 100% passing via `scripts/security-check.js` |
| **Runtime Footprint** | ~42 MB RSS (Node.js backend) | Excellent efficiency on 2 GB host |
| **Frontend Bundle** | Vite + React 19 + Tailwind v4 | Pre-rendered to `/root/webpanel/dist` |
| **Storage Engine** | `/etc/webpanel/config.json` + OS | No SQL database for panel metadata yet |
| **Tenancy Model** | Single Admin User | RBAC not yet introduced |

---

## 2. Server Environment & Real System State

An inspection of the underlying host reveals the following real-world configuration:

```bash
# OS Information
Ubuntu 24.04.5 LTS (Noble Numbat), Linux kernel 6.8.0-x86_64

# Hardware Resources
CPU: 2 vCPUs (Intel Xeon / AMD EPYC virtualized)
RAM: 1,963 MB total (1,003 MB used, 420 MB free, 959 MB available)
Swap: 5,119 MB total (376 MB used, 4,743 MB free)
Storage: /dev/vda3 (58 GB total, 20 GB used [36%], 36 GB available)

# Installed Runtimes & Daemons
Nginx: 1.30.6
Node.js: v22.23.4 (NPM 10.9.2)
PHP: PHP 8.4.27 CLI (PHP-FPM sockets: php8.3-fpm, php8.4-fpm active)
MariaDB: 10.11.14-MariaDB (active)
PostgreSQL: 16.4 (active on port 5432)
Redis: Redis server active on localhost:6379
Process Manager: PM2 5.4.3 installed globally
Security Daemons: UFW (active), Fail2ban (active)
Certbot: Let's Encrypt Certbot 2.9.0
```

### Existing Virtual Hosts on Server
- `panel.example.com`: Control panel reverse proxy (`127.0.0.1:9090`, TLS terminated by Certbot).
- `example.com`: Production site (`/var/www/example.com`, PHP-FPM / FastCGI).
- `app.example.com`: Node.js / SSR application.
- `default`: Nginx default catch-all server block.

---

## 3. Comprehensive Codebase Inventory

### 3.1 Backend Architecture (`server/`)
- **Entrypoint (`server/index.js`)**: Configures Express 5.1.0, attaches Helmet HTTP security headers (strict CSP, HSTS, frame-ancestors none), cookie parsing, loopback trust proxy, JSON body parsing (2 MB limit), IP allowlist filter, CSRF verification, dynamic API router mounts, static distribution serving, WebSocket terminal attachment, and graceful shutdown handlers.
- **Configuration Management (`server/config.js`)**: Loads `/etc/webpanel/config.json` (mode 0600) with atomic write temp-file replacements. Manages session hours, IP allowlists, safe roots, backup paths, and default FPM sockets.
- **Execution Engine (`server/lib/exec.js`)**: **Core security boundary**. Uses `child_process.execFile` and `spawn` without shell interpolation. Enforces a strict binary allowlist (`ALLOWED_BINARIES`) consisting of 56 system binaries. Provides standard execution (`run`), strict error throwing (`runOrThrow`), file-to-stdin execution (`runFromFile`), and stdout-to-file streaming (`runToFile`).
- **Validation Engine (`server/lib/validate.js`)**: Enforces domain formats, database names, systemd unit protection, port bounds, safe path resolution (`resolveSafePath` preventing directory traversal outside `allowedRoots`), and blocklist checks on sensitive files (`.key`, `/etc/shadow`, etc.).
- **Authentication & Security Middleware (`server/middleware/auth.js`)**:
  - JWT session issuance and verification via `httpOnly`, `secure`, `sameSite: "strict"` cookies.
  - In-memory rate limiting and account lockout after 5 consecutive failed attempts with a 15-minute window.
  - Custom CSRF header checking (`x-requested-with: webpanel`) on mutating requests.
  - IP allowlist verification against `config.ipAllowlist`.
- **System Integrations (`server/lib/`)**:
  - `nginx.js`: Live parsing of vhost files (`sites-available`), syntax testing (`nginx -t`), symlink toggling (`sites-enabled`), automated backup creation, and safe atomic writing.
  - `mariadb.js`: Direct shell-free calls to `mariadb`, `mysqladmin`, `mysqldump` with TSV output parsing.
  - `postgres.js`: Integration with `psql`, `pg_dump`, `createdb`, `dropdb` with CSV parsing.
  - `systemd.js`: Unit status inspection, start/stop/restart operations for non-protected units.
  - `pm2.js`: Inspection and control of Node.js applications registered with PM2.
  - `certbot.js`: Let's Encrypt certificate issuance, renewal, revocation, and parsing.
  - `totp.js`: Native RFC 6238 TOTP implementation supporting standard authenticator apps.
  - `terminal.js`: WebSocket-based terminal using PTY or fallback script/bash execution.
  - `apps/installer.js`: Step-by-step orchestrator for catalog application provisioning.
  - `audit.js`: Append-only audit logger writing to `/var/log/webpanel/audit.log`.

### 3.2 Backend API Routes (`server/routes/`)
1. `auth.js`: Login, logout, session query, password change, TOTP 2FA setup with QR code generation.
2. `system.js`: System health metrics (CPU, RAM, load, disk mounts), host overview.
3. `sites.js`: Virtual host listing, creation from templates, editing, activation/deactivation, PHP version switching, syntax testing, reload.
4. `apps.js`: Application catalogue browsing, parameter verification, asynchronous installer job trigger, live job progress log.
5. `databases.js`: Complete MariaDB and PostgreSQL lifecycle (databases, users, permissions, backups, restores, table inspection, ad-hoc queries).
6. `php.js`: Detect installed PHP versions, manage FPM pools, toggle extensions, edit `php.ini` directives, install additional PHP packages.
7. `webserver.js`: Nginx global configuration, version tracking, version switcher, access/error logs.
8. `ssl.js`: Certbot certificate manager, automated Let's Encrypt issuance, manual cert inspection, renewal, revocation.
9. `dns.js`: Local DNS zone creation, record management, BIND file export.
10. `cron.js`: User crontab parsing, scheduled task creation, deletion, manual execution.
11. `files.js`: Path-confined file manager (directory listing, file reading, writing, uploads, downloads, deletions, renames).
12. `services.js`: Systemd unit manager, PM2 process manager, Redis server inspection.
13. `logs.js`: System log streaming via Server-Sent Events (SSE) and snapshot queries from `journalctl`.
14. `security.js`: UFW firewall rules & status, Fail2ban jail status & ban/unban controls, SSH configuration hardening, listening port scanner (`ss -tulpn`), panel security summary.
15. `settings.js`: Panel configuration tuning, IP allowlist management, audit log access.

### 3.3 Frontend Architecture (`web/src/`)
- **Core Framework**: React 19.2.0, Vite 7.1.9, TypeScript 5.9.3, Tailwind CSS v4.1.14.
- **Routing**: `react-router-dom` v7 with authenticated route protection and global context provider (`AppContext`).
- **Layout & Navigation (`web/src/components/Layout.tsx`)**:
  - CloudPanel Pro-inspired top navigation bar with dynamic server health indicators (CPU, RAM, Load, Uptime).
  - Sidebar navigation divided into Applications, Runtimes & Servers, and Security & Tools.
  - Axon Panel branding (`AP` badge).
- **Pages**:
  - `Dashboard.tsx`: Server hero section, CPU/RAM/Disk resource cards, quick action links, websites table with status badges and actions, security posture summary card.
  - `Sites.tsx`: Website inventory, template-based site creation modal, vhost editor, enable/disable switches.
  - `Apps.tsx`: Application catalog grid with category filters, installation wizards, live step-by-step installation progress log.
  - `PhpManagement.tsx`: PHP version overview, extension switches, configuration editor.
  - `WebserverManagement.tsx`: Nginx configuration editor, reload control, version switcher, log viewer.
  - `Databases.tsx`: Dual-engine database management (MariaDB / PostgreSQL), user and permissions management, backup/restore, SQL console.
  - `Security.tsx`: UFW firewall rules table, Fail2ban jail inspector with manual ban/unban, SSH server configuration toggle, port scanner.
  - `Ssl.tsx`: Certificate manager, Let's Encrypt issuance modal, renewal triggers.
  - `DnsManagement.tsx`: DNS zone editor and BIND record manager.
  - `CronManagement.tsx`: Scheduled task list, crontab expression builder, manual trigger.
  - `Services.tsx`: Systemd and PM2 service grids with start/stop/restart controls and log viewers.
  - `Files.tsx`: File browser with safe root selection, file editor, drag-and-drop file upload.
  - `Terminal.tsx`: Xterm.js terminal emulator over WebSocket.
  - `Logs.tsx`: Real-time journalctl log viewer with live search and source filtering.
  - `Settings.tsx`: Security settings, 2FA setup modal with QR code, IP allowlist, audit log viewer.
  - `Login.tsx`: Login interface with TOTP 2FA challenge.

---

## 4. Current State vs. Master Specification Gap Analysis

| Feature Area | Current Implementation State | Master Specification Requirement | Status / Gap |
| :--- | :--- | :--- | :--- |
| **Internal Database** | Flat JSON (`/etc/webpanel/config.json`), in-memory Maps | SQLite with WAL mode, transactions, migrations, foreign keys | **Critical Gap**: Needs SQLite database layer |
| **RBAC & Multi-Tenancy** | Single admin account (`config.json`), no role separation | 6 roles (Super Admin, Server Admin, Reseller, Customer, Developer, Read-only) | **Critical Gap**: Multi-tenancy & permission checks missing |
| **Customer Portal** | Unified Admin interface only | Dedicated Customer portal with simplified navigation and strict resource scoping | **Critical Gap**: Customer UI and portal separation missing |
| **Task Queue** | In-memory `Map` in `server/routes/apps.js` | Persistent SQLite-backed task queue, worker daemon, retry policies, timeouts | **Critical Gap**: Task queue lost on process restart |
| **Design System & Themes** | Tailwind dark-leaning theme, hardcoded CSS | Exact Dark (`#080F19`) & Light (`#F7F9FC`) palettes, persistent switcher | **Moderate Gap**: Colors need token alignment & light mode toggle |
| **Astro & Headless CMS** | Basic static template and catalog entry | First-class Astro manager (Static/SSR, Node adapter), Headless CMS integrations | **Moderate Gap**: Needs dedicated tab, build hooks, SSR management |
| **WordPress Toolkit** | Catalog download & wp-config creation | WP-CLI integration, updates, plugin manager, security hardening, checksum checks | **Moderate Gap**: Needs WP-CLI automation |
| **Laravel Engine** | Catalog install with artisan key:generate | Artisan runner, queue worker supervisor generator, scheduler cron setup | **Moderate Gap**: Needs worker supervision & artisan UI |
| **Node.js / Next.js** | PM2 service listing and basic app template | Port allocation pool, native systemd or PM2 mode, build runner, rollback | **Moderate Gap**: Needs automated port pool & systemd unit gen |
| **Backup System** | Ad-hoc `mysqldump` and `tar` to `/root/backups` | Restic integration, snapshot management, local, SFTP, and S3-compatible targets | **Major Gap**: Needs Restic engine & remote storage options |
| **Security Scanner** | Port scanner (`ss -tulpn`), UFW, Fail2ban | File integrity monitoring, malware signature scanning, permission audit | **Moderate Gap**: Needs automated scanner module |
| **API Versioning** | Unversioned `/api/*` | Versioned REST API (`/api/v1/*`) with backward compatibility | **Moderate Gap**: Needs v1 route aliasing/migration |

---

## 5. Security Posture Evaluation

### 5.1 Strengths
1. **Zero Shell Interpolation**: All command executions use `execFile` or `spawn` directly with argument arrays. No user input passes through `/bin/sh` or `bash -c`.
2. **Binary Allowlist**: `server/lib/exec.js` maintains an explicit allowlist of permitted binaries. Shell utilities such as `rm`, `wget`, `nc`, `python3`, `perl`, `sed`, `awk`, `dd`, and `eval` are rejected.
3. **Strict Path Containment**: `resolveSafePath` resolves symlinks and canonical paths, verifying that file operations are strictly confined within `allowedRoots`.
4. **Key Protection**: `assertNotSensitive` actively blocks access to SSH private keys (`id_rsa`, `id_ed25519`), SSL private keys (`privkey.pem`), arbitrary `.key` files, and `/etc/shadow`.
5. **CSRF & Rate Limiting**: All state-mutating requests require the `x-requested-with: webpanel` header. Authentication attempts are rate-limited and IPs locked out after 5 consecutive failures.
6. **2FA Implementation**: RFC 6238 TOTP two-factor authentication is functional with visual QR code provisioning.

### 5.2 Areas Requiring Hardening for Multi-Tenancy
1. **Process Privilege**: The panel runs as `root` via systemd. While necessary for web server and service management, customer-level actions (e.g. running builds or touching files) must execute dropped privileges under dedicated Linux users (e.g., `www-data` or per-customer system users).
2. **Resource Scoping**: Currently, any authenticated user with a valid JWT has full access to all endpoints. When multi-tenancy is introduced, every route must enforce organization/customer ownership checks.
3. **Database Credentials**: Database passwords in one-click apps are stored in plaintext in the installer logs and virtual host configurations. Credentials should be encrypted at rest using an AES-256-GCM master key.

---

## 6. Recommendations & Action Items for Phase 1

1. **Introduce Internal SQLite Engine**: Transition from flat JSON storage to an embedded SQLite database (`better-sqlite3` or `sqlite3` in WAL mode) located at `/etc/webpanel/axon.db`. Preserve `config.json` for initial bootstrap and system recovery.
2. **Implement Multi-Tenant RBAC**: Define the 6 user roles with granular permission masks. Create database tables for users, organizations, website assignments, and audit events.
3. **Deploy SQLite Task Queue**: Replace the in-memory app installation queue with a resilient, persistent task queue capable of handling background tasks, retries, and step-by-step progress logging.
4. **Align Design System with Specification**: Implement the specified Dark (`#080F19`) and Light (`#F7F9FC`) palettes, complete with a topbar theme toggle and persistent storage.
5. **Elevate Astro & Node Applications**: Implement native port reservation management and dual-mode runtime deployment (static build vs SSR daemon).
6. **Integrate Restic for Backups**: Add Restic binary to allowlist and provide snapshot-based, encrypted local and remote (S3/SFTP) backups.
