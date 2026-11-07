# Axon Panel

### Axon Panel by [AxonWP](https://axonwp.com) • Developed by [Afroz Hasan](https://afroz.me)

[![CI](https://github.com/afrozhasan/axon-panel/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/afrozhasan/axon-panel/actions/workflows/ci.yml)
[![Security Audit](https://github.com/afrozhasan/axon-panel/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/afrozhasan/axon-panel/actions/workflows/security.yml)
[![Release Engineering & Distribution](https://github.com/afrozhasan/axon-panel/actions/workflows/release.yml/badge.svg)](https://github.com/afrozhasan/axon-panel/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/afrozhasan/axon-panel)](https://github.com/afrozhasan/axon-panel/releases)

**Axon Panel** is a lightweight, Linux-native hosting control panel engineered by **[AxonWP](https://axonwp.com)** and developed by **[Afroz Hasan](https://afroz.me)** for virtual private servers (VPS), multi-stack websites, databases, reverse proxies, automated TLS, and proactive server telemetry. Operating directly on the host with an ultra-lean runtime footprint (~42 MB RAM baseline), it performs reliably even on resource-constrained 1 GB to 2 GB instances without requiring Docker or Kubernetes.

---

## ⚡ Highlights & Architecture

* **Minimal Memory Baseline (~42 MB):** Pure Node.js 22 LTS runtime backed by an embedded SQLite WAL database.
* **Zero Shell Interpolation:** All system commands execute via `child_process.execFile` with explicit argument arrays and a strict 56-binary allowlist, neutralizing shell injection vectors.
* **Path Confinement:** Directory traversal protection resolves canonical symlinks against explicit filesystem roots.
* **Multi-Stack Virtual Hosts:** Automates Nginx configurations for PHP-FPM (8.1, 8.2, 8.3, 8.4), Node.js reverse proxies, Astro SSR/Static, and static sites.
* **WordPress Toolkit Pro:** Security hardening profiles, malware scanning, database hygiene, media optimization (WebP/compression), and a unified 6-layer cache manager (FastCGI cache, Redis, OPcache, browser cache, CDN).
* **Modern Frontend Engine (Astro):** Dual-mode deployments (Static HTML or SSR supervised by systemd units) with dynamic internal port allocation (3000–3999).
* **Database Management:** Direct provisioning and lifecycle control over MariaDB, PostgreSQL clusters, and Redis instances.
* **Multi-Channel Alerting & Daily Reports:** Proactive threshold monitoring (CPU, RAM, Disk, SSL expiry) with instant Telegram and Slack notifications, plus automated daily executive health digests.
* **Enterprise Security:** JWT sessions in httpOnly SameSite=Strict cookies, CSRF protection, in-memory rate limiting, IP allowlisting, and RFC 6238 TOTP two-factor authentication.

---

## 🚀 Quick Start (Automated Installation)

Axon Panel provides an automated, idempotent installation system supporting **Ubuntu 22.04 LTS**, **Ubuntu 24.04 LTS**, and **Debian 11 / 12**.

### Recommended One-Line Installer

Run the following command on a fresh Ubuntu or Debian server:

```bash
curl -fsSL https://github.com/afrozhasan/axon-panel/releases/latest/download/install.sh -o install.sh && sudo bash install.sh
```

### Advanced Installation Options

```bash
# Install with a custom domain and Let's Encrypt TLS certificate
sudo bash install.sh --domain panel.example.com --email admin@example.com

# Non-interactive / unattended automated installation
sudo bash install.sh --domain panel.example.com --email admin@example.com -y

# Specify a custom installation directory or internal port
sudo bash install.sh --dir /opt/axon-panel --port 9090

# Install an explicit release version
sudo bash install.sh --version v1.0.0
```

### Installation CLI Reference

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--domain <name>` | Public domain or subdomain for the control panel | `localhost` |
| `--email <address>` | Contact address for Let's Encrypt TLS renewal notices | `admin@localhost` |
| `--port <number>` | Internal HTTP listener port for the Node.js daemon | `9090` |
| `--dir <path>` | Target installation directory on host | `/opt/axon-panel` |
| `--version <tag>` | Explicit release version to download and install | `latest` |
| `--no-ssl` | Serve the panel over HTTP (skip Certbot TLS) | Off |
| `--reset-password` | Generate a new admin password even if an existing installation exists | Off |
| `-y, --yes` | Run non-interactively with automated defaults | Off |

---

## 🔄 Updates & Lifecycle Management

Axon Panel includes a modular management suite located in `/opt/axon-panel/installer/`.

### Checking for Updates

```bash
sudo /opt/axon-panel/installer/update.sh --check
```

### Applying Upgrades

The update engine performs an automated pre-upgrade backup of your configuration and database before updating. If the post-update health check fails, it automatically rolls back:

```bash
# Update to latest stable release
sudo /opt/axon-panel/installer/update.sh

# Upgrade to an explicit target version
sudo /opt/axon-panel/installer/update.sh --version v1.1.0
```

### System Health Inspection

Run deep validation across the systemd service, HTTP port, SQLite WAL integrity, and Nginx syntax:

```bash
sudo /opt/axon-panel/installer/health-check.sh
```

### Backups & Disaster Recovery

```bash
# Create an atomic, timestamped backup
sudo /opt/axon-panel/installer/backup.sh --backup

# List existing backups
sudo /opt/axon-panel/installer/backup.sh --list

# Restore from a backup archive
sudo /opt/axon-panel/installer/backup.sh --restore /var/backups/axon-panel/axon-backup-20261107_120000.tar.gz
```

### Uninstallation

```bash
# Standard uninstall (removes service and Nginx vhost; preserves database and backups)
sudo /opt/axon-panel/installer/uninstall.sh

# Complete purge (removes all application files, database, and configurations)
sudo /opt/axon-panel/installer/uninstall.sh --purge
```

---

## 📂 System File Hierarchy

```
/opt/axon-panel/
├── install.sh                  # Root standalone system installer
├── update.sh                   # Root updater utility
├── package.json                # Project dependencies & npm scripts
├── installer/                  # System automation suite
│   ├── install.sh              # Standalone release installer
│   ├── update.sh               # Safe version updater with rollback
│   ├── uninstall.sh            # Safe service uninstaller
│   ├── backup.sh               # Atomic backup & restore utility
│   └── health-check.sh         # System diagnostic & verification script
├── server/                     # Express & Node.js backend
│   ├── index.js                # Core daemon entry point
│   ├── config.js               # Runtime configuration loader
│   ├── lib/                    # Nginx, database, metrics, notifications, and stacks
│   ├── routes/                 # REST API controllers
│   ├── scripts/                # CLI alert monitor & background workers
│   └── templates/              # Virtual host Nginx templates
├── web/                        # React + Vite + Tailwind CSS + TypeScript frontend
├── scripts/                    # Security & unit testing suites
└── systemd/                    # Systemd service unit definitions

/etc/axon-panel/
├── config.json                 # Panel runtime configuration (0600)
├── notifications.json          # Telegram, Slack, & threshold settings (0600)
├── alert-state.json            # Active alert deduplication state
└── axon.db                     # Embedded SQLite database (WAL mode, 0600)

/var/log/axon-panel/            # Application and alert monitoring logs
/var/backups/axon-panel/        # Timestamped snapshot archives
```

---

## 🔒 Security Architecture

* **Zero Shell Interpolation:** Command execution is strictly routed through `child_process.execFile` with explicit argument arrays. Shell metacharacters (`|`, `;`, `&`, `$`, `` ` ``) are treated as inert strings.
* **Binary Allowlist:** Commands are restricted to a verified allowlist of 56 system binaries.
* **Role-Based Access Control (RBAC):** Hierarchical permissions across Super Admin, Server Admin, Reseller, Customer, Developer, and Read-Only roles.
* **Brute-Force Lockout:** In-memory rate limiting with 15-minute lockouts after 5 consecutive failed attempts.
* **Audit Logging:** Every administrative action is recorded in the SQLite audit log with actor username, timestamp, and client IP.

---

## 👤 Authors & Credits

* **Organization & Brand:** [AxonWP](https://axonwp.com)
* **Lead Developer:** [Afroz Hasan](https://afroz.me)
* **Official Repository:** [https://github.com/afrozhasan/axon-panel](https://github.com/afrozhasan/axon-panel)
* **Website:** [https://axonwp.com](https://axonwp.com)

---

## 📜 License

Axon Panel is open-source software licensed under the **[MIT License](LICENSE)**.
