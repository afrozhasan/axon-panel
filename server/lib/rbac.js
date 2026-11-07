import { getDb } from "./db.js";

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  SERVER_ADMIN: "server_admin",
  RESELLER: "reseller",
  CUSTOMER: "customer",
  DEVELOPER: "developer",
  READ_ONLY: "read_only",
};

export const ROLE_HIERARCHY = {
  [ROLES.SUPER_ADMIN]: 100,
  [ROLES.SERVER_ADMIN]: 80,
  [ROLES.RESELLER]: 60,
  [ROLES.CUSTOMER]: 40,
  [ROLES.DEVELOPER]: 30,
  [ROLES.READ_ONLY]: 10,
};

export const ROLE_DEFINITIONS = [
  {
    id: ROLES.SUPER_ADMIN,
    name: "Super Admin",
    isConfigurable: false,
    badge: "Full Root Authority",
    description: "Unrestricted access to all server hardware telemetry, terminal, system daemons, multi-tenancy, and security settings.",
  },
  {
    id: ROLES.SERVER_ADMIN,
    name: "Server Admin",
    isConfigurable: true,
    badge: "Infrastructure",
    description: "Server administration, system services, security modules, databases, websites, and hosting operations.",
  },
  {
    id: ROLES.RESELLER,
    name: "Reseller",
    isConfigurable: true,
    badge: "Multi-Tenant",
    description: "Manage client customer accounts, hosting plans, websites, domains, and allocated tenant resources.",
  },
  {
    id: ROLES.CUSTOMER,
    name: "Customer",
    isConfigurable: true,
    badge: "Self-Service",
    description: "Self-service web hosting client managing their own websites, databases, files, SSL, and apps.",
  },
  {
    id: ROLES.DEVELOPER,
    name: "Developer",
    isConfigurable: true,
    badge: "Deployments",
    description: "Focused on git deployments, headless CMS / Astro engines, databases, and website source files.",
  },
  {
    id: ROLES.READ_ONLY,
    name: "Read Only",
    isConfigurable: true,
    badge: "Auditor",
    description: "Inspect server telemetry and audit logs without modification or destructive capabilities.",
  },
];

