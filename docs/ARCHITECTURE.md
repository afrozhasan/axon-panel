# Axon Panel — System Architecture Specification

**Document Version:** 1.0.0  
**Status:** Approved for Implementation Planning  
**Target Environment:** Linux Ubuntu 24.04 LTS (x86_64, 1 GB+ RAM baseline)  
**File Location:** `/root/webpanel/docs/ARCHITECTURE.md`  

---

## 1. High-Level Architectural Vision

Axon Panel is engineered as a lightweight, modular, and secure Linux hosting control panel. It bridges modern web interfaces with real Linux server administration without introducing heavy, memory-intensive dependencies (such as Docker, Kubernetes, Prometheus, or Redis as mandatory prerequisites).

The architecture adheres to three core design tenets:
1. **Lightweight Footprint**: Base memory footprint under 60 MB RSS, allowing full functionality on servers with as little as 1 GB RAM.
2. **Strict Security Boundaries**: Strict separation between the web-facing control plane and privileged OS operations via an allowlisted execution bridge.
3. **Multi-Stack Versatility**: Native, first-class orchestration for WordPress, Laravel, Node.js, Next.js, Astro (Static & SSR), generic PHP, and static sites.

```
                        +---------------------------------------------+
                        |           Web Browser / Client UI          |
                        | (React 19, TypeScript, Vite, Tailwind v4)   |
                        +---------------------------------------------+
                                               |
                                     HTTPS / WSS (Port 443)
                                               |
                                               v
                        +---------------------------------------------+
                        |                 Nginx VHost                 |
                        |             (panel.example.com)             |
                        |      TLS Termination & Reverse Proxy        |
                        +---------------------------------------------+
                                               |
                                      HTTP (127.0.0.1:9090)
                                               |
                                               v
+---------------------------------------------------------------------------------------+
|                              Axon Panel Control Plane                                 |
|                                                                                       |
|  +--------------------+   +----------------------+   +-----------------------------+  |
|  |  HTTP & WS Server  |   | Security Middleware  |   |   Versioned REST API        |  |
|  |  (Express 5.1.0)   |-->| (Auth, RBAC, CSRF,   |-->|   (/api/v1/*)               |  |
|  |  Port: 9090        |   |  RateLimit, IP Allow)|   |   Sites, Apps, DBs, SSL...  |  |
|  +--------------------+   +----------------------+   +-----------------------------+  |
|                                                              |                        |
|                               +------------------------------+                        |
|                               |                                                       |
|                               v                                                       |
|  +---------------------------------------------------------------------------------+  |
|  |                             Core Services & Drivers                             |  |
|  |  - Site Engine (Nginx vhosts)         - Database Manager (MariaDB / Postgres)   |  |
|  |  - Runtime Manager (PHP-FPM, Node)    - Backup Engine (Restic / Tar / S3)       |  |
|  |  - App Store (Astro, WP, Laravel)     - Security Engine (UFW, Fail2ban, SSH)    |  |
|  +---------------------------------------------------------------------------------+  |
|           |                                                      |                    |
|           v                                                      v                    |
|  +-----------------------------------+          +----------------------------------+  |
|  |     Internal SQLite Database      |          |    Persistent Task Queue         |  |
|  | (/etc/webpanel/axon.db, WAL Mode) |          | (SQLite-backed, Systemd Worker)  |  |
|  | Metadata, Users, RBAC, Sites, Jobs|          | Async jobs, retries, concurrency |  |
|  +-----------------------------------+          +----------------------------------+  |
+---------------------------------------------------------------------------------------+
                                        |
                            Safe IPC / Child Process
                                        |
                                        v
+---------------------------------------------------------------------------------------+
|                           Privileged Server Operations                                |
|                                                                                       |
|  +---------------------------------------------------------------------------------+  |
|  |               Allowlisted Execution Engine (`server/lib/exec.js`)               |  |
|  |  - No shell interpolation (execFile/spawn only)                                 |  |
|  |  - Strict binary allowlist (nginx, certbot, systemctl, mariadb, php, etc.)      |  |
|  |  - Real-time argument validation, path traversal bounds, timeout management     |  |
|  +---------------------------------------------------------------------------------+  |
|                                        |                                              |
|            +---------------------------+---------------------------+                  |
|            v                           v                           v                  |
|  +-------------------+       +-------------------+       +-------------------+        |
|  |   System Daemons  |       |  Filesystem & Web |       | Database Engines  |        |
|  |  Nginx, Systemd,  |       |  /var/www/*,      |       |  MariaDB 10.11,   |        |
|  |  UFW, Fail2ban,   |       |  /etc/nginx/*,    |       |  PostgreSQL 16,   |        |
|  |  PHP-FPM, Certbot |       |  /etc/letsencrypt |       |  Redis Server     |        |
|  +-------------------+       +-------------------+       +-------------------+        |
+---------------------------------------------------------------------------------------+
```

