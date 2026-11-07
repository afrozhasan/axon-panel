import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "./lib/api";
import { AppProvider, type PanelConfig, type PanelUser } from "./lib/app-context";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Sites from "./pages/Sites";
import SiteDetail from "./pages/SiteDetail";
import Apps from "./pages/Apps";
import PhpManagement from "./pages/PhpManagement";
import WebserverManagement from "./pages/WebserverManagement";
import DnsManagement from "./pages/DnsManagement";
import CronManagement from "./pages/CronManagement";
import Ssl from "./pages/Ssl";
import Databases from "./pages/Databases";
import Services from "./pages/Services";
import Files from "./pages/Files";
import Logs from "./pages/Logs";
import Terminal from "./pages/Terminal";
import Settings from "./pages/Settings";
import Security from "./pages/Security";
import Backups from "./pages/Backups";
import Users from "./pages/Users";
import HostingPlans from "./pages/HostingPlans";
import Domains from "./pages/Domains";
import AstroHeadless from "./pages/AstroHeadless";
import GitDeployments from "./pages/GitDeployments";
import WordPressToolkit from "./pages/WordPressToolkit";
import Notifications from "./pages/Notifications";
import SystemHealth from "./pages/SystemHealth";
import CustomerUsage from "./pages/CustomerUsage";
import Support from "./pages/Support";

type SessionResponse = {
  authenticated: boolean;
  user?: PanelUser;
  config?: PanelConfig;
};