export const PERMISSION_CATALOG = [
  {
    category: "Server Details & Telemetry",
    icon: "server",
    description: "Configure what hardware metrics, health telemetry, and system details this role can view.",
    permissions: [
      {
        id: "server:metrics_view",
        label: "Hardware Metrics (CPU, RAM, Disk)",
        description: "View real-time CPU %, RAM usage, and Disk space gauges in sidebar and dashboard.",
        isServerDetail: true,
      },
      {
        id: "server:health_view",
        label: "Server Health & Specs",
        description: "View hostname, OS kernel, uptime, load averages, and system health status.",
        isServerDetail: true,
      },
      {
        id: "server:services_view",
        label: "System Services Status",
        description: "View active/running states of core services (Nginx, MariaDB, Redis, PM2, PHP).",
        isServerDetail: true,
      },
      {
        id: "server:resources_view",
        label: "Storage Mounts & Partitions",
        description: "View server partition mount points, swap memory, and disk filesystem details.",
        isServerDetail: true,
      },
    ],
  },
  {
    category: "Server Management & Daemons",
    icon: "cpu",
    description: "Host-level daemons, web servers, PHP configuration, and shell access.",
    permissions: [
      {
        id: "server:services_manage",
        label: "Manage System Services",
        description: "Start, stop, and restart background daemons (systemctl and PM2 processes).",
      },
      {
        id: "server:php_manage",
        label: "PHP Runtime Configuration",
        description: "Switch PHP versions, modify php.ini directives, and tune execution parameters.",
      },
      {
        id: "server:webserver_manage",
        label: "Nginx Webserver Management",
        description: "Edit global nginx configuration, test syntax, and reload webserver safely.",
      },
      {
        id: "server:cron_manage",
        label: "Scheduled Cron Jobs",
        description: "Create, edit, pause, and run automated cron jobs.",
      },
      {
        id: "server:terminal_access",
        label: "Interactive Web Terminal",
        description: "Open in-browser SSH shell / terminal session with server command prompt.",
      },
    ],
  },
  {
    category: "Websites & Applications",
    icon: "globe",
    description: "Website hosting, domain routing, one-click apps, and Git deployments.",
    permissions: [
      {
        id: "sites:manage",
        label: "Websites Management",
        description: "Create, configure, suspend, and delete website virtual hosts.",
      },
      {
        id: "sites:deploy",
        label: "Git Deployments & CI/CD",
        description: "Connect GitHub/GitLab repositories, pull updates, and manage automated webhook deploys.",
      },
      {
        id: "domains:manage",
        label: "Domains & Subdomains",
        description: "Attach custom domains, create subdomains, and configure URL forwarding.",
      },
      {
        id: "dns:manage",
        label: "DNS Zone Management",
        description: "Manage DNS zones, A/CNAME/MX/TXT records, and nameserver configurations.",
      },
      {
        id: "apps:manage",
        label: "One-Click Apps Installer",
        description: "Install and manage web apps (WordPress, Ghost, Laravel, Node.js).",
      },
      {
        id: "astro:manage",
        label: "Astro & Headless CMS",
        description: "Build, configure, and deploy Astro static and SSR headless projects.",
      },
      {
        id: "wp:manage",
        label: "WordPress Toolkit Pro",
        description: "WordPress security hardening, database prefix, caching, salts, and maintenance.",
      },
    ],
  },
  {
    category: "Databases & Storage",
    icon: "database",
    description: "Database engines, file management, SSL certificates, and backup snapshots.",
    permissions: [
      {
        id: "databases:manage",
        label: "Databases (MariaDB & Postgres)",
        description: "Create and manage databases, database users, passwords, and phpMyAdmin access.",
      },
      {
        id: "files:docroot",
        label: "File Manager (Site Docroot)",
        description: "Browse, edit, upload, compress, and extract files within assigned site document roots.",
      },
      {
        id: "files:root",
        label: "File Manager (Server Root /)",
        description: "Browse and modify server root filesystem outside user docroots.",
      },
      {
        id: "ssl:manage",
        label: "SSL / TLS Certificates",
        description: "Issue and auto-renew Let's Encrypt certificates, configure HTTPS enforcement.",
      },
      {
        id: "backups:manage",
        label: "Backups & Disaster Recovery",
        description: "Create manual snapshots, configure automated schedules, and connect remote S3 storage.",
      },
    ],
  },
  {
    category: "Security & Auditing",
    icon: "shield",
    description: "Network protection, intrusion defense, SSH access, and system logs.",
    permissions: [
      {
        id: "security:firewall",
        label: "UFW Firewall Protection",
        description: "Configure inbound/outbound firewall rules, open or block network ports.",
      },
      {
        id: "security:fail2ban",
        label: "Fail2Ban Intrusion Defense",
        description: "Monitor attack jails, view banned IP addresses, and manually unban IPs.",
      },
      {
        id: "security:ssh",
        label: "SSH & Key Management",
        description: "Manage authorized SSH public keys, change SSH ports, toggle password auth.",
      },
      {
        id: "security:scanner",
        label: "Security Audit & Scanner",
        description: "Run automated security vulnerability scans and file integrity checks.",
      },
      {
        id: "logs:view",
        label: "System & Access Logs",
        description: "Inspect live Nginx access/error logs, PHP logs, and administrative audit trails.",
      },
    ],
  },
  {
    category: "Administration & Multi-Tenancy",
    icon: "users",
    description: "Customer accounts, hosting plans, quotas, and panel settings.",
    permissions: [
      {
        id: "users:manage",
        label: "User Accounts & Multi-Tenancy",
        description: "Create, modify, suspend user accounts and manage workspace organizations.",
      },
      {
        id: "plans:manage",
        label: "Hosting Plans & Quotas",
        description: "Create, modify, and assign hosting packages (disk, database, domain quotas).",
      },
      {
        id: "settings:manage",
        label: "Panel Settings & Allowlist",
        description: "Configure panel domain, IP allowlist, session limits, and panel branding.",
      },
    ],
  },
];

export function getAllPermissionIds() {
  const ids = [];
  for (const group of PERMISSION_CATALOG) {
    for (const item of group.permissions) {
      ids.push(item.id);
    }
  }
  return ids;
}

