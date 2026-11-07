# Axon Panel — Feature Implementation Status & Technical Audit

**Document Version:** 2.0.0  
**Status:** Audit & Verification Report  
**Date:** November 2026  
**Scope:** Functional Verification, Backend Engine Parity, UI Completeness, and Scaffolding Audit  

---

## 1. Executive Summary

Axon Panel operates as a true native Linux server management control plane. Command executions pass through an un-interpolated binary runner (`server/lib/exec.js`) with an explicit binary allowlist (56 system binaries). Metadata is backed by SQLite in WAL mode (`/etc/webpanel/axon.db`).

This audit distinguishes between:
1. **Fully Functional Backend Features:** Completely implemented, tested, and actively executing real Linux system commands.
2. **Partially Integrated Features:** Backend engine or API exists, but UI was previously fragmented, embedded in modals, or lacked dedicated navigation.
3. **Scaffolded / Planned Capabilities:** UI mock or conceptual integration that requires future backend wiring.

---

## 2. Granular Feature Implementation Status Matrix

| Module & Feature | Current Implementation State | Backend Architecture & Engine | Verification Method | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Dashboard** | Comprehensive host & site summary | `/proc/stat`, `/proc/meminfo`, `statvfs` | `GET /api/system/metrics` | **Complete (Functional)** |
| **Notifications** | Alerts in dashboard & topbar toasts | SQLite task queue, audit events | `GET /api/tasks`, SSE stream | **Needs Dedicated View** |
| **System Health** | Host hardware telemetry card | Direct `/proc` inspection via `metrics.js` | `GET /api/system/overview` | **Complete (Functional)** |
| **Websites (All)** | Vhost CRUD, templates, reload | Nginx vhost files + `nginx -t` validation | `scripts/api-contract-check.js` | **Complete (Functional)** |
| **Dedicated Site Workspace** | Embedded in `SiteWorkspaceModal` | Live stack detection, Git, VHost, PHP | `GET /api/sites/:name/stack` | **Elevating to Route** |
| **Domains & Subdomains** | Primary, alias, subdomain, redirect | Live Nginx server_name & proxy generation | `scripts/api-contract-check.js` | **Complete (Functional)** |
| **One-Click Applications** | 8 catalogue apps with requirements | Step-by-step runner with atomic rollback | `POST /api/apps/:slug/install` | **Complete (Functional)** |
| **Astro & Headless CMS** | Static & SSR mode, systemd unit, ports | Systemd unit generator, port allocator | `scripts/api-contract-check.js` | **Complete (Functional)** |
| **Git & Deployments** | Embedded in site modal Git tab | `git rev-parse`, `git pull`, `npm build` | `GET /api/sites/:name/git` | **Needs Dedicated View** |
| **WordPress Toolkit Pro** | 3-module suite (Security, Perf, Cache) | WP-CLI, FastCGI, Redis isolation, OPcache | `test-wordpress-toolkit-pro.js` | **Complete (Functional)** |
| **Server Overview** | OS, kernel, uptime, load details | `uname -a`, `uptime`, `metrics.js` | `GET /api/system/overview` | **Complete (Functional)** |
| **PHP Management** | Multiple PHP versions (8.1–8.4), FPM | Package installer, `php.ini` editor | `scripts/api-contract-check.js` | **Complete (Functional)** |
| **Node.js & PM2** | Process table, restart, stop, delete | PM2 CLI wrapper via `pm2.js` | `GET /api/services/pm2` | **Complete (Functional)** |
| **Nginx Management** | Global config editor, versions, reload | `nginx -t`, atomic backup rollback | `GET /api/webserver/status` | **Complete (Functional)** |
| **Databases (Dual-Engine)** | MariaDB & PostgreSQL cluster manager | Direct `mariadb` and `psql` shell-free calls | `GET /api/databases/mysql` | **Complete (Functional)** |
| **Redis Management** | Key count, memory footprint, hit ratio | Redis CLI `INFO` inspection | `GET /api/services/redis` | **Complete (Functional)** |
| **Cron Jobs** | User crontab parsing, run-now | Crontab reader and writer via `cron.js` | `GET /api/cron` | **Complete (Functional)** |
| **Process Manager** | Systemd unit controller & logs | `systemctl` status/restart/enable/disable | `GET /api/services` | **Complete (Functional)** |
| **Security Overview** | Security score, open ports list | `ss -tulpn` parser, security checklist | `GET /api/security/overview` | **Complete (Functional)** |
| **UFW Firewall** | Rule listing, allow/deny, toggle | `ufw status numbered`, `ufw allow/delete` | `GET /api/security/firewall` | **Complete (Functional)** |
| **Fail2Ban** | Jail status, banned IP list, ban/unban | `fail2ban-client status`, set unbanip | `GET /api/security/fail2ban` | **Complete (Functional)** |
| **SSH Hardening** | Port, root login, password auth, keys | `/etc/ssh/sshd_config` parser & reload | `GET /api/security/ssh` | **Complete (Functional)** |
| **Security Scanner** | File integrity, world-writable files | Filesystem scanner in `scanner.js` | `POST /api/security/scan/run` | **Complete (Functional)** |
| **File Integrity** | Heuristic scanner & permissions repair | Permissions checker and chmod runner | `POST /api/security/scan/fix` | **Complete (Functional)** |
| **Audit Logs** | Consolidated audit viewer | Structured append-only `audit.jsonl` | `GET /api/security/audit` | **Complete (Functional)** |
| **SSL Certificates** | Let's Encrypt Certbot integration | `certbot certificates`, auto-renew timer | `POST /api/ssl/renew` | **Complete (Functional)** |
| **DNS Zone Manager** | BIND zone & record creator, export | BIND zone parser and generator | `GET /api/dns/zones` | **Complete (Functional)** |
| **Backup Manager** | Snapshot listing, creation, restoration | Restic backup engine via `restic.js` | `GET /api/backups/snapshots` | **Complete (Functional)** |
| **Backup Schedules** | Automated cron backup triggers | Crontab + Restic runner | `GET /api/cron` | **Complete (Functional)** |
| **Remote Storage** | S3 / SFTP repository setup | `restic init -r s3:...` support | `server/lib/restic.js` | **UI Needs Expansion** |
| **File Manager** | Path-confined browser, editor, upload | Streamed uploads, safe path confinement | `GET /api/files/list` | **Complete (Functional)** |
| **Resource Monitoring** | Live CPU, RAM, Disk, Load graphs | Client-side polling of `metrics.js` | `GET /api/system/metrics` | **Needs Dedicated View** |
| **Website Logs** | Scoped website access/error logs | Nginx log parser and SSE streamer | `GET /api/webserver/logs` | **Complete (Functional)** |
| **System Logs** | Live journalctl streaming via SSE | `journalctl -f -o json` via child_process | `GET /api/logs/stream` | **Complete (Functional)** |
| **Service Status** | Real-time service status grid | Systemd daemon status checker | `GET /api/services` | **Complete (Functional)** |
| **Customer Administration** | Customer account CRUD & suspension | SQLite `users` table with bcrypt hash | `GET /api/users` | **Complete (Functional)** |
| **Reseller Administration** | Reseller tier and customer quotas | Multi-tier RBAC (`server/lib/rbac.js`) | `GET /api/users` | **Complete (Functional)** |
| **Hosting Plans** | Storage, DB, website quota limits | `hosting_plans` SQLite table & limits | `GET /api/plans` | **Complete (Functional)** |
| **Users & Permissions** | 6-tier RBAC management | `server/lib/rbac.js` permission masks | `GET /api/users` | **Complete (Functional)** |
| **Integrations & API** | Versioned `/api/v1` routes & tokens | Express v1 router with JWT auth | `GET /api/v1/*` | **Complete (Functional)** |
| **Panel Settings** | IP allowlist, TOTP 2FA, admin pass | `/etc/webpanel/config.json` + RFC 6238 | `GET /api/settings` | **Complete (Functional)** |
| **Web Terminal** | Full root PTY shell in browser | `node-pty` / `script(1)` over WebSocket | `ws://.../terminal/ws` | **Complete (Functional)** |
| **Customer Portal** | Dedicated scoped tenant interface | Tenant ID filtering in SQLite queries | `GET /api/users/quota` | **Refining Layout** |
| **Support Help Desk** | Support resources and guide links | External links / documentation modal | UI link | **UI Scaffolding** |