function PermissionRoute({
  permission,
  user,
  superAdminOnly,
  children,
}: {
  permission?: string;
  user?: PanelUser | null;
  superAdminOnly?: boolean;
  children: ReactNode;
}) {
  if (!user) return <Navigate to="/" replace />;
  if (superAdminOnly) {
    if (user.role !== "super_admin") return <Navigate to="/" replace />;
    return <>{children}</>;
  }
  if (user.role === "super_admin") return <>{children}</>;
  if (permission && (!user.permissions || !user.permissions.includes(permission))) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    api
      .get<SessionResponse>("/auth/session")
      .then(setSession)
      .catch(() => setSession({ authenticated: false }));
  }, []);

  if (session === null) {
    return (
      <div className="flex h-full items-center justify-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading panel…
      </div>
    );
  }

  if (!session.authenticated) {
    return <Login onAuthenticated={(user, config) => setSession({ authenticated: true, user, config })} />;
  }

  const user = session.user;

  return (
    <AppProvider config={session.config ?? null} user={session.user ?? null}>
      <Layout onLogout={() => setSession({ authenticated: false })}>
        <Routes>
          {/* 1. Overview */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route
            path="/system/health"
            element={
              <PermissionRoute user={user} permission="server:health_view">
                <SystemHealth defaultTab="overview" />
              </PermissionRoute>
            }
          />

          {/* 2. Websites */}
          <Route path="/sites" element={<Sites />} />
          <Route path="/sites/:name" element={<SiteDetail />} />
          <Route path="/sites/:name/:tab" element={<SiteDetail />} />
          <Route path="/domains" element={<Domains />} />
          <Route path="/apps" element={<Apps />} />
          <Route path="/astro" element={<AstroHeadless />} />
          <Route path="/deployments" element={<GitDeployments />} />
          <Route path="/wordpress" element={<WordPressToolkit />} />

          {/* 3. Server Management */}
          <Route
            path="/server"
            element={
              <PermissionRoute user={user} permission="server:health_view">
                <SystemHealth defaultTab="overview" />
              </PermissionRoute>
            }
          />
          <Route
            path="/php"
            element={
              <PermissionRoute user={user} permission="server:php_manage">
                <PhpManagement />
              </PermissionRoute>
            }
          />
          <Route
            path="/services/pm2"
            element={
              <PermissionRoute user={user} permission="server:services_view">
                <Services defaultTab="pm2" />
              </PermissionRoute>
            }
          />
          <Route
            path="/webserver"
            element={
              <PermissionRoute user={user} permission="server:webserver_manage">
                <WebserverManagement />
              </PermissionRoute>
            }
          />
          <Route path="/databases" element={<Databases />} />
          <Route
            path="/services/redis"
            element={
              <PermissionRoute user={user} permission="server:services_view">
                <Services defaultTab="redis" />
              </PermissionRoute>
            }
          />
          <Route path="/cron" element={<CronManagement />} />
          <Route
            path="/services"
            element={
              <PermissionRoute user={user} permission="server:services_manage">
                <Services defaultTab="systemd" />
              </PermissionRoute>
            }
          />

          {/* 4. Security */}
          <Route
            path="/security"
            element={
              <PermissionRoute user={user} permission="security:firewall">
                <Security defaultTab="overview" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/firewall"
            element={
              <PermissionRoute user={user} permission="security:firewall">
                <Security defaultTab="firewall" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/fail2ban"
            element={
              <PermissionRoute user={user} permission="security:fail2ban">
                <Security defaultTab="fail2ban" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/ssh"
            element={
              <PermissionRoute user={user} permission="security:ssh">
                <Security defaultTab="ssh" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/scanner"
            element={
              <PermissionRoute user={user} permission="security:scanner">
                <Security defaultTab="scanner" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/integrity"
            element={
              <PermissionRoute user={user} permission="security:scanner">
                <Security defaultTab="scanner" />
              </PermissionRoute>
            }
          />
          <Route
            path="/security/audit"
            element={
              <PermissionRoute user={user} permission="logs:view">
                <Security defaultTab="panel" />
              </PermissionRoute>
            }
          />

          {/* 5. SSL & DNS */}
          <Route path="/ssl" element={<Ssl />} />
          <Route
            path="/dns"
            element={
              <PermissionRoute user={user} permission="dns:manage">
                <DnsManagement />
              </PermissionRoute>
            }
          />

          {/* 6. Backups & Storage */}
          <Route path="/backups" element={<Backups defaultTab="snapshots" />} />
          <Route
            path="/backups/schedules"
            element={<Backups defaultTab="schedules" />}
          />
          <Route
            path="/backups/remote"
            element={
              <PermissionRoute user={user} permission="backups:manage">
                <Backups defaultTab="remote" />
              </PermissionRoute>
            }
          />
          <Route path="/files" element={<Files />} />

          {/* 7. Monitoring & Logs */}
          <Route
            path="/monitoring"
            element={
              <PermissionRoute user={user} permission="server:health_view">
                <SystemHealth defaultTab="metrics" />
              </PermissionRoute>
            }
          />
          <Route path="/logs/websites" element={<Logs defaultGroup="nginx" />} />
          <Route
            path="/logs"
            element={
              <PermissionRoute user={user} permission="logs:view">
                <Logs defaultGroup="all" />
              </PermissionRoute>
            }
          />
          <Route
            path="/monitoring/services"
            element={
              <PermissionRoute user={user} permission="server:services_view">
                <SystemHealth defaultTab="services" />
              </PermissionRoute>
            }
          />

          {/* 8. Hosting Administration */}
          <Route
            path="/users/customers"
            element={
              <PermissionRoute user={user} permission="users:manage">
                <Users defaultRoleFilter="customer" />
              </PermissionRoute>
            }
          />
          <Route
            path="/users/resellers"
            element={
              <PermissionRoute user={user} permission="users:manage">
                <Users defaultRoleFilter="reseller" />
              </PermissionRoute>
            }
          />
          <Route path="/plans" element={<HostingPlans />} />
          <Route
            path="/users"
            element={
              <PermissionRoute user={user} permission="users:manage">
                <Users defaultRoleFilter="all" />
              </PermissionRoute>
            }
          />
          <Route path="/settings/integrations" element={<Settings />} />
          <Route path="/settings" element={<Settings />} />

          {/* 9. Admin Tools */}
          <Route
            path="/terminal"
            element={
              <PermissionRoute user={user} permission="server:terminal_access">
                <Terminal />
              </PermissionRoute>
            }
          />

          {/* 10. Customer Portal Exclusives */}
          <Route path="/account/usage" element={<CustomerUsage />} />
          <Route path="/support" element={<Support />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AppProvider>
  );
}
