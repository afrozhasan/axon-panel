# Axon Panel — Comprehensive Test & Verification Plan

**Document Version:** 1.0.0  
**Status:** Verification Baseline  
**File Location:** `/root/webpanel/docs/TEST_PLAN.md`  

---

## 1. Overview & Quality Assurance Objectives

To ensure Axon Panel is a resilient, enterprise-grade Linux hosting control panel, every subsystem must pass automated verification suites and rigorous real-world scenario tests.

The testing strategy spans four layers:
1. **Unit & Validation Tests**: Path traversal checks, regex validators, execution allowlists, TOTP compliance (`scripts/security-check.js`).
2. **API Contract Verification**: Full correspondence between frontend API queries and Express server route declarations (`scripts/api-contract-check.js`).
3. **Application Stack Lifecycle Tests**: Real provisioning, runtime startup, reverse proxy configuration, and teardown for each supported web technology.
4. **Security, Concurrency & Resource Constraints**: RBAC bypass attempts, directory traversal probing, and 1 GB RAM memory stress limits.

---

## 2. Application Stack Test Matrix

Every application stack supported by Axon Panel must undergo automated lifecycle testing:

### 2.1 Astro Applications (Static & SSR Modes)

| Test ID | Test Scenario | Verification Criteria | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **AST-01** | Static Astro Provisioning | Create site with `app_type: "astro"`, `mode: "static"`. Trigger build `npm run build`. | Static files created in `/var/www/{domain}/dist/`. Nginx vhost serves index.html directly. Zero Node background daemons. |
| **AST-02** | SSR Astro Provisioning (Node Adapter) | Create site with `app_type: "astro"`, `mode: "ssr"`. Allocate port, launch standalone node server via systemd unit `axon-site-{name}.service`. | Standalone server runs on `127.0.0.1:{port}`. Nginx proxies requests with WebSocket headers. `curl -I https://{domain}` returns 200 OK. |
| **AST-03** | Astro Build Error Handling | Inject syntax error into `src/pages/index.astro`. Trigger build. | Build fails gracefully with captured error output in task logs. Previous working deployment remains untouched. |
| **AST-04** | Headless CMS Pairing | Connect Astro frontend to local Strapi / Ghost / WordPress endpoint via environment variables (`ASTRO_KEY`, `API_URL`). | Build injects variables successfully and statically renders fetched CMS content. |

---

### 2.2 WordPress Toolkit

| Test ID | Test Scenario | Verification Criteria | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **WP-01** | One-Click WordPress Deployment | Download official core archive, create MariaDB database and user, generate unique salts, populate `wp-config.php`, configure Nginx PHP-FPM block. | Site loads installation wizard / initial front page with valid DB connection and active PHP-FPM socket. |
| **WP-02** | WP-CLI Core Operations | Run `wp core check-update`, `wp plugin list`, `wp theme list` via allowlisted `run()` wrapper. | Command executes without shell interpolation, returning structured JSON/table output to frontend. |
| **WP-03** | Security Hardening Verification | Apply WordPress security preset (disable file editor, block XML-RPC, protect wp-config). | `DISALLOW_FILE_EDIT` is `true`. POST to `/xmlrpc.php` returns 403 Forbidden. Direct browser access to `wp-config.php` blocked. |
| **WP-04** | Automated Database Backup | Trigger database backup for WordPress instance. | Clean `.sql.gz` dump created in backup directory. Table structure and data verified with `zcat`. |

---

### 2.3 Laravel Framework

| Test ID | Test Scenario | Verification Criteria | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **LAR-01** | Laravel Clean Install | Provision Laravel site. Generate `.env` from template, create MariaDB database, run `composer install --no-dev`, run `php artisan key:generate`. | `.env` has valid `APP_KEY`. Public directory `/var/www/{domain}/public` serves Laravel welcome screen. |
| **LAR-02** | Storage Symlink Creation | Run `php artisan storage:link`. | Symbolic link from `public/storage` to `storage/app/public` is created and correctly owned by `www-data`. |
| **LAR-03** | Queue Worker Supervisor | Enable background queue worker for Laravel site. | Systemd unit `axon-worker-{site}.service` generated and started running `artisan queue:work --sleep=3 --tries=3`. |
| **LAR-04** | Database Migration Runner | Execute `php artisan migrate` via panel UI. | Migrations execute cleanly; output is streamed to panel task log. |

---

### 2.4 Node.js & Next.js Applications

| Test ID | Test Scenario | Verification Criteria | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **NOD-01** | Node.js Standalone Provisioning | Assign port from pool (e.g., 3010). Generate systemd unit or PM2 config. Set environment `PORT=3010`. | Node process starts, listens on `127.0.0.1:3010`. Nginx vhost forwards HTTP/WebSocket traffic cleanly. |
| **NOD-02** | Next.js Production Build | Run `next build` inside application directory. | `.next/standalone` created. Process manager launches server. App responds with server-side rendered HTML. |
| **NOD-03** | Zero-Downtime Reload | Issue application reload via panel. | Worker reloads using PM2 cluster reload or systemd graceful SIGHUP. Zero dropped requests during reload. |
| **NOD-04** | Port Collision Prevention | Attempt to assign a port currently in use by another app or system service. | Port allocator detects conflict via socket test and selects next available port in pool. |