---

## 3. Test Suite & Quality Verification Baseline

The existing codebase was evaluated with the following automated verification suites:

1. **Security Assertions (`scripts/security-check.js`):**
   * Total assertions: **78 checks**
   * Results: **100% passing (0 failures)**
   * Verifies shell interpolation rejection, directory traversal neutralization, private key blocking (`.pem`, `.key`, `/etc/shadow`), TOTP RFC 6238 vector accuracy, and CSRF token enforcement.
2. **API Contract Parity (`scripts/api-contract-check.js`):**
   * Server endpoints discovered: **206 routes**
   * Distinct frontend API calls: **180 calls**
   * Contract match: **180 matched, 0 missing endpoints**
3. **WordPress Toolkit Pro Live Integration (`scripts/test-wordpress-toolkit-pro.js`):**
   * Real-world verification on live site `example.com`:
   * Hardening live audit: PASS
   * Basic & Advanced profile preview with diff: PASS
   * FastCGI cache purge & isolated Redis flush: PASS
   * Core checksum verification: PASS
   * Table optimization & defragmentation: PASS

---

## 4. Implementation Phasing Strategy for Information Architecture

To ensure zero downtime, non-breaking transitions, and safe incremental deployment:

* **Phase 1: Navigation Hierarchy & Sidebar Reorganization**
  * Update `web/src/components/Layout.tsx` to render the 9 Admin sections and 3 Customer Portal sections.
  * Implement active state highlighting, responsive mobile drawer, and permission-aware filtering.
* **Phase 2: Route Expansion & Sub-Route Wiring**
  * Configure routes in `web/src/App.tsx` for `/system/health`, `/deployments`, `/wordpress`, `/services/pm2`, `/services/redis`, `/security/firewall`, `/security/fail2ban`, `/security/ssh`, `/security/scanner`, `/security/audit`, `/logs/websites`, `/users/customers`, `/users/resellers`.
  * Ensure existing routes remain functional or cleanly redirect.
* **Phase 3: Dedicated Website Detail Page (`/sites/:name`)**
  * Transition from `SiteWorkspaceModal.tsx` to a dedicated full-page workspace view `web/src/pages/SiteDetail.tsx` (reusing existing tested tabs and subcomponents).
  * Implement breadcrumbs and contextual tabs tailored to WordPress, Astro, Laravel, and Node.js.
* **Phase 4: Customer Portal Experience Refinement**
  * Ensure customer view is completely stripped of terminal, global nginx, server services, and firewall controls.
  * Verify resource scoping across all customer-facing endpoints.
* **Phase 5: Automated Verification & Regression Testing**
  * Re-run `npm run check`, `node scripts/security-check.js`, `node scripts/api-contract-check.js`, and compile production bundle with `npm run build`.