---

## 2. Modular Architecture: Core vs. Optional Modules

The platform is partitioned into **Core Components** (always loaded, zero heavy dependencies) and **Pluggable/Optional Modules** (lazy-loaded or conditionally activated based on host capabilities).

### 2.1 Core Components (Mandatory)
- **Web Server Gateway**: Nginx configuration generator, validator, and supervisor.
- **Application Engine**: PHP-FPM pool manager, Node.js process supervisor, static website server.
- **Astro & Modern Web Stack**: Automated static asset deployment, Node adapter SSR handling, port allocation.
- **Internal Database**: Embedded SQLite (`/etc/webpanel/axon.db`) in Write-Ahead Logging (WAL) mode.
- **Authentication & RBAC**: Multi-tenant authorization matrix supporting 6 distinct user roles.
- **Task & Job Manager**: Persistent background worker executing long-running operations (installations, builds, backups).
- **Core Security**: UFW firewall manager, Fail2ban jail inspector, SSH hardening, and TOTP 2FA.

### 2.2 Optional Modules (On-Demand)
- **Relational Databases**: MariaDB and PostgreSQL modules. Panel functions seamlessly if only one (or neither) is installed.
- **Caching Layer**: Redis supervisor and object cache integration.
- **Advanced Backup**: Restic snapshot manager with remote SFTP/S3 syncing. Falls back to built-in compressed tarballs if Restic is absent.
- **Process Supervisor Modes**: PM2 integration alongside native systemd user unit management for Node.js apps.
- **Terminal Emulator**: Web-based xterm.js PTY shell, configurable with IP restrictions or disabled entirely.

---

## 3. Security Boundaries & Execution Architecture

### 3.1 Control Plane vs. Privileged Operations
Axon Panel avoids the classic vulnerability of control panels: passing unsanitized frontend input into `/bin/sh`.

1. **Strict Binary Allowlisting**: Operations are dispatched through `server/lib/exec.js`. Only explicitly registered binaries (e.g., `nginx`, `certbot`, `systemctl`, `mariadb`, `composer`, `npm`, `php8.4`) can ever be executed.
2. **Argument Array Calling**: All invocations utilize `execFile` or `spawn` directly. Shell metacharacters (`|`, `;`, `&`, `$`, `` ` ``, `>`, `<`) are treated as literal strings and cannot chain commands.
3. **User Dropping for App Runtimes**: Website file creations, npm builds, and composer installs execute under unprivileged user contexts (`www-data` or per-site customer UIDs), preventing web workloads from affecting system-level configurations.
4. **Agent Evolution Path**: The current Node.js privileged execution bridge will be abstracted behind a standard internal interface (`ServerAgentClient`). This enables drop-in replacement with a standalone compiled Go daemon (`axon-agent`) communicating via Unix domain socket (`/run/axon-agent.sock`) with mTLS/token auth without disrupting any higher-level API routes.

---

## 4. Internal Database Architecture (SQLite + WAL)

Axon Panel eliminates single-point-of-failure JSON file corruption by transitioning panel state to an embedded SQLite database.

- **Location**: `/etc/webpanel/axon.db` (permissions `0600 root:root`)
- **Journal Mode**: `WAL` (Write-Ahead Logging) for high-performance concurrent reads and single-writer safety.
- **Synchronous**: `NORMAL` (optimal balance of reliability and speed).
- **Busy Timeout**: 5000 ms with automatic retry.

### 4.1 Core Relational Schema

```sql
-- 1. Organizations & Customers
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    max_websites INTEGER DEFAULT 5,
    max_databases INTEGER DEFAULT 5,
    max_storage_mb INTEGER DEFAULT 5120,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users & RBAC
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('super_admin', 'server_admin', 'reseller', 'customer', 'developer', 'read_only')),
    totp_secret TEXT,
    totp_enabled INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'pending')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME
);

-- 3. Websites & Applications
CREATE TABLE IF NOT EXISTS websites (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT UNIQUE NOT NULL,
    primary_domain TEXT NOT NULL,
    app_type TEXT NOT NULL CHECK(app_type IN ('astro', 'wordpress', 'laravel', 'nodejs', 'nextjs', 'php', 'static')),
    runtime_mode TEXT DEFAULT 'standard', -- 'static' or 'ssr' for Astro/Next
    document_root TEXT NOT NULL,
    php_version TEXT,
    assigned_port INTEGER UNIQUE,
    supervisor_type TEXT DEFAULT 'systemd' CHECK(supervisor_type IN ('systemd', 'pm2', 'none')),
    ssl_enabled INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'suspended', 'maintenance')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 4. Domains & Aliases
CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    website_id TEXT REFERENCES websites(id) ON DELETE CASCADE,
    domain TEXT UNIQUE NOT NULL,
    is_primary INTEGER DEFAULT 0,
    ssl_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Databases
CREATE TABLE IF NOT EXISTS databases (
    id TEXT PRIMARY KEY,
    organization_id TEXT REFERENCES organizations(id) ON DELETE CASCADE,
    website_id TEXT REFERENCES websites(id) ON DELETE SET NULL,
    engine TEXT NOT NULL CHECK(engine IN ('mariadb', 'postgres')),
    db_name TEXT NOT NULL,
    db_user TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. Persistent Task Queue
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    organization_id TEXT,
    user_id TEXT REFERENCES users(id),
    task_type TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    payload_json TEXT NOT NULL,
    progress_percent INTEGER DEFAULT 0,
    logs TEXT DEFAULT '',
    error_message TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME
);

-- 7. Audit Log
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    ip_address TEXT NOT NULL,
    details_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning-fast queries
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_websites_org ON websites(organization_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
```

---

## 5. Persistent Task Queue & Worker Daemon

To avoid in-memory job loss during server restarts or deployment timeouts, tasks execute through a dedicated background task supervisor:

1. **Producer**: Express API routes (`POST /api/v1/apps/install`, `POST /api/v1/backups/create`) enqueue tasks into the `tasks` table with status `pending`.
2. **Consumer (Worker)**: A lightweight asynchronous loop running under the panel daemon (or as an independent systemd worker) polls `tasks WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 1`.
3. **Execution & Heartbeat**: The worker marks the task `running`, attaches a streaming log buffer, and updates `progress_percent`.
4. **Retry & Recovery**: If a task fails, the worker evaluates `attempts < max_attempts`. If eligible, it re-queues with exponential backoff; otherwise, it marks `failed` and triggers notification hooks.

---

## 6. API Architecture & Versioning Strategy (`/api/v1`)

To maintain stability and enable mobile/external integrations, the API adopts a versioned REST architecture:
- All new routes are namespaced under `/api/v1/*`.
- Existing unversioned `/api/*` endpoints are preserved via transparent internal aliasing to prevent breaking existing UI components or integration scripts.
- Consistent envelope response structure:
  ```json
  {
    "success": true,
    "data": { ... },
    "error": null,
    "meta": { "timestamp": 1730910000, "requestId": "req_xyz123" }
  }
  ```

---

## 7. Frontend Component Architecture & Design System

The Axon Panel user interface implements the exact visual design language specified in the Master Specification and reference designs:

### 7.1 Design System Color Tokens

#### Dark Theme (Default)
- **Background**: `#080F19`
- **Sidebar**: `#0B1420`
- **Cards & Surfaces**: `#111D2A`
- **Borders & Dividers**: `#223244`
- **Primary / Brand**: `#14CFC4` (Teal)
- **Secondary / Accent**: `#818CF8` (Indigo)
- **Success**: `#22C55E` (Emerald)
- **Warning**: `#F59E0B` (Amber)
- **Danger**: `#EF4444` (Rose/Red)
- **Main Text**: `#F1F5F9`
- **Muted Text**: `#94A3B8`

#### Light Theme
- **Background**: `#F7F9FC`
- **Sidebar**: `#FFFFFF`
- **Cards & Surfaces**: `#FFFFFF`
- **Borders & Dividers**: `#E5EAF1`
- **Primary / Brand**: `#0DADA5`
- **Secondary / Accent**: `#6366F1`
- **Success**: `#16A34A`
- **Warning**: `#D97706`
- **Danger**: `#DC2626`
- **Main Text**: `#172033`
- **Muted Text**: `#64748B`

### 7.2 UI Structure & Navigation Architecture
- **Persistent Header**: Collapsible sidebar trigger, global search, notifications center, help link, server selector, theme toggle (Dark / Light / System), and user profile dropdown.
- **Role-Aware Dual Portal**:
  - **Administrator Portal**: Complete VPS oversight, all applications, system runtimes, databases, security, infrastructure, customers, hosting plans, and audit logs.
  - **Customer Portal**: Streamlined view restricted exclusively to the customer's owned websites, domains, databases, file manager, SSL certificates, cron jobs, and resource utilization.
- **Responsive Layout**: Fluid breakpoints with mobile drawer navigation, collapsible desktop sidebar with compact icon mode, and accessible ARIA attributes.
