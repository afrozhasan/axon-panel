# Axon Panel — Master Implementation Plan

**Scope:** Phase 1 (1A, 1B, 1C, 1D) Roadmap & Task Breakdown  
**Target Architecture:** Modular, Lightweight Multi-Stack Linux Control Panel  
**File Location:** `/root/webpanel/docs/IMPLEMENTATION_PLAN.md`  

---

## 1. Overview & Execution Strategy

This implementation plan outlines the granular tasks required to evolve Axon Panel into a multi-stack hosting control panel capable of managing production Linux resources while operating within constrained environments (down to 1 GB RAM baseline).

The deployment follows a four-stage sequential progression:
1. **Phase 1A — Foundation**: Database persistence (SQLite WAL), multi-role RBAC, persistent task queue, versioned API (`/api/v1`), and dual-theme visual design system.
2. **Phase 1B — Multi-Stack Hosting Engine**: First-class Astro orchestration (Static & SSR), WordPress toolkit with WP-CLI, Laravel application manager, Node.js/Next.js port pool, and Nginx vhost automation.
3. **Phase 1C — Operations & Advanced Security**: Restic-backed local & remote backups, automated security scanner & file integrity auditing, and system service supervisors.
4. **Phase 1D — Commercial & Multi-Tenancy**: Dedicated Customer Portal, hosting plan quotas, customer account provisioning, and resource throttling.

---

## 2. Granular Task Breakdown

### Phase 1A: Foundation & Core Infrastructure

| Step | Task Name | Description & Actions | Files to Create / Modify |
| :--- | :--- | :--- | :--- |
| **1A.1** | **SQLite Database Layer** | Implement embedded SQLite engine (`better-sqlite3` or `sqlite3`) in WAL mode at `/etc/webpanel/axon.db`. Add auto-migration runner. Migrate initial admin from `config.json`. | `server/lib/db.js`<br>`server/migrations/001_init.sql`<br>`server/lib/migrate.js` |
| **1A.2** | **Multi-Role RBAC Middleware** | Define the 6 user roles (`super_admin`, `server_admin`, `reseller`, `customer`, `developer`, `read_only`). Create permission check helpers and middleware. | `server/lib/rbac.js`<br>`server/middleware/auth.js`<br>`server/routes/auth.js` |
| **1A.3** | **Persistent Task Queue** | Build SQLite-backed queue for asynchronous server operations (installs, builds, cert issuance). Support job retries, log streaming, and progress tracking. | `server/lib/queue.js`<br>`server/lib/worker.js`<br>`server/routes/tasks.js` |
| **1A.4** | **API Versioning (`/api/v1`)** | Mount versioned API routes under `/api/v1/*` while retaining backwards-compatible aliases for `/api/*`. Standardize JSON envelope. | `server/index.js`<br>`server/routes/v1/*.js` |
| **1A.5** | **Design System & Theme Engine** | Configure exact Dark (`#080F19`) and Light (`#F7F9FC`) palettes in CSS variables / Tailwind tokens. Add top navigation theme switch with persistent user preference. | `web/src/index.css`<br>`web/src/components/ThemeToggle.tsx`<br>`web/src/components/Layout.tsx` |

---

### Phase 1B: Multi-Stack Hosting Engine

| Step | Task Name | Description & Actions | Files to Create / Modify |
| :--- | :--- | :--- | :--- |
| **1B.1** | **Astro & Modern Web Stack Engine** | Implement dual-mode deployment: **Static** (build to `dist/`, serve via Nginx directly) and **SSR** (Node adapter, systemd service, automated port assignment, reverse proxy). Pair with Headless CMS options. | `server/lib/stacks/astro.js`<br>`server/templates/astro.js`<br>`web/src/pages/AstroManager.tsx` |
| **1B.2** | **WordPress Toolkit** | Integrate WP-CLI for one-click installation, automated salt generation, updates, plugin/theme management, database repair, and security hardening (disable file editor, block XML-RPC). | `server/lib/stacks/wordpress.js`<br>`server/routes/wordpress.js`<br>`web/src/pages/WordPressToolkit.tsx` |
| **1B.3** | **Laravel Framework Engine** | Automate `composer install`, `.env` generation, `php artisan key:generate`, `storage:link`, directory permissions, and queue worker systemd unit generation. | `server/lib/stacks/laravel.js`<br>`server/routes/laravel.js`<br>`web/src/pages/LaravelManager.tsx` |
| **1B.4** | **Node.js & Next.js Lifecycle** | Automated port allocator (3000–3999 range), systemd user unit or PM2 daemon generation, custom build commands, environment variable injection, and zero-downtime reload. | `server/lib/stacks/nodejs.js`<br>`server/lib/ports.js`<br>`web/src/pages/NodeManager.tsx` |
| **1B.5** | **Website Detail Tabs** | Expand site detail view with dedicated tabs: Overview, Domains, Runtime, Git Repository, Deployments, Environment Variables, Build Settings, SSL, Nginx, Databases, Backups, Logs, Security. | `web/src/pages/SiteDetail.tsx`<br>`web/src/components/sites/*.tsx` |

---

