# Axon Panel — Security Architecture & Hardening Plan

**Document Version:** 1.0.0  
**Security Classification:** Critical Engineering Standard  
**File Location:** `/root/webpanel/docs/SECURITY_PLAN.md`  

---

## 1. Threat Model for Multi-Tenant Linux Hosting

Operating a web-accessible hosting control panel that manages multi-tenant websites, system services, and database credentials presents severe threat vectors. Axon Panel implements defense-in-depth across the network, application, process, and filesystem tiers.

### 1.1 Primary Threat Vectors & Countermeasures
1. **Remote Code Execution (RCE) via Web Inputs**:
   - *Threat*: Attackers inject shell metacharacters (`rm -rf /`, `curl | bash`) into domain names, database names, or configuration inputs.
   - *Defense*: **Zero shell interpolation**. All commands execute via `execFile`/`spawn` with explicit argument arrays. Strict regex whitelisting on domains (`assertDomain`), site names, and database identifiers (`assertDatabaseName`).
2. **Directory & Path Traversal**:
   - *Threat*: Malicious users provide paths like `../../etc/shadow` or create symlinks to read sensitive server credentials.
   - *Defense*: `resolveSafePath` resolves symlinks via `realpath` and verifies that the canonical path resides strictly inside `allowedRoots`. `assertNotSensitive` explicitly blocks private keys and system credential files.
3. **Cross-Tenant Data Exposure**:
   - *Threat*: Customer A accesses Customer B's databases, files, or Nginx configurations.
   - *Defense*: Strict server-side RBAC scoping (`organization_id` matching on every database query), Linux filesystem user segregation, and path confinement.
4. **Credential Compromise & Session Hijacking**:
   - *Threat*: Interception of session cookies or brute-force cracking of administrator credentials.
   - *Defense*: `httpOnly`, `secure`, `sameSite: strict` JWT cookies, rate limiting with automated lockout (5 failed attempts = 15-minute lockout), mandatory RFC 6238 TOTP two-factor authentication, and Argon2/bcrypt password hashing.
5. **Privilege Escalation**:
   - *Threat*: A compromised customer web application escalates to root.
   - *Defense*: Web workloads and builds run under unprivileged user contexts (`www-data` or isolated customer UIDs). Protected systemd units (`ssh.service`, `webpanel.service`, etc.) cannot be modified or stopped by non-superadmins.

---

## 2. Role-Based Access Control (RBAC) Matrix

Axon Panel enforces 6 distinct user roles across all system resources:

| Role | Target Persona | Scope & Permissions |
| :--- | :--- | :--- |
| **Super Admin** | Server Owner / Lead Infrastructure Engineer | Full, unrestricted authority over the VPS, all organizations, system services, terminal, security, and global configuration. |
| **Server Admin** | Secondary System Administrator | Manages server resources, services, and websites. Cannot alter Super Admin credentials or disable security auditing. |
| **Reseller** | Hosting Reseller | Manages their own sub-customers, hosting plans, and provisioned websites within designated global quotas. |
| **Customer** | End-user Website Owner | Accesses exclusively their assigned websites, domains, databases, file manager, SSL certificates, and crons. Cannot see other tenants or system services. |
| **Developer** | Technical Contractor / App Maintainer | Accesses assigned websites, git deployment hooks, environment variables, application logs, and database consoles. Cannot delete sites or alter billing/plans. |
| **Read-Only** | Auditor / Stakeholder | View-only access to metrics, logs, and website statuses. Mutating actions are strictly denied. |

### 2.1 Resource Permission Matrix

| Resource / Action | Super Admin | Server Admin | Reseller | Customer | Developer | Read-Only |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Server Health & Metrics** | Full | Full | Scoped | Quota Only | Scoped | View |
| **Nginx Global Config** | Full | Full | Denied | Denied | Denied | View |
| **Websites (Create / Delete)**| Full | Full | Sub-Tenants | Owned Only | Denied | View |
| **Website VHost Editing** | Full | Full | Owned | Denied | Denied | View |
| **Deployments & Git Hooks**| Full | Full | Owned | Owned | Assigned | View |
| **File Manager** | Full Roots | Full Roots | Tenant Home | Site Docroot | Site Docroot | View |
| **Databases (Create / Query)**| Full | Full | Tenant DBs | Owned DBs | Assigned DBs | View |
| **SSL Issuance (Certbot)** | Full | Full | Owned | Owned | Denied | View |
| **Firewall & Fail2ban** | Full | Full | Denied | Denied | Denied | Denied |
| **Web Terminal (PTY Shell)** | Full | Full | Denied | Denied | Denied | Denied |
| **Hosting Plans & Quotas** | Full | Full | Scoped | Denied | Denied | Denied |
| **User & Tenant Management** | Full | Sub-Users | Sub-Users | Denied | Denied | Denied |

---

## 3. Customer Isolation & Filesystem Security

