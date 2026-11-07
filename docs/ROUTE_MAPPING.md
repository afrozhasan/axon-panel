# Axon Panel — Route & Navigation Mapping Specification

**Document Version:** 2.0.0  
**Status:** Route Specification  
**Date:** November 2026  
**Scope:** Frontend and Backend URL Paths, Redirects, Duplicate Resolution, and Sub-Tab Mappings  

---

## 1. Overview & Strategy

This document establishes the comprehensive mapping from the legacy flat navigation routes to the reorganized, domain-clustered Information Architecture.

### Core Principles
1. **Zero Broken Links:** All previous frontend paths (`/sites`, `/apps`, `/databases`, `/security`, `/ssl`, `/files`, etc.) continue to function without disruption.
2. **Predictable Deep Linking:** Sub-views and tabs (such as firewall rules, PHP pools, or WP security audits) support direct, bookmarkable URLs and query parameters.
3. **Explicit Customer & Admin Route Guards:** Routes enforce role permissions client-side and server-side, preventing customers from rendering or invoking administrator routes.

---

## 2. Administrator Navigation Route Mapping

| Admin Section | Feature Item | New Route Path | Legacy / Existing Route | Backend Endpoints Invoked | Status & Mapping Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Overview** | Dashboard | `/` or `/dashboard` | `/` | `GET /api/system/metrics`<br>`GET /api/system/overview`<br>`GET /api/sites`<br>`GET /api/security/overview` | Primary entry point. Preserved. |
| | Notifications | `/notifications` | Header alerts & toasts | `GET /api/tasks`<br>`GET /api/tasks/:id/stream`<br>`GET /api/security/audit` | Elevated to dedicated view with real-time SSE stream. |
| | System Health | `/system/health` | Embedded in Dashboard & Topbar | `GET /api/system/metrics`<br>`GET /api/system/overview` | Dedicated host telemetry view (CPU, RAM, Disks, Load, Uptime). |
| **2. Websites** | All Websites | `/sites` | `/sites` | `GET /api/sites`<br>`POST /api/sites`<br>`DELETE /api/sites/:name`<br>`POST /api/sites/:name/enable`<br>`POST /api/sites/:name/disable` | Primary site catalog. Direct clicks route to dedicated `/sites/:name`. |
| | Domains & Subdomains | `/domains` | `/domains` | `GET /api/domains`<br>`POST /api/domains`<br>`PUT /api/sites/:name/domains/:d`<br>`DELETE /api/sites/:name/domains/:d` | Multi-domain and redirect routing center. |
| | One-Click Applications | `/apps` | `/apps` | `GET /api/apps`<br>`GET /api/apps/:id`<br>`POST /api/apps/:id/install`<br>`GET /api/apps/jobs/:id` | Application catalogue and installer wizard. |
| | Astro & Headless CMS | `/astro` | `/astro` | `GET /api/astro/projects`<br>`POST /api/astro/projects`<br>`POST /api/astro/preflight`<br>`POST /api/astro/projects/:id/rebuild` | Astro and Headless CMS project orchestration. |
| | Git & Deployments | `/deployments` | Modal tab in `SiteWorkspaceModal` | `GET /api/sites/:name/git`<br>`POST /api/sites/:name/node/build`<br>`GET /api/tasks` | Consolidated deployment view for all git-linked websites. |
| | WordPress Toolkit | `/wordpress` | Embedded modal tab | `GET /api/wp/:name/overview`<br>`GET /api/wp/:name/security/audit`<br>`GET /api/wp/:name/cache/status` | Consolidated overview of all detected WP installations. |
| **3. Server Management** | Server Overview | `/server` | Embedded in Dashboard | `GET /api/system/overview`<br>`GET /api/system/metrics` | Host OS, Kernel, memory limits, and hardware metrics. |
| | PHP Management | `/php` | `/php` | `GET /api/php`<br>`GET /api/php/:v/config`<br>`POST /api/php/:v/config`<br>`POST /api/php/:v/extensions/toggle` | PHP versions (8.1–8.4), extensions, FPM pools, ini editor. |
| | Node.js & PM2 | `/services/pm2` | `/services?tab=pm2` | `GET /api/services/pm2`<br>`POST /api/services/pm2/:id/:action`<br>`GET /api/services/pm2/:id/logs` | Deep link to PM2 daemon processes and application logs. |
| | Nginx Management | `/webserver` | `/webserver` | `GET /api/webserver/status`<br>`GET /api/webserver/config`<br>`POST /api/webserver/config`<br>`POST /api/webserver/action` | Global web server config, reload, logs, version switcher. |
| | Databases | `/databases` | `/databases` | `GET /api/databases/mysql`<br>`GET /api/databases/postgres`<br>`POST /api/databases/:type/query`<br>`POST /api/databases/backup-all` | MariaDB and PostgreSQL cluster administration. |
| | Redis Management | `/services/redis` | `/services?tab=redis` | `GET /api/services/redis` | Deep link to Redis memory, connected clients, cache stats. |
| | Cron Jobs | `/cron` | `/cron` | `GET /api/cron`<br>`POST /api/cron`<br>`POST /api/cron/run-now`<br>`DELETE /api/cron/:user/:idx` | System and user scheduled tasks manager. |
| | Process Manager | `/services` | `/services` (systemd tab) | `GET /api/services`<br>`POST /api/services/units/:name/:action`<br>`GET /api/services/units/:name/logs` | Systemd unit supervisor with journal log viewers. |
| **4. Security** | Security Overview | `/security` | `/security` | `GET /api/security/overview`<br>`GET /api/security/ports` | Security health status, open ports overview. |
| | Firewall | `/security/firewall` | `/security?tab=firewall` | `GET /api/security/firewall`<br>`POST /api/security/firewall/toggle`<br>`POST /api/security/firewall/rules` | UFW firewall rules, policies, and toggles. |
| | Fail2Ban | `/security/fail2ban` | `/security?tab=fail2ban` | `GET /api/security/fail2ban`<br>`POST /api/security/fail2ban/ban`<br>`POST /api/security/fail2ban/unban` | Intrusion detection jails, banned IP management. |
| | SSH & Access Keys | `/security/ssh` | `/security?tab=ssh` | `GET /api/security/ssh`<br>`POST /api/security/ssh` | SSH port, root login, password auth, public keys. |
| | Security Scanner | `/security/scanner` | `/security?tab=scanner` | `GET /api/security/scan`<br>`POST /api/security/scan/run` | Full website vulnerability & permissions scanner. |
| | File Integrity | `/security/integrity` | `/security?tab=scanner` | `GET /api/security/scan`<br>`POST /api/security/scan/fix` | Heuristic file audit, permissions repair. |
| | Audit Logs | `/security/audit` | `/settings?tab=audit` & `/security?tab=panel` | `GET /api/security/audit`<br>`GET /api/settings/audit` | Unified audit trail viewer (consolidated from duplicates). |
| **5. SSL & DNS** | SSL Certificates | `/ssl` | `/ssl` | `GET /api/ssl`<br>`POST /api/ssl/issue`<br>`POST /api/ssl/renew`<br>`POST /api/ssl/revoke` | Let's Encrypt Certbot certificates and auto-renew timers. |
| | DNS Zone Manager | `/dns` | `/dns` | `GET /api/dns/zones`<br>`POST /api/dns/zones`<br>`POST /api/dns/zones/:id/records` | BIND DNS zone and record manager. |
| **6. Backups & Storage** | Backup Manager | `/backups` | `/backups` | `GET /api/backups/status`<br>`GET /api/backups/snapshots`<br>`POST /api/backups/create`<br>`POST /api/backups/restore` | Snapshot browser, instant backup and restore triggers. |
| | Backup Schedules | `/backups/schedules` | `/cron` (backup tags) | `GET /api/cron`<br>`POST /api/cron` | Automated backup schedules and cron task triggers. |
| | Remote Storage | `/backups/remote` | `server/lib/restic.js` backend | `GET /api/backups/status` | S3, SFTP, MinIO, Cloudflare R2 repository setup. |
| | File Manager | `/files` | `/files` | `GET /api/files/roots`<br>`GET /api/files/list`<br>`GET /api/files/read`<br>`PUT /api/files/write`<br>`POST /api/files/upload` | Path-confined root and docroot file browser and editor. |
| **7. Monitoring & Logs** | Resource Monitoring | `/monitoring` | Topbar / Dashboard | `GET /api/system/metrics`<br>`GET /api/system/overview` | Live metrics stream (CPU, RAM, Load, Disk, Bandwidth). |
| | Website Logs | `/logs/websites` | `/logs` (nginx filter) | `GET /api/webserver/logs`<br>`GET /api/logs/stream?filter=nginx` | Scoped website access and error log live tailing. |
| | System Logs | `/logs` | `/logs` | `GET /api/logs/sources`<br>`GET /api/logs/snapshot`<br>`GET /api/logs/stream` | Full journalctl system log streaming (SSE). |
| | Service Status | `/monitoring/services` | `/services` (systemd tab) | `GET /api/services` | Service health grid (systemd, PM2, Redis, MariaDB, Postgres). |
| **8. Hosting Admin** | Customers | `/users/customers` | `/users?role=customer` | `GET /api/users`<br>`POST /api/users`<br>`PUT /api/users/:id` | Dedicated customer account administration. |
| | Resellers | `/users/resellers` | `/users?role=reseller` | `GET /api/users`<br>`POST /api/users`<br>`PUT /api/users/:id` | Dedicated reseller account administration. |
| | Hosting Plans | `/plans` | `/plans` | `GET /api/plans`<br>`POST /api/plans`<br>`PUT /api/plans/:id` | Quota packages (max sites, dbs, storage, bandwidth). |
| | Users & Permissions | `/users` | `/users` | `GET /api/users`<br>`POST /api/users`<br>`PUT /api/users/:id` | Comprehensive multi-role account manager. |
| | Integrations & API | `/settings/integrations` | `/settings` | `GET /api/settings`<br>`GET /api/auth/session` | API tokens, webhook trigger keys, versioned v1 API. |
| | Panel Settings | `/settings` | `/settings` | `GET /api/settings`<br>`PUT /api/settings`<br>`POST /api/auth/2fa/setup` | IP allowlist, TOTP 2FA, password management. |
| **9. Admin Tools** | Web Terminal | `/terminal` | `/terminal` | WebSocket `/terminal/ws` | Root interactive PTY web shell (Super Admin only). |