### Phase 1C: Operations, Backups & Advanced Security

| Step | Task Name | Description & Actions | Files to Create / Modify |
| :--- | :--- | :--- | :--- |
| **1C.1** | **Restic Backup Integration** | Integrate Restic engine for snapshot-based, encrypted, deduplicated backups. Support local storage, SFTP targets, and S3-compatible remote storage (AWS, Cloudflare R2, MinIO). | `server/lib/restic.js`<br>`server/routes/backups.js`<br>`web/src/pages/Backups.tsx` |
| **1C.2** | **Security Scanner & Integrity Auditing** | Implement automated scanner: file integrity monitoring, world-writable file checks, rootkit detection hooks, exposed `.git`/`.env` scanners, and permission repair. | `server/lib/security/scanner.js`<br>`server/routes/security.js`<br>`web/src/pages/Security.tsx` |
| **1C.3** | **Service Health & Concurrency Throttling** | Add real-time memory and CPU thresholds to prevent OOM kills on 1 GB / 2 GB servers during simultaneous builds or package installations. | `server/lib/concurrency.js`<br>`server/lib/metrics.js` |

---

### Phase 1D: Commercial Multi-Tenancy & Customer Portal

| Step | Task Name | Description & Actions | Files to Create / Modify |
| :--- | :--- | :--- | :--- |
| **1D.1** | **Customer Portal Navigation & Views** | Build dedicated, simplified Customer Portal UI with scoped visibility: only owned websites, databases, files, SSL certificates, and usage statistics. | `web/src/components/CustomerLayout.tsx`<br>`web/src/pages/customer/*.tsx` |
| **1D.2** | **Hosting Plans & Resource Quotas** | Implement hosting plans with disk storage, database count, and website limits. Enforce quota checks in API routes prior to provisioning. | `server/routes/plans.js`<br>`server/lib/quotas.js`<br>`web/src/pages/HostingPlans.tsx` |
| **1D.3** | **Customer & User Management UI** | Interface for Super Admins and Resellers to invite, manage, suspend, or delete customer and developer accounts. | `server/routes/users.js`<br>`web/src/pages/Users.tsx` |

---

## 3. Risk Assessment & Mitigation Matrix

| Identified Risk | Severity | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **1 GB RAM Exhaustion During Builds** | High | Medium | Enforce single-concurrency build queue on systems with < 2 GB RAM. Verify swap availability (host currently has 5 GB swap). Utilize pre-swap validation before `npm build` or `composer install`. |
| **Nginx Reload Disruption** | High | Low | Never reload Nginx without prior `nginx -t` validation passing. In case of syntax error, revert immediately to previous backup config (`/etc/nginx/panel-backups/`). |
| **SQLite Concurrency Contention** | Medium | Low | Use SQLite in WAL mode with a 5000 ms busy timeout. Background workers use single-writer transactions for task state transitions. |
| **Customer Cross-Tenant Data Access** | Critical | Low | Enforce mandatory organization/tenant ID filtering in database queries and path validation (`assertSiteOwnership`). Deny root directory access to customer roles. |
| **Privilege Escalation via Scripts** | Critical | Low | Customer processes execute strictly under unprivileged user IDs (`www-data` or per-customer system users). Shell interpolation remains prohibited in `exec.js`. |

---

## 4. Rollback & Disaster Recovery Strategy

1. **Database Rollbacks**:
   - Automated timestamped backup of `/etc/webpanel/axon.db` before applying any schema migration: `/etc/webpanel/backups/axon.db.pre-migration-{timestamp}`.
   - Migration runner supports explicit `.down.sql` rollback scripts.
2. **Nginx Virtual Host Recovery**:
   - `writeSiteValidated` automatically creates an atomic backup in `/etc/nginx/panel-backups/{site}.{timestamp}.bak`.
   - If Nginx validation fails, the previous version is restored instantly before any reload is initiated.
3. **Application Stack Rollbacks**:
   - Website deployments maintain previous release symlinks (e.g., `/var/www/{domain}/releases/{timestamp}` with `/var/www/{domain}/current` symlink) for instantaneous one-click rollbacks.
4. **Service Health Monitoring**:
   - `webpanel.service` is configured with `Restart=always` and `RestartSec=5` in systemd. If an unhandled exception occurs, systemd automatically revives the process.

---

## 5. Dependency Graph & Sequencing

```
[Phase 0: Audit & Approval]
           |
           v
[1A.1 SQLite Database] ------> [1A.2 Multi-Role RBAC]
           |                            |
           v                            v
[1A.3 Persistent Task Queue]    [1A.4 Versioned API (/api/v1)]
           \                            /
            \                          /
             v                        v
          [1A.5 Design Tokens & Theme Engine]
                        |
                        v
         [Phase 1B: Multi-Stack Engine]
        /        |           |         \
       v         v           v          v
   [Astro]  [WordPress]  [Laravel]  [Node/Next]
       \         |           |          /
        +--------+-----+-----+---------+
                       |
                       v
         [Phase 1C: Operations & Security]
                       |
                       v
         [Phase 1D: Customer Portal & RBAC UI]
```