To maintain multi-tenant hygiene:
1. **Isolated Document Roots**:
   - Path convention: `/var/www/{site_name}/` or `/var/www/customers/{org_id}/{site_name}/`.
   - File permissions: Directory ownership `www-data:www-data` (mode `0755` or `0750`).
2. **PHP-FPM Pool Isolation**:
   - Each customer or critical site can be assigned a dedicated PHP-FPM pool socket (`/var/run/php/php8.3-{site_name}.sock`).
   - Pool directives:
     ```ini
     [site_user]
     user = www-data
     group = www-data
     listen = /var/run/php/php8.3-site.sock
     listen.owner = www-data
     listen.group = www-data
     listen.mode = 0660
     php_admin_value[open_basedir] = /var/www/site_name/:/tmp/
     php_admin_value[upload_tmp_dir] = /var/www/site_name/tmp/
     php_admin_value[session.save_path] = /var/www/site_name/tmp/
     ```
3. **Database User Scoping**:
   - In MariaDB/PostgreSQL, database users are created with rights strictly bound to the customer's database name prefix:
     `GRANT ALL PRIVILEGES ON \`cust_%`.* TO 'cust_user'@'localhost';`

---

## 4. Privileged Operation Allowlist & Validation

Command execution is governed by `server/lib/exec.js` and `server/lib/validate.js`.

### 4.1 Permitted Binaries
```javascript
export const ALLOWED_BINARIES = new Set([
  // Web Server & TLS
  "nginx", "certbot", "openssl",
  // Systemd & Process
  "systemctl", "journalctl", "pm2", "pgrep",
  // Databases & Cache
  "mysql", "mysqladmin", "mariadb", "mysqldump", "mysqlimport",
  "psql", "pg_dump", "pg_dumpall", "pg_restore", "pg_ctlcluster", "pg_lsclusters",
  "createdb", "dropdb", "redis-cli",
  // Storage & Backups
  "df", "du", "lsblk", "tar", "gzip", "gunzip", "unzip", "restic",
  // Runtimes & Package Managers
  "php", "php8.1", "php8.2", "php8.3", "php8.4", "phpenmod", "phpdismod",
  "composer", "node", "npm", "pnpm", "yarn",
  // Security & Hardening
  "ufw", "fail2ban-client", "ss", "sshd", "chown", "crontab",
  // System Info & Utilities
  "curl", "hostname", "uptime", "script", "bash", "sh", "su", "runuser", "tail",
  "dpkg", "apt-get", "apt-cache"
]);
```

### 4.2 Protected Units & Blacklisted Targets
System-critical units cannot be stopped or manipulated via the panel API:
- `ssh.service`, `sshd.service`
- `webpanel.service`
- `systemd-*`, `init.scope`
- `dbus.service`

Sensitive paths that cannot be read, downloaded, or written via the File Manager:
- `/root/.ssh/*`, `/etc/ssh/*`
- `*.pem`, `*.key` (SSL/TLS private keys)
- `/etc/shadow`, `/etc/gshadow`, `/etc/sudoers`
- `/etc/webpanel/config.json` (except via Settings controller)
- `/etc/webpanel/axon.db` (internal SQLite database)

---

## 5. Credential Storage & Encryption Architecture

1. **Passwords**:
   - Stored as salted bcrypt hashes (`cost = 12`) or Argon2id hashes.
   - Plaintext passwords are never logged, echoed, or preserved in memory.
2. **TOTP Two-Factor Authentication**:
   - RFC 6238 compliant base32-encoded secrets.
   - Visual provisioning via in-memory QR code data URI.
3. **Database & API Secret Encryption at Rest**:
   - Stored credentials (e.g. remote S3 backup access keys, customer database passwords) are encrypted using AES-256-GCM.
   - Master encryption key derived from a machine-specific secret stored in `/etc/webpanel/master.key` (mode `0400 root:root`).
4. **CSRF Protection**:
   - All state-altering requests (`POST`, `PUT`, `DELETE`) require the custom header `x-requested-with: webpanel`.
   - Browser cross-origin requests cannot attach custom headers without prior CORS preflight approval.

---

## 6. Audit Logging & Compliance Specification

All security-relevant actions are persistently logged:
- **Storage Target**: Append-only log file `/var/log/webpanel/audit.log` (mode `0600`) and the SQLite `audit_logs` table.
- **Log Schema**:
  ```json
  {
    "timestamp": "2026-11-06T16:20:00.000Z",
    "user_id": "usr_981a2b",
    "username": "admin",
    "role": "super_admin",
    "ip_address": "203.0.113.195",
    "action": "site.create",
    "resource_type": "website",
    "resource_id": "example.com",
    "status": "success",
    "details": {
      "app_type": "astro",
      "runtime_mode": "ssr",
      "assigned_port": 3005
    }
  }
  ```
- Super Admins can search and stream audit logs directly from the panel dashboard. Log files are automatically rotated by `logrotate`.