export const DEFAULT_ROLE_PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: getAllPermissionIds(),
  [ROLES.SERVER_ADMIN]: [
    "server:metrics_view",
    "server:health_view",
    "server:services_view",
    "server:resources_view",
    "server:services_manage",
    "server:php_manage",
    "server:webserver_manage",
    "server:cron_manage",
    "server:terminal_access",
    "sites:manage",
    "sites:deploy",
    "domains:manage",
    "dns:manage",
    "apps:manage",
    "astro:manage",
    "wp:manage",
    "databases:manage",
    "files:docroot",
    "files:root",
    "ssl:manage",
    "backups:manage",
    "security:firewall",
    "security:fail2ban",
    "security:ssh",
    "security:scanner",
    "logs:view",
    "users:manage",
    "plans:manage",
    "settings:manage",
  ],
  [ROLES.RESELLER]: [
    "sites:manage",
    "sites:deploy",
    "domains:manage",
    "dns:manage",
    "apps:manage",
    "astro:manage",
    "wp:manage",
    "databases:manage",
    "files:docroot",
    "ssl:manage",
    "backups:manage",
    "logs:view",
    "users:manage",
    "plans:manage",
  ],
  [ROLES.CUSTOMER]: [
    "sites:manage",
    "sites:deploy",
    "domains:manage",
    "apps:manage",
    "wp:manage",
    "databases:manage",
    "files:docroot",
    "ssl:manage",
    "backups:manage",
  ],
  [ROLES.DEVELOPER]: [
    "sites:deploy",
    "domains:manage",
    "astro:manage",
    "wp:manage",
    "databases:manage",
    "files:docroot",
    "ssl:manage",
    "backups:manage",
    "logs:view",
  ],
  [ROLES.READ_ONLY]: [
    "server:metrics_view",
    "server:health_view",
    "server:services_view",
    "logs:view",
  ],
};

export const PERMISSIONS = {
  SERVER_MANAGE: "server:services_manage",
  SERVER_VIEW: "server:health_view",
  TERMINAL_ACCESS: "server:terminal_access",
  SECURITY_MANAGE: "security:firewall",
  SITES_MANAGE: "sites:manage",
  SITES_CREATE: "sites:manage",
  SITES_DELETE: "sites:manage",
  SITES_DEPLOY: "sites:deploy",
  DATABASES_MANAGE: "databases:manage",
  FILES_ROOT: "files:root",
  FILES_DOCROOT: "files:docroot",
  USERS_MANAGE: "users:manage",
  PLANS_MANAGE: "plans:manage",
  AUDIT_VIEW: "logs:view",
};

let permissionsCache = null;

function bootstrapDefaultPermissions(db) {
  const insert = db.prepare("INSERT OR IGNORE INTO role_permissions (role, permission) VALUES (?, ?)");
  const runTx = db.transaction(() => {
    for (const [role, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      if (role === ROLES.SUPER_ADMIN) continue;
      for (const perm of perms) {
        insert.run(role, perm);
      }
    }
  });
  runTx();
}

export function loadRolePermissions() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT role, permission FROM role_permissions").all();
    if (rows.length === 0) {
      bootstrapDefaultPermissions(db);
      return loadRolePermissions();
    }
    const allIds = getAllPermissionIds();
    const map = {
      [ROLES.SUPER_ADMIN]: allIds,
      [ROLES.SERVER_ADMIN]: [],
      [ROLES.RESELLER]: [],
      [ROLES.CUSTOMER]: [],
      [ROLES.DEVELOPER]: [],
      [ROLES.READ_ONLY]: [],
    };
    for (const row of rows) {
      if (!map[row.role]) map[row.role] = [];
      map[row.role].push(row.permission);
    }
    map[ROLES.SUPER_ADMIN] = allIds;
    permissionsCache = map;
    return map;
  } catch (err) {
    console.error("Failed to load role permissions from db, using defaults:", err);
    permissionsCache = { ...DEFAULT_ROLE_PERMISSIONS, [ROLES.SUPER_ADMIN]: getAllPermissionIds() };
    return permissionsCache;
  }
}