---

## 3. Customer Portal Route Mapping

When authenticated as `customer`, navigation is automatically redirected and scoped:

| Customer Section | Feature Item | Route Path | Backend Endpoints Invoked | Customer Scoping Enforcement |
| :--- | :--- | :--- | :--- | :--- |
| **MY HOSTING** | Dashboard | `/` | `GET /api/system/metrics`<br>`GET /api/users/quota`<br>`GET /api/sites` | Displays only customer's sites, quota consumption, and account health. |
| | My Websites | `/sites` | `GET /api/sites`<br>`POST /api/sites`<br>`GET /api/sites/:name` | Filtered strictly to `organization_id == actor.orgId`. |
| | Domains | `/domains` | `GET /api/domains`<br>`POST /api/domains` | Only domains attached to customer's owned websites. |
| | Applications | `/apps` | `GET /api/apps`<br>`POST /api/apps/:slug/install` | One-click app provisioning bounded by hosting plan quota. |
| | Git Deployments | `/deployments` | `GET /api/sites/:name/git`<br>`POST /api/sites/:name/node/build` | Git deployment pipeline for customer's repositories. |
| **WEBSITE SERVICES** | Databases | `/databases` | `GET /api/databases/mysql`<br>`POST /api/databases/mysql/databases` | Databases scoped by customer username prefix (`cust_*`). |
| | File Manager | `/files` | `GET /api/files/roots`<br>`GET /api/files/list`<br>`GET /api/files/read` | Restricted strictly to website document roots (`/var/www/site`). Root directories forbidden. |
| | SSL Certificates | `/ssl` | `GET /api/ssl`<br>`POST /api/ssl/issue` | SSL issuance strictly for domains owned by customer. |
| | Backups | `/backups` | `GET /api/backups/snapshots`<br>`POST /api/backups/create` | Website snapshot listing and creation for customer's sites. |
| | WordPress Toolkit | `/wordpress` | `GET /api/wp/:name/*`<br>`POST /api/wp/:name/*` | Security, cache, database, and plugin tools for customer WP sites. |
| **ACCOUNT** | Hosting Plan | `/plans` | `GET /api/plans`<br>`GET /api/users/quota` | Read-only view of current plan limits and available upgrades. |
| | Usage & Quotas | `/account/usage` | `GET /api/users/quota` | Detailed consumption breakdown (Disk, Databases, Sites, Bandwidth). |
| | Profile & Security | `/settings` | `GET /api/settings`<br>`POST /api/auth/password`<br>`POST /api/auth/2fa/setup` | Customer password change and personal TOTP 2FA. IP allowlist hidden. |
| | Support | `/support` | Help & documentation links | Customer documentation, ticket help, and support channel links. |

