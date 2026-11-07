# Axon Panel — Navigation & Permission Matrix

**Document Version:** 2.0.0  
**Status:** Access Control Specification  
**Date:** November 2026  
**Scope:** Multi-Role Access Control, Navigation Visibility, and Server Enforcement  

---

## 1. Role Hierarchy & Permission System

Axon Panel enforces a 6-tier Role-Based Access Control (RBAC) hierarchy defined in `server/lib/rbac.js`:

```
┌────────────────────────────────────────────────────────┐
│  super_admin   (Rank: 100) — Full System Access        │
├────────────────────────────────────────────────────────┤
│  server_admin  (Rank: 80)  — Infra & Server Ops        │
├────────────────────────────────────────────────────────┤
│  reseller      (Rank: 60)  — Customer & Site Reselling │
├────────────────────────────────────────────────────────┤
│  customer      (Rank: 40)  — Hosting Self-Service      │
├────────────────────────────────────────────────────────┤
│  developer     (Rank: 30)  — Code & Database Deploy    │
├────────────────────────────────────────────────────────┤
│  read_only     (Rank: 10)  — Monitoring Observer       │
└────────────────────────────────────────────────────────┘
```

### Granular Permission Identifiers
* `server:manage` — Control system daemons, Nginx global config, PHP packages, system updates.
* `server:view` — Inspect system resource telemetry, health metrics, and running processes.
* `terminal:access` — Spawn interactive root PTY terminal over WebSocket.
* `security:manage` — Configure UFW firewall, Fail2ban jails, SSH daemon hardening.
* `sites:manage` — Create, edit, enable/disable, and configure virtual hosts.
* `sites:deploy` — Trigger git pulls, run builds, restart application daemons.
* `databases:manage` — Create/drop databases, manage users/grants, execute queries, run backups.
* `files:root` — Unrestricted path-confined filesystem access across permitted server roots.
* `files:docroot` — Filesystem access strictly confined to the website's document root (`/var/www/site`).
* `users:manage` — Provision, edit, and suspend customer accounts.
* `plans:manage` — Create and adjust hosting quota packages.
* `audit:view` — Read the append-only system and security audit log.

---

## 2. Administrator & Customer Navigation Visibility Matrix

Legend:
* **FULL** = Visible in navigation, full create/read/update/delete access.
* **SCOPED** = Visible in navigation, strictly filtered to tenant's owned resources (`actor.orgId`).
* **READ** = Visible in navigation, read-only observation.
* **DENIED** = Hidden from navigation; route and API access strictly blocked (403 Forbidden).