export function getAllRolePermissions() {
  if (!permissionsCache) {
    loadRolePermissions();
  }
  return permissionsCache;
}

export function getRolePermissions(role) {
  if (role === ROLES.SUPER_ADMIN) {
    return getAllPermissionIds();
  }
  const all = getAllRolePermissions();
  return all[role] || DEFAULT_ROLE_PERMISSIONS[role] || [];
}

export function saveRolePermissions(role, permissions) {
  if (role === ROLES.SUPER_ADMIN) {
    throw new Error("Super Admin permissions are fixed with full root authority.");
  }
  if (!Object.values(ROLES).includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const db = getDb();
  const validIds = new Set(getAllPermissionIds());
  const filtered = Array.from(new Set(permissions)).filter((p) => validIds.has(p));

  const deleteStmt = db.prepare("DELETE FROM role_permissions WHERE role = ?");
  const insertStmt = db.prepare("INSERT INTO role_permissions (role, permission) VALUES (?, ?)");

  const runTx = db.transaction(() => {
    deleteStmt.run(role);
    for (const perm of filtered) {
      insertStmt.run(role, perm);
    }
  });
  runTx();

  permissionsCache = null;
  return getRolePermissions(role);
}

export function resetRolePermissionsToDefault(targetRole = null) {
  const db = getDb();
  if (targetRole && targetRole !== "all") {
    if (targetRole === ROLES.SUPER_ADMIN) return getRolePermissions(ROLES.SUPER_ADMIN);
    const defaults = DEFAULT_ROLE_PERMISSIONS[targetRole] || [];
    return saveRolePermissions(targetRole, defaults);
  }
  db.prepare("DELETE FROM role_permissions").run();
  bootstrapDefaultPermissions(db);
  permissionsCache = null;
  return getAllRolePermissions();
}

const PERMISSION_ALIASES = {
  "server:manage": ["server:services_manage", "server:manage"],
  "server:view": ["server:health_view", "server:metrics_view", "server:view"],
  "security:manage": ["security:firewall", "security:fail2ban", "security:ssh", "security:scanner", "security:manage"],
  "sites:create": ["sites:manage", "sites:create"],
  "sites:delete": ["sites:manage", "sites:delete"],
  "audit:view": ["logs:view", "audit:view"],
  "terminal:access": ["server:terminal_access", "terminal:access"],
};

export function hasPermission(role, permission) {
  if (!role) return false;
  if (role === ROLES.SUPER_ADMIN) return true;
  const perms = getRolePermissions(role);
  if (perms.includes(permission)) return true;

  // Check aliases
  const aliases = PERMISSION_ALIASES[permission];
  if (aliases && aliases.some((a) => perms.includes(a))) {
    return true;
  }
  return false;
}

export function canAccessServerDetails(role) {
  return hasPermission(role, "server:metrics_view") || hasPermission(role, "server:health_view");
}

export function isRoleAtLeast(userRole, targetRole) {
  const userRank = ROLE_HIERARCHY[userRole] || 0;
  const targetRank = ROLE_HIERARCHY[targetRole] || 0;
  return userRank >= targetRank;
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const role = req.actor?.role;
    if (!role) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (role === ROLES.SUPER_ADMIN || allowedRoles.includes(role)) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: requires one of [${allowedRoles.join(", ")}]` });
  };
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const role = req.actor?.role;
    if (!role) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (hasPermission(role, permission)) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: permission ${permission} required` });
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    const role = req.actor?.role;
    if (!role) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (role === ROLES.SUPER_ADMIN || permissions.some((p) => hasPermission(role, p))) {
      return next();
    }
    return res.status(403).json({ error: `Forbidden: requires one of [${permissions.join(", ")}]` });
  };
}

export function assertResourceAccess(req, resourceOrgId) {
  const role = req.actor?.role;
  if (role === ROLES.SUPER_ADMIN || role === ROLES.SERVER_ADMIN) {
    return true;
  }
  if (!resourceOrgId || req.actor?.orgId !== resourceOrgId) {
    const error = new Error("Access denied to resource belonging to another organization");
    error.status = 403;
    throw error;
  }
  return true;
}