---

## 4. Dedicated Website Workspace Routing (`/sites/:name`)

Every website is managed via dedicated deep-linkable URLs:

```
/sites/:name                  -> Defaults to Overview tab
/sites/:name/overview         -> Health, server names, SSL status, quick actions
/sites/:name/settings         -> PHP version, site kind, document root, delete
/sites/:name/domains          -> Multi-domain, subdomains, redirect rules, SSL
/sites/:name/git              -> Repository link, branch, commit, auto-deploy, manual pull
/sites/:name/databases        -> Connected DBs, user grants, SQL query runner
/sites/:name/files            -> Path-confined File Manager focused on website docroot
/sites/:name/ssl              -> Let's Encrypt certificate issuance, renewal, force HTTPS
/sites/:name/security         -> Hardening audit, permission repair, blocklists
/sites/:name/performance      -> TTFB response times, compression, asset tuning
/sites/:name/cache            -> FastCGI/Redis cache status, purge actions
/sites/:name/backups          -> Website snapshots, one-click backup & restore
/sites/:name/logs             -> Dedicated access and error log viewer
```

### Stack-Specific Route Views (Embedded Contextually):
* **WordPress Sites:** `/sites/:name/wordpress` or contextual tabs:
  * Security (`/sites/:name/security`) -> WordPress Security Hardening + CVE Scanner
  * Optimization (`/sites/:name/performance`) -> Database Cleanup + WebP Image Optimization
  * Cache Manager (`/sites/:name/cache`) -> 6-Layer Cache Suite + Presets + Cloudflare
  * Plugins & Themes (`/sites/:name/plugins`) -> WP Plugin & Theme lifecycle
  * Database (`/sites/:name/databases`) -> WP DB Repair & Optimize
