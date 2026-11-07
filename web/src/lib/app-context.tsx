import { createContext, useContext, useState, type ReactNode } from "react";

export type PanelConfig = {
  panelDomain: string;
  adminUser: string;
  sessionHours: number;
  ipAllowlist: string[];
  allowedRoots: string[];
  backupDir: string;
  letsencryptEmail: string;
  phpFpmSocket: string;
  port: number;
  totpEnabled: boolean;
  maxUploadMb: number;
};

export type PanelUser = {
  id?: string;
  username: string;
  role: string;
  orgId?: string;
  permissions?: string[];
};

export function hasUserPermission(user: PanelUser | null | undefined, permission: string): boolean {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  if (!user.permissions || !Array.isArray(user.permissions)) return false;
  return user.permissions.includes(permission);
}

type AppState = {
  config: PanelConfig | null;
  user: PanelUser | null;
  setConfig: (config: PanelConfig) => void;
};

const AppContext = createContext<AppState>({ config: null, user: null, setConfig: () => {} });

export function AppProvider({
  config: initialConfig,
  user,
  children,
}: {
  config: PanelConfig | null;
  user: PanelUser | null;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<PanelConfig | null>(initialConfig);
  return <AppContext.Provider value={{ config, user, setConfig }}>{children}</AppContext.Provider>;
}

export function useApp() {
  return useContext(AppContext);
}
