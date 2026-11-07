import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { useApp } from "../lib/app-context";
import { formatBytes, formatDuration } from "../lib/format";
import ThemeToggle from "./ThemeToggle";

type Metrics = {
  hostname: string;
  cpu: { percent: number; cores: number };
  memory: { percent: number; used: number; total: number };
  load: { one: number; five: number; fifteen: number };
  uptimeSeconds: number;
  disks: { mount: string; percent: number; used: number; size: number }[];
};

type NavItem = {
  to: string;
  label: string;
  icon: string;
  badge?: string;
  permission?: string;
};

type NavSection = {
  header?: string;
  items: NavItem[];
};

function getNavSections(user?: any): NavSection[] {
  const isSuper = user?.role === "super_admin";
  const userPerms = new Set<string>(user?.permissions || []);

  const hasPerm = (perm?: string) => {
    if (!perm) return true;
    if (isSuper) return true;
    return userPerms.has(perm);
  };

  const rawSections: NavSection[] = [
    {
      header: isSuper || user?.role === "server_admin" ? "1. Overview" : "Overview",
      items: [
        { to: "/", label: "Dashboard", icon: "M3 12h7V3H3v9zm11 9h7v-9h-7v9zM3 21h7v-6H3v6zm11-12h7V3h-7v6z" },
        { to: "/notifications", label: "Notifications", icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" },
        { to: "/system/health", label: "System Health", permission: "server:health_view", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
      ],
    },
    {
      header: isSuper || user?.role === "server_admin" ? "2. Websites" : "Websites",
      items: [
        { to: "/sites", label: isSuper || user?.role === "server_admin" ? "All Websites" : "My Websites", permission: "sites:manage", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 0c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10m0-20C9.5 4.7 8 8.2 8 12s1.5 7.3 4 10M2.5 9h19M2.5 15h19" },
        { to: "/domains", label: "Domains & Subdomains", permission: "domains:manage", icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
        { to: "/apps", label: "One-Click Applications", permission: "apps:manage", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
        { to: "/astro", label: "Astro & Headless CMS", permission: "astro:manage", icon: "M12 2c-3.3 0-6 3-6 7.5 0 3 1.2 5.5 3 7.5l-2 4h4l1-2 1 2h4l-2-4c1.8-2 3-4.5 3-7.5C18 5 15.3 2 12 2zm0 4.5a2 2 0 110 4 2 2 0 010-4z" },
        { to: "/deployments", label: "Git & Deployments", permission: "sites:deploy", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
        { to: "/wordpress", label: "WordPress Toolkit", permission: "wp:manage", icon: "M12 2a10 10 0 100 20 10 10 0 000-20zm1 14.5l-2.5-7-2.5 7m1-2h3", badge: "Pro" },
      ],
    },
    {
      header: "3. Server Management",
      items: [
        { to: "/server", label: "Server Overview", permission: "server:health_view", icon: "M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" },
        { to: "/php", label: "PHP Management", permission: "server:php_manage", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
        { to: "/services/pm2", label: "Node.js & PM2", permission: "server:services_view", icon: "M13 10V3L4 14h7v7l9-11h-7z" },
        { to: "/webserver", label: "Nginx Management", permission: "server:webserver_manage", icon: "M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" },
        { to: "/databases", label: "Databases", permission: "databases:manage", icon: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zm8 6.5V12c0 1.7-3.6 3-8 3s-8-1.3-8-3V9.5c1.7 1.4 4.7 2 8 2s6.3-.6 8-2zm0 6V18c0 1.7-3.6 3-8 3s-8-1.3-8-3v-2.5c1.7 1.4 4.7 2 8 2s6.3-.6 8-2z" },
        { to: "/services/redis", label: "Redis Management", permission: "server:services_view", icon: "M4 7v10c0 2 1.5 3 3.5 3h9c2 0 3.5-1 3.5-3V7c0-2-1.5-3-3.5-3h-9C5.5 4 4 5 4 7z" },
        { to: "/cron", label: "Cron Jobs", permission: "server:cron_manage", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
        { to: "/services", label: "Process Manager", permission: "server:services_manage", icon: "M4 5h16v4H4V5zm0 6h16v4H4v-4zm0 6h16v4H4v-4z" },
      ],
    },
    {
      header: "4. Security",
      items: [
        { to: "/security", label: "Security Overview", permission: "security:firewall", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
        { to: "/security/firewall", label: "Firewall (UFW)", permission: "security:firewall", icon: "M12 2l8 4v6c0 5-3.4 8.9-8 10-4.6-1.1-8-5-8-10V6l8-4z" },
        { to: "/security/fail2ban", label: "Fail2Ban", permission: "security:fail2ban", icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" },
        { to: "/security/ssh", label: "SSH & Access Keys", permission: "security:ssh", icon: "M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" },
        { to: "/security/scanner", label: "Security Scanner", permission: "security:scanner", icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" },
        { to: "/security/audit", label: "Audit Logs", permission: "logs:view", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" },
      ],
    },
    {
      header: "5. SSL & DNS",
      items: [
        { to: "/ssl", label: "SSL Certificates", permission: "ssl:manage", icon: "M12 2l8 4v6c0 5-3.4 8.9-8 10-4.6-1.1-8-5-8-10V6l8-4zm0 6a3 3 0 00-1 5.8V17h2v-3.2A3 3 0 0012 8z" },
        { to: "/dns", label: "DNS Zone Manager", permission: "dns:manage", icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
      ],
    },
    {
      header: "6. Backups & Storage",
      items: [
        { to: "/backups", label: "Backup Manager", permission: "backups:manage", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" },
        { to: "/backups/schedules", label: "Backup Schedules", permission: "backups:manage", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
        { to: "/files", label: "File Manager", permission: "files:docroot", icon: "M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6z" },
      ],
    },
    {
      header: "7. Monitoring & Logs",
      items: [
        { to: "/monitoring", label: "Resource Monitoring", permission: "server:health_view", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
        { to: "/logs/websites", label: "Website Logs", permission: "logs:view", icon: "M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" },
        { to: "/logs", label: "System Logs", permission: "logs:view", icon: "M4 4h16v16H4V4zm3 4h10M7 12h10M7 16h6" },
      ],
    },
    {
      header: "8. Hosting Administration",
      items: [
        { to: "/users/customers", label: "Customers", permission: "users:manage", icon: "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" },
        { to: "/users/resellers", label: "Resellers", permission: "users:manage", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" },
        { to: "/plans", label: "Hosting Plans", permission: "plans:manage", icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" },
        { to: "/users", label: "Users & Permissions", permission: "users:manage", icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" },
        { to: "/settings", label: "Panel Settings", permission: "settings:manage", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 00-2-1.2L14.5 2h-4l-.4 2.6a7.6 7.6 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 002 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z" },
      ],
    },
    {
      header: "9. Admin Tools",
      items: [
        { to: "/terminal", label: "Web Terminal", permission: "server:terminal_access", icon: "M3 5h18v14H3V5zm4 4l3 3-3 3m6 0h5" },
      ],
    },
    {
      header: "Account",
      items: [
        { to: "/account/usage", label: "Usage & Quotas", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
        { to: "/support", label: "Support", icon: "M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
      ],
    },
  ];

  return rawSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => hasPerm(item.permission)),
    }))
    .filter((section) => section.items.length > 0);
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 shrink-0">
      <path d={path} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const PAGE_TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/notifications": "Notifications & Tasks",
  "/system/health": "System Health",
  "/server": "Server Overview",
  "/sites": "All Websites",
  "/domains": "Domains & Subdomains",
  "/apps": "One-Click Applications",
  "/astro": "Astro & Headless CMS",
  "/deployments": "Git & Deployments",
  "/wordpress": "WordPress Toolkit Pro",
  "/php": "PHP Management",
  "/services/pm2": "Node.js & PM2",
  "/webserver": "Nginx Management",
  "/databases": "Databases",
  "/services/redis": "Redis Management",
  "/cron": "Cron Jobs",
  "/services": "Process Manager",
  "/security": "Security Overview",
  "/security/firewall": "Firewall (UFW)",
  "/security/fail2ban": "Fail2Ban Protection",
  "/security/ssh": "SSH & Access Keys",
  "/security/scanner": "Security Scanner",
  "/security/integrity": "File Integrity",
  "/security/audit": "Audit Logs",
  "/ssl": "SSL Certificates",
  "/dns": "DNS Zone Manager",
  "/backups": "Backup Manager",
  "/backups/schedules": "Backup Schedules",
  "/backups/remote": "Remote Storage",
  "/files": "File Manager",
  "/monitoring": "Resource Monitoring",
  "/logs/websites": "Website Logs",
  "/logs": "System Logs",
  "/monitoring/services": "Service Status",
  "/users/customers": "Customers",
  "/users/resellers": "Resellers",
  "/plans": "Hosting Plans & Quotas",
  "/users": "Users & Permissions",
  "/settings/integrations": "Integrations & API",
  "/settings": "Panel Settings",
  "/terminal": "Web Terminal",
  "/account/usage": "Account Usage & Quotas",
  "/support": "Support & Knowledgebase",
};

export default function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const { user } = useApp();
  const location = useLocation();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [quota, setQuota] = useState<{ websites: { used: number; max: number }; databases: { used: number; max: number }; planName: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("axon_sidebar_collapsed") === "true");
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleSidebar = () => {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("axon_sidebar_collapsed", String(next));
      return next;
    });
  };

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile drawer on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const canViewMetrics = user?.role === "super_admin" || (user?.permissions?.includes("server:metrics_view") ?? false);

  useEffect(() => {
    let cancelled = false;
    if (!canViewMetrics) {
      setMetrics(null);
      return;
    }
    const load = async () => {
      try {
        const data = await api.get<Metrics>("/system/metrics");
        if (!cancelled) setMetrics(data);
      } catch {
        /* best-effort */
      }
    };
    load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canViewMetrics]);

  useEffect(() => {
    if (user?.role === "customer" || user?.role === "reseller" || !canViewMetrics) {
      api
        .get<{ usage: any }>("/users/quota")
        .then((res) => {
          if (res?.usage) setQuota(res.usage);
        })
        .catch(() => {});
    }
  }, [user?.role, canViewMetrics]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await api.post("/auth/logout");
    } catch {}
    onLogout();
  };

  const navSections = getNavSections(user);
  const isPrivileged = user?.role === "super_admin" || user?.role === "server_admin";
  const rootDisk = metrics?.disks.find((disk) => disk.mount === "/");
  const roleDisplay = user?.role ? user.role.replace("_", " ").toUpperCase() : "SUPER ADMIN";

  const renderNavContent = (isCollapsed: boolean, onItemClick?: () => void) => (
    <nav className="flex-1 min-h-0 space-y-4 overflow-y-auto px-2.5 py-3 text-xs">
      {navSections.map((section, sIdx) => (
        <div key={sIdx} className="space-y-1">
          {section.header && !isCollapsed && (
            <p className="px-2.5 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--axon-muted)]/80">
              {section.header}
            </p>
          )}
          {section.items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={onItemClick}
              title={isCollapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center ${
                  isCollapsed ? "justify-center px-2" : "justify-between px-2.5"
                } py-2 text-[12px] font-medium transition-all duration-150 ${
                  isActive
                    ? isCollapsed
                      ? "bg-[var(--axon-primary)]/15 text-[var(--axon-primary)] font-semibold rounded-lg"
                      : "bg-[var(--axon-primary)]/10 text-[var(--axon-primary)] font-semibold border-l-2 border-[var(--axon-primary)] pl-2.5 rounded-r-lg"
                    : "text-[var(--axon-muted)] hover:bg-[var(--axon-card-hover)] hover:text-[var(--axon-text)] rounded-lg"
                }`
              }
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <NavIcon path={item.icon} />
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </div>
              {!isCollapsed && item.badge && (
                <span className="rounded-full bg-[var(--axon-primary)]/15 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--axon-primary)] border border-[var(--axon-primary)]/20">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );

  const renderSidebarFooter = (isCollapsed: boolean) => {
    if (isCollapsed) {
      return (
        <div className="shrink-0 border-t border-[var(--axon-border)] p-2 flex flex-col items-center gap-2 bg-[var(--axon-sidebar)]">
          <button
            onClick={signOut}
            disabled={signingOut}
            className="h-9 w-9 flex items-center justify-center rounded-lg text-[var(--axon-muted)] hover:text-rose-400 hover:bg-[var(--axon-card-hover)] transition"
            title="Sign out"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      );
    }

    return (
      <div className="shrink-0 space-y-2.5 border-t border-[var(--axon-border)] bg-[var(--axon-sidebar)] p-3.5 text-xs">
        {canViewMetrics && metrics && (
          <div className="rounded-lg border border-[var(--axon-border)]/80 bg-[var(--axon-card)]/50 p-2.5 space-y-1.5">
            <dl className="space-y-1.5 text-[11px] text-[var(--axon-muted)]">
              <div className="flex justify-between items-center">
                <dt className="text-[10px] uppercase tracking-wider font-medium">CPU</dt>
                <dd className={metrics.cpu.percent > 85 ? "font-bold text-rose-400" : "font-medium text-[var(--axon-text)]"}>
                  {metrics.cpu.percent}%
                </dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-[10px] uppercase tracking-wider font-medium">RAM</dt>
                <dd className={metrics.memory.percent > 90 ? "font-bold text-rose-400" : "font-medium text-[var(--axon-text)]"}>
                  {metrics.memory.percent}% ({formatBytes(metrics.memory.used, 1)})
                </dd>
              </div>
              {rootDisk && (
                <div className="flex justify-between items-center">
                  <dt className="text-[10px] uppercase tracking-wider font-medium">Disk</dt>
                  <dd className={rootDisk.percent > 88 ? "font-bold text-rose-400" : "font-medium text-[var(--axon-text)]"}>
                    {rootDisk.percent}% ({formatBytes(rootDisk.used, 0)})
                  </dd>
                </div>
              )}
              <div className="flex justify-between items-center pt-0.5 border-t border-[var(--axon-border)]/50 text-[10px]">
                <dt className="uppercase tracking-wider">Uptime</dt>
                <dd className="font-medium text-[var(--axon-text)]">{formatDuration(metrics.uptimeSeconds)}</dd>
              </div>
            </dl>
          </div>
        )}

        {!canViewMetrics && quota && (
          <div className="rounded-lg border border-[var(--axon-border)]/80 bg-[var(--axon-card)]/50 p-2.5 space-y-1.5">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold text-[var(--axon-muted)]">
              <span>{quota.planName || "Hosting Plan"}</span>
              <span className="text-[var(--axon-primary)]">{quota.orgName || "Workspace"}</span>
            </div>
            <dl className="space-y-1 text-[11px] text-[var(--axon-muted)]">
              <div className="flex justify-between items-center">
                <dt className="text-[10px]">Disk</dt>
                <dd className="font-medium text-[var(--axon-text)]">{formatBytes((quota.storageMb?.used || 0) * 1024 * 1024)} / {quota.storageMb?.max >= 999999 ? "∞" : formatBytes((quota.storageMb?.max || 0) * 1024 * 1024)}</dd>
              </div>
              <div className="flex justify-between items-center">
                <dt className="text-[10px]">Websites</dt>
                <dd className="font-medium text-[var(--axon-text)]">{quota.websites?.used ?? 0} / {quota.websites?.max ?? "∞"}</dd>
              </div>
            </dl>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="min-w-0">
            <span className="truncate text-[11px] text-[var(--axon-text)] font-mono block">@{user?.username ?? "admin"}</span>
            <span className="text-[9px] font-semibold uppercase text-[var(--axon-primary)] tracking-wider">{roleDisplay}</span>
          </div>
          <button
            onClick={signOut}
            disabled={signingOut}
            className="text-xs px-2.5 py-1 rounded-md bg-[var(--axon-card)] border border-[var(--axon-border)] text-[var(--axon-muted)] hover:text-rose-400 hover:border-rose-500/40 transition shadow-xs"
            title="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full bg-[var(--axon-bg)] text-[var(--axon-text)]">
      {/* Mobile Drawer Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-xs transition-opacity duration-200 lg:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Mobile Off-Canvas Sidebar Drawer */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-[var(--axon-border)] bg-[var(--axon-sidebar)] shadow-2xl transition-transform duration-200 ease-in-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-[var(--axon-border)] px-4 py-3.5 bg-[var(--axon-sidebar)]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-xs font-black tracking-wider text-white shadow-md shadow-blue-500/20">
              AP
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-[var(--axon-text)]">Axon Panel</p>
              <p className="mono truncate text-[10px] text-[var(--axon-muted)]">{typeof window !== "undefined" ? window.location.hostname : "localhost"}</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--axon-muted)] hover:text-[var(--axon-text)] hover:bg-[var(--axon-card-hover)] transition"
            aria-label="Close navigation"
          >
            ✕
          </button>
        </div>
        {renderNavContent(false, () => setMobileOpen(false))}
        {renderSidebarFooter(false)}
      </aside>

      {/* Desktop Permanent Sidebar */}
      <aside
        className={`hidden lg:flex shrink-0 flex-col h-full max-h-screen min-h-0 border-r border-[var(--axon-border)] bg-[var(--axon-sidebar)] transition-all duration-200 ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between border-b border-[var(--axon-border)] px-3.5 py-3.5 bg-[var(--axon-sidebar)]">
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-xs font-black tracking-wider text-white shadow-md shadow-blue-500/20">
              AP
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-[var(--axon-text)]">Axon Panel</p>
                <p className="mono truncate text-[10px] text-[var(--axon-muted)]">{typeof window !== "undefined" ? window.location.hostname : "localhost"}</p>
              </div>
            )}
          </div>
          <button
            onClick={toggleSidebar}
            className="hidden lg:flex h-6 w-6 items-center justify-center rounded text-[var(--axon-muted)] hover:text-[var(--axon-text)] hover:bg-[var(--axon-card-hover)] transition"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
              {collapsed ? (
                <path d="M13 17l5-5-5-5M6 17l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
              ) : (
                <path d="M11 17l-5-5 5-5M18 17l-5-5 5-5" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>
          </button>
        </div>

        {/* Navigation Sections */}
        {renderNavContent(collapsed)}

        {/* Footer Metrics */}
        {renderSidebarFooter(collapsed)}
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        {/* Top Header */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-[var(--axon-border)] bg-[var(--axon-sidebar)]/85 px-4 sm:px-6 backdrop-blur-md">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <button
              onClick={() => setMobileOpen(true)}
              className="lg:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-muted)] hover:text-[var(--axon-text)] hover:bg-[var(--axon-card-hover)] transition shrink-0 mr-1"
              title="Open menu"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4.5 w-4.5">
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 truncate">
              <span className="hidden sm:inline text-xs text-[var(--axon-muted)]">Axon Panel</span>
              <span className="hidden sm:inline text-[var(--axon-border)]">/</span>
              <span className="truncate text-xs sm:text-sm font-semibold text-[var(--axon-text)]">
                {PAGE_TITLES[location.pathname] || "Control"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            {/* Customer Portal Pill */}
            {user?.role === "customer" && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Customer Portal</span>
              </div>
            )}

            {/* Quota Usage Pill for Customers / Resellers */}
            {quota && (
              <div className="hidden md:flex items-center gap-2 rounded-full border border-[var(--axon-border)] bg-[var(--axon-card)] px-3 py-1 text-[11px] text-[var(--axon-muted)]">
                <span>Plan: <strong className="text-[var(--axon-text)]">{quota.planName}</strong></span>
                <span className="text-[var(--axon-border)]">•</span>
                <span>Sites: <strong className="text-[var(--axon-text)]">{quota.websites.used}/{quota.websites.max >= 999 ? "∞" : quota.websites.max}</strong></span>
                <span className="text-[var(--axon-border)]">•</span>
                <span>DBs: <strong className="text-[var(--axon-text)]">{quota.databases.used}/{quota.databases.max >= 999 ? "∞" : quota.databases.max}</strong></span>
              </div>
            )}

            {/* Server IP Pill (Admins) */}
            {isPrivileged && (
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-[var(--axon-border)] bg-[var(--axon-card)] px-3 py-1 text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-mono text-[11px] text-[var(--axon-muted)]">{typeof window !== "undefined" ? window.location.hostname : "localhost"}</span>
              </div>
            )}

            {/* Theme Toggle Button */}
            <ThemeToggle />

            {/* Terminal Quick Action (Super Admin & Server Admin Only) */}
            {isPrivileged && (
              <Link
                to="/terminal"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-muted)] transition hover:border-[var(--axon-muted)] hover:text-[var(--axon-text)]"
                title="Terminal Web Shell"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
                  <path d="M4 17l6-6-6-6m8 14h8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </Link>
            )}

            {/* Add Site Button */}
            <Link
              to="/sites"
              className="flex items-center gap-1.5 rounded-lg bg-[var(--axon-primary)] px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-[var(--axon-primary-fg)] shadow-sm shadow-blue-500/20 hover:bg-[var(--axon-primary-hover)] transition"
            >
              <span>+</span>
              <span className="hidden xs:inline sm:inline">Add Site</span>
            </Link>

            {/* User Dropdown / Sign out */}
            <div className="flex items-center gap-2 border-l border-[var(--axon-border)] pl-2 sm:pl-3">
              <div className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-full bg-[var(--axon-primary)]/15 text-xs font-bold text-[var(--axon-primary)] border border-[var(--axon-primary)]/30">
                {(user?.username || "A").slice(0, 1).toUpperCase()}
              </div>
              <div className="hidden md:flex flex-col">
                <span className="font-mono text-xs text-[var(--axon-text)]">@{user?.username ?? "admin"}</span>
                <span className="text-[9px] font-semibold text-[var(--axon-primary)] uppercase tracking-wider">{roleDisplay}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          <div key={location.pathname} className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