| Functional Section | Navigation Item | Route Path | Super Admin | Server Admin | Reseller | Customer | Developer | Read-Only |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. OVERVIEW** | Dashboard | `/` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Notifications | `/notifications` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | System Health | `/system/health` | FULL | FULL | READ | DENIED | DENIED | READ |
| **2. WEBSITES** | All Websites | `/sites` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Domains & Subdomains | `/domains` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | One-Click Applications | `/apps` | FULL | FULL | SCOPED | SCOPED | DENIED | DENIED |
| | Astro & Headless CMS | `/astro` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Git & Deployments | `/deployments` | FULL | FULL | SCOPED | SCOPED | FULL | READ |
| | WordPress Toolkit | `/wordpress` | FULL | FULL | SCOPED | SCOPED | FULL | READ |
| **3. SERVER MANAGEMENT** | Server Overview | `/server` | FULL | FULL | READ | DENIED | DENIED | READ |
| | PHP Management | `/php` | FULL | FULL | DENIED | DENIED | DENIED | READ |
| | Node.js & PM2 | `/services/pm2` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Nginx Management | `/webserver` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | Databases | `/databases` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Redis Management | `/services/redis` | FULL | FULL | DENIED | DENIED | DENIED | READ |
| | Cron Jobs | `/cron` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Process Manager | `/services` | FULL | FULL | DENIED | DENIED | DENIED | READ |
| **4. SECURITY** | Security Overview | `/security` | FULL | FULL | READ | DENIED | DENIED | READ |
| | Firewall (UFW) | `/security/firewall` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | Fail2Ban | `/security/fail2ban` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | SSH & Access Keys | `/security/ssh` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | Security Scanner | `/security/scanner` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | File Integrity | `/security/integrity` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Audit Logs | `/security/audit` | FULL | FULL | SCOPED | DENIED | DENIED | READ |
| **5. SSL & DNS** | SSL Certificates | `/ssl` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | DNS Zone Manager | `/dns` | FULL | FULL | SCOPED | DENIED | DENIED | READ |
| **6. BACKUPS & STORAGE** | Backup Manager | `/backups` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Backup Schedules | `/backups/schedules` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | Remote Storage | `/backups/remote` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | File Manager | `/files` | FULL (Root) | FULL (Root) | SCOPED | SCOPED (Docroot) | SCOPED (Docroot) | DENIED |
| **7. MONITORING & LOGS** | Resource Monitoring | `/monitoring` | FULL | FULL | READ | DENIED | DENIED | READ |
| | Website Logs | `/logs/websites` | FULL | FULL | SCOPED | SCOPED | SCOPED | READ |
| | System Logs | `/logs` | FULL | FULL | DENIED | DENIED | DENIED | READ |
| | Service Status | `/monitoring/services` | FULL | FULL | READ | DENIED | DENIED | READ |
| **8. HOSTING ADMIN** | Customers | `/users/customers` | FULL | FULL | SCOPED | DENIED | DENIED | DENIED |
| | Resellers | `/users/resellers` | FULL | FULL | DENIED | DENIED | DENIED | DENIED |
| | Hosting Plans | `/plans` | FULL | FULL | READ | READ | DENIED | READ |
| | Users & Permissions | `/users` | FULL | FULL | SCOPED | DENIED | DENIED | DENIED |
| | Integrations & API | `/settings/integrations`| FULL | FULL | SCOPED | SCOPED | SCOPED | DENIED |
| | Panel Settings | `/settings` | FULL | FULL | SCOPED | SCOPED | SCOPED | DENIED |
| **9. ADMIN TOOLS** | Web Terminal | `/terminal` | FULL | DENIED | DENIED | DENIED | DENIED | DENIED |

---

## 3. Strict Customer Portal Boundary Rules

To guarantee enterprise multi-tenancy and zero privilege escalation:

1. **Terminal Gate:** The Web Terminal (`/terminal`) is hardcoded to require `super_admin` (`requireRole(ROLES.SUPER_ADMIN)`). Customers and developers attempting to establish a WebSocket connection to `/terminal/ws` receive HTTP 403 Forbidden and the connection is terminated immediately.
2. **Global Nginx Shield:** Direct Nginx configuration editing (`/webserver`) is completely hidden from customer navigation and blocked at the API level (`requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN)`).
3. **Firewall & Intrusion Shield:** UFW firewall and Fail2ban controls are restricted to server infrastructure administrators. Customers cannot view server firewall rules or modify IP ban lists.
4. **Filesystem Path Confinement:** Customers accessing the File Manager are confined strictly to their website's document root (`/var/www/{domain}`). `resolveSafePath` actively blocks customer traversal outside their assigned root.
5. **Database Prefix Isolation:** Databases created by customer accounts are enforced with organizational prefixes (`cust_{orgId}_*`), preventing database namespace collision or unauthorized tampering.

---

## 4. Frontend & Backend Guard Implementation

### 4.1 Client-Side Navigation Filtering
In `web/src/components/Layout.tsx`, `getNavSections(user.role)` dynamically filters navigation items:
```tsx
// Example layout filter
if (role === "customer") {
  return [
    { header: "My Hosting", items: customerHostingItems },
    { header: "Website Services", items: customerServiceItems },
    { header: "Account", items: customerAccountItems }
  ];
}
```

### 4.2 Client-Side Route Protection (`ProtectedRoute.tsx`)
Any route accessed directly via browser URL bar that requires higher permissions evaluates `hasPermission(user.role, requiredPermission)`:
* If authorized: Renders view.
* If unauthorized: Displays standard Access Denied card or redirects safely to `/` with an informative toast message.

### 4.3 Server-Side Middleware Enforcement
Every API route validates the authenticated JWT session before execution:
```javascript
// Example server route security
router.get("/security/firewall", requireRole(ROLES.SUPER_ADMIN, ROLES.SERVER_ADMIN), ...);
router.post("/terminal/ws", requireRole(ROLES.SUPER_ADMIN), ...);
router.get("/sites/:name", (req, res, next) => {
  assertSiteOwnership(req, req.params.name);
  ...
});
```