---

### 2.5 Generic PHP & Static Sites

| Test ID | Test Scenario | Verification Criteria | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **GEN-01** | Static HTML Site | Provision static site with custom HTML/CSS assets. | Nginx serves assets with proper MIME types, Gzip/Brotli compression, and cache headers. |
| **GEN-02** | PHP-FPM Version Switch | Switch site PHP version from PHP 8.3 to PHP 8.4. | Nginx fastcgi_pass socket updated. Nginx reloads after syntax test. `phpinfo()` reflects PHP 8.4. |

---

## 3. Security Test Suite (Automated & Manual)

The security suite ensures that multi-tenant isolation and privilege boundaries cannot be breached:

```bash
# Automated security verification command
npm run check
```

### 3.1 Security Test Cases

| Test Case | Attack Vector / Probe | Expected Security Response |
| :--- | :--- | :--- |
| **SEC-01: Command Injection** | Pass `site.com; rm -rf /` or `$(id)` as domain name. | Input rejected with HTTP 400 (`assertDomain` failure). Command is never dispatched. |
| **SEC-02: Path Traversal Outside Root** | Pass `../../../../etc/passwd` to File Manager read API. | `resolveSafePath` throws `ValidationError: Path escapes permitted roots`. HTTP 403 returned. |
| **SEC-03: Symlink Escape Attack** | Create symlink inside `/var/www/site/link -> /etc/shadow`. Attempt download. | Symlink resolution detects target outside allowed roots; operation blocked. |
| **SEC-04: Sensitive File Exposure** | Attempt to view `/etc/letsencrypt/live/domain/privkey.pem` or `/root/.ssh/id_rsa`. | `assertNotSensitive` triggers block. HTTP 403 returned. |
| **SEC-05: RBAC Role Escalation** | Customer session issues `POST /api/v1/system/restart` or `POST /api/v1/firewall/rules`. | Middleware evaluates role permissions; returns HTTP 403 Forbidden. |
| **SEC-06: Cross-Tenant Site Deletion** | Customer A attempts `DELETE /api/v1/sites/site_b` owned by Customer B. | Organization ownership validation fails; returns HTTP 404/403. |
| **SEC-07: Unauthenticated API Access** | Issue requests without valid `webpanel_token` JWT cookie. | Middleware intercepts request; returns HTTP 401 Unauthorized. |
| **SEC-08: CSRF Attack** | Send `POST /api/v1/sites` without `x-requested-with: webpanel` header. | CSRF middleware drops request with HTTP 403 Forbidden. |
| **SEC-09: Brute-Force Rate Limiting** | Submit 6 consecutive invalid passwords within 1 minute. | IP is locked out for 15 minutes; subsequent attempts receive HTTP 429. |
| **SEC-10: TOTP Replay Attack** | Re-submit previously consumed TOTP token within same 30-second window. | Authenticator rejects duplicate window token. |

---

## 4. Resource Constraint & 1 GB RAM Stress Testing

Axon Panel is engineered to operate on resource-constrained servers:

1. **Baseline Memory Measurement**:
   - The panel background daemon must consume <= 60 MB RSS under idle conditions.
   - Verified via `ps -o rss,vsz,cmd -p $(pgrep -f "server/index.js")`.
2. **Concurrent Build Throttling**:
   - On hosts with <= 2 GB RAM, the task queue limits concurrent builds (`npm build`, `composer install`) to **1 active worker**.
   - Additional build requests are queued as `pending` to prevent Linux kernel Out-Of-Memory (OOM) killer invocations.
3. **Swap Verification**:
   - Installer and build runners check `MemAvailable + SwapFree >= 500 MB` before launching memory-intensive tasks.
   - If insufficient resources exist, a warning is returned to the user with a recommendation to enable swap.

---

## 5. Rollback & Disaster Recovery Procedures

1. **Corrupted Nginx Configuration**:
   - Automated test: Write broken config `server { invalid_syntax; }`.
   - Expected behavior: `nginx -t` fails. `writeSiteValidated` rolls back to `.bak` file instantly. Nginx service remains 100% online without interruption.
2. **Database Migration Failure**:
   - Automated test: Inject invalid SQL statement into migration script.
   - Expected behavior: Migration transaction rolls back. Database restored to pre-migration backup snapshot. Panel logs diagnostic error.
3. **Task Worker Crash**:
   - Automated test: Kill worker child process with `kill -9`.
   - Expected behavior: Task supervisor detects worker exit, marks task as `interrupted` or re-queues, and restarts worker without affecting the main control plane.