* **Astro Sites:** `/sites/:name/astro`
  * Static vs SSR toggle, systemd service daemon status, Node port assignment, Headless CMS integration
* **Laravel Sites:** `/sites/:name/laravel`
  * Artisan runner, queue worker daemon, scheduler cron, environment configuration
* **Node.js / Next.js Sites:** `/sites/:name/node`
  * Node runtime, PM2 / systemd process controls, environment variables, build scripts

---

## 5. Duplicate Navigation Consolidation

| Redundant / Fragmented Feature | Previous Locations | Consolidated Destination | Justification |
| :--- | :--- | :--- | :--- |
| **Audit Logs** | • `Security.tsx` (Panel tab)<br>• `Settings.tsx` (Audit tab) | `/security/audit` | Centralizes security audits under the Security section; Settings retains a link to `/security/audit`. |
| **Nginx Logs** | • `WebserverManagement.tsx` (Logs)<br>• `Logs.tsx` (General system logs) | Consolidated under `/logs/websites` with deep link in `/webserver` | Eliminates duplicated UI components; webserver page links directly to website logs tab. |
| **PM2 Process Logs** | • `Services.tsx` (PM2 logs modal)<br>• `Logs.tsx` (Journal units) | `/services/pm2` with dedicated log viewer tab | PM2 process logs are rendered natively within the Node.js & PM2 management view. |
| **WordPress Toolkit Entry** | • Floating modal inside `Sites.tsx` only | Dedicated `/wordpress` route + `/sites/:name` tabs | Makes WordPress Toolkit directly discoverable in primary navigation without opening modals. |
| **Customer vs Staff Users** | • Single table in `Users.tsx` with dropdown filter | `/users/customers`<br>`/users/resellers`<br>`/users` | Allows direct navigation from sidebar while preserving the unified table view. |

---

## 6. Backward Compatibility & Redirect Table

| Legacy URL | New Resolved Path | Behavior |
| :--- | :--- | :--- |
| `/security?tab=firewall` | `/security/firewall` | Supported via URL rewrite / tab state sync |
| `/security?tab=fail2ban` | `/security/fail2ban` | Supported via URL rewrite / tab state sync |
| `/security?tab=ssh` | `/security/ssh` | Supported via URL rewrite / tab state sync |
| `/security?tab=scanner` | `/security/scanner` | Supported via URL rewrite / tab state sync |
| `/security?tab=panel` | `/security/audit` | Redirected to consolidated Audit Logs |
| `/services?tab=pm2` | `/services/pm2` | Supported via URL rewrite / tab state sync |
| `/services?tab=redis` | `/services/redis` | Supported via URL rewrite / tab state sync |
| `/settings?tab=audit` | `/security/audit` | Redirected with breadcrumb link |
| `/sites?manage=:name` | `/sites/:name` | Transparently opens dedicated site workspace |
