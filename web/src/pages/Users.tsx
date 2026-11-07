import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, Card, Spinner } from "../components/ui";
import { useApp } from "../lib/app-context";

type HostingPlan = {
  id: string;
  name: string;
  slug: string;
  max_websites: number;
  max_databases: number;
  max_storage_mb: number;
  max_bandwidth_mb: number;
};

type UserAccount = {
  id: string;
  username: string;
  email: string;
  role: string;
  status: "active" | "suspended" | "pending";
  totp_enabled: number;
  created_at: string;
  last_login_at: string | null;
  organization_id: string;
  organization_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  website_count: number;
  database_count: number;
};

type RoleDefinition = {
  id: string;
  name: string;
  isConfigurable: boolean;
  badge: string;
  description: string;
};

type PermissionItem = {
  id: string;
  label: string;
  description: string;
  isServerDetail?: boolean;
};

type PermissionGroup = {
  category: string;
  icon: string;
  description: string;
  permissions: PermissionItem[];
};

type RolePermissionsData = {
  roles: RoleDefinition[];
  catalog: PermissionGroup[];
  permissions: Record<string, string[]>;
  canEdit: boolean;
};

export default function Users({ defaultRoleFilter = "all" }: { defaultRoleFilter?: string }) {
  const { user: currentUser } = useApp();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [plans, setPlans] = useState<HostingPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState(defaultRoleFilter);

  useEffect(() => {
    if (defaultRoleFilter) {
      setRoleFilter(defaultRoleFilter);
    }
  }, [defaultRoleFilter]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modals state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addForm, setAddForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "customer",
    planId: "plan_starter",
    orgName: "",
  });
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [editForm, setEditForm] = useState({
    email: "",
    role: "customer",
    status: "active",
    planId: "",
  });
  const [submittingEdit, setSubmittingEdit] = useState(false);

  const [resettingUser, setResettingUser] = useState<UserAccount | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [submittingReset, setSubmittingReset] = useState(false);

  const [deletingUser, setDeletingUser] = useState<UserAccount | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  // Role Permissions Configuration State
  const [activeMainTab, setActiveMainTab] = useState<"accounts" | "permissions">("accounts");
  const [rolesData, setRolesData] = useState<RolePermissionsData | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("customer");
  const [rolePermsState, setRolePermsState] = useState<Record<string, string[]>>({});
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [permSearch, setPermSearch] = useState("");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const loadRolePermissionsData = async () => {
    try {
      setLoadingRoles(true);
      setError(null);
      const data = await api.get<RolePermissionsData>("/users/roles/permissions");
      setRolesData(data);
      setRolePermsState(data.permissions || {});
      setHasUnsavedChanges(false);
    } catch (err: any) {
      setError(err?.message || "Failed to load role permissions catalog");
    } finally {
      setLoadingRoles(false);
    }
  };

  const handleTogglePermission = (role: string, permId: string) => {
    if (role === "super_admin") return;
    const current = rolePermsState[role] || [];
    const updated = current.includes(permId)
      ? current.filter((p) => p !== permId)
      : [...current, permId];

    setRolePermsState((prev) => ({
      ...prev,
      [role]: updated,
    }));
    setHasUnsavedChanges(true);
  };

  const handleSelectAll = (role: string) => {
    if (role === "super_admin" || !rolesData) return;
    const allIds: string[] = [];
    rolesData.catalog.forEach((cat) => cat.permissions.forEach((p) => allIds.push(p.id)));
    setRolePermsState((prev) => ({
      ...prev,
      [role]: allIds,
    }));
    setHasUnsavedChanges(true);
  };

  const handleDeselectAll = (role: string) => {
    if (role === "super_admin") return;
    setRolePermsState((prev) => ({
      ...prev,
      [role]: [],
    }));
    setHasUnsavedChanges(true);
  };

  const handleSavePermissions = async (role: string) => {
    if (role === "super_admin") return;
    try {
      setSavingRole(true);
      setError(null);
      const current = rolePermsState[role] || [];
      const res = await api.put<{ ok: boolean; permissions: string[]; allPermissions: Record<string, string[]> }>(
        `/users/roles/permissions/${role}`,
        { permissions: current }
      );
      if (res?.allPermissions) {
        setRolePermsState(res.allPermissions);
      }
      setHasUnsavedChanges(false);
      setSuccess(`Updated permissions for ${role.replace("_", " ").toUpperCase()}`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.message || `Failed to update permissions for ${role}`);
    } finally {
      setSavingRole(false);
    }
  };

  const handleResetRole = async (role: string) => {
    if (!window.confirm(`Reset permissions for ${role.replace("_", " ").toUpperCase()} to system default settings?`)) return;
    try {
      setSavingRole(true);
      setError(null);
      const res = await api.post<{ ok: boolean; allPermissions: Record<string, string[]> }>(
        `/users/roles/permissions/${role}/reset`
      );
      if (res?.allPermissions) {
        setRolePermsState(res.allPermissions);
      }
      setHasUnsavedChanges(false);
      setSuccess(`Reset permissions to defaults for ${role.replace("_", " ").toUpperCase()}`);
      setTimeout(() => setSuccess(null), 4000);
    } catch (err: any) {
      setError(err?.message || `Failed to reset permissions for ${role}`);
    } finally {
      setSavingRole(false);
    }
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [userData, plansData] = await Promise.all([
        api.get<{ users: UserAccount[] }>("/users"),
        api.get<{ plans: HostingPlan[] }>("/plans").catch(() => ({ plans: [] })),
      ]);
      setUsers(userData.users || []);
      setPlans(plansData.plans || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load users list");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const generatePassword = () => {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
    let res = "";
    for (let i = 0; i < 16; i++) {
      res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
  };

  const handleOpenAdd = () => {
    setAddForm({
      username: "",
      email: "",
      password: generatePassword(),
      role: "customer",
      planId: plans[0]?.id || "plan_starter",
      orgName: "",
    });
    setIsAddOpen(true);
  };

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingAdd(true);
    setError(null);
    try {
      await api.post("/users", addForm);
      setSuccess(`User "${addForm.username}" created successfully.`);
      setIsAddOpen(false);
      loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to create user");
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleOpenEdit = (user: UserAccount) => {
    setEditingUser(user);
    setEditForm({
      email: user.email,
      role: user.role,
      status: user.status,
      planId: user.plan_id || plans[0]?.id || "",
    });
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setSubmittingEdit(true);
    setError(null);
    try {
      await api.put(`/users/${editingUser.id}`, editForm);
      setSuccess(`User "${editingUser.username}" updated.`);
      setEditingUser(null);
      loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to update user");
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resettingUser) return;
    setSubmittingReset(true);
    setError(null);
    try {
      await api.post(`/users/${resettingUser.id}/password`, { password: newPassword });
      setSuccess(`Password for "${resettingUser.username}" reset successfully.`);
      setResettingUser(null);
      setNewPassword("");
    } catch (err: any) {
      setError(err?.message || "Failed to reset password");
    } finally {
      setSubmittingReset(false);
    }
  };

  const handleDeleteSubmit = async () => {
    if (!deletingUser) return;
    setSubmittingDelete(true);
    setError(null);
    try {
      await api.delete(`/users/${deletingUser.id}`);
      setSuccess(`User "${deletingUser.username}" deleted.`);
      setDeletingUser(null);
      loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to delete user");
    } finally {
      setSubmittingDelete(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.username.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.organization_name && u.organization_name.toLowerCase().includes(search.toLowerCase()));
    const matchesRole = roleFilter === "all" || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const countCustomer = users.filter((u) => u.role === "customer").length;
  const countReseller = users.filter((u) => u.role === "reseller").length;
  const countStaff = users.filter((u) => u.role === "super_admin" || u.role === "server_admin").length;

  const roleBadge = (role: string) => {
    switch (role) {
      case "super_admin":
        return <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-bold text-purple-400 uppercase tracking-wider">Super Admin</span>;
      case "server_admin":
        return <span className="rounded-full bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Server Admin</span>;
      case "reseller":
        return <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-400 uppercase tracking-wider">Reseller</span>;
      case "customer":
        return <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Customer</span>;
      case "developer":
        return <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold text-amber-400 uppercase tracking-wider">Developer</span>;
      default:
        return <span className="rounded-full bg-slate-500/15 border border-slate-500/30 px-2 py-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{role}</span>;
    }
  };

  useEffect(() => {
    if (activeMainTab === "permissions" && !rolesData && !loadingRoles) {
      loadRolePermissionsData();
    }
  }, [activeMainTab]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--axon-text)]">Users & Multi-Tenancy</h1>
          <p className="text-xs text-[var(--axon-muted)] mt-0.5">
            Manage customer workspaces, staff accounts, role-based access control, and server telemetry permissions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeMainTab === "accounts" ? (
            <Button onClick={handleOpenAdd} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold text-xs">
              + Add New User
            </Button>
          ) : (
            selectedRole !== "super_admin" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => handleResetRole(selectedRole)}
                  disabled={savingRole || (rolesData && !rolesData.canEdit)}
                  className="text-xs"
                >
                  Reset Defaults
                </Button>
                <Button
                  onClick={() => handleSavePermissions(selectedRole)}
                  disabled={savingRole || !hasUnsavedChanges || (rolesData && !rolesData.canEdit)}
                  className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold text-xs flex items-center gap-1.5"
                >
                  {savingRole && <Spinner />}
                  <span>Save Permissions</span>
                </Button>
              </>
            )
          )}
        </div>
      </div>

      {/* Main Mode Navigation Tabs */}
      <div className="flex border-b border-[var(--axon-border)] space-x-6 text-xs font-medium">
        <button
          onClick={() => setActiveMainTab("accounts")}
          className={`pb-2.5 flex items-center gap-2 border-b-2 transition ${
            activeMainTab === "accounts"
              ? "border-[var(--axon-primary)] text-[var(--axon-primary)] font-semibold"
              : "border-transparent text-[var(--axon-muted)] hover:text-[var(--axon-text)]"
          }`}
        >
          <span>👥 User Accounts</span>
          <span className="rounded-full bg-[var(--axon-card)] px-1.5 py-0.5 text-[10px] text-[var(--axon-muted)] border border-[var(--axon-border)]">
            {users.length}
          </span>
        </button>
        <button
          onClick={() => {
            setActiveMainTab("permissions");
            if (!rolesData) loadRolePermissionsData();
          }}
          className={`pb-2.5 flex items-center gap-2 border-b-2 transition ${
            activeMainTab === "permissions"
              ? "border-[var(--axon-primary)] text-[var(--axon-primary)] font-semibold"
              : "border-transparent text-[var(--axon-muted)] hover:text-[var(--axon-text)]"
          }`}
        >
          <span>🛡️ Roles & Permissions</span>
          <span className="rounded-full bg-[var(--axon-primary)]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)] border border-[var(--axon-primary)]/30">
            Configurable
          </span>
        </button>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 text-xs flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-300">✕</button>
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs flex justify-between items-center">
          <span>{success}</span>
          <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-emerald-300">✕</button>
        </div>
      )}

      {activeMainTab === "accounts" ? (
        <>
          {/* Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Total Accounts</p>
              <p className="text-2xl font-black text-[var(--axon-text)] mt-1">{users.length}</p>
            </Card>
            <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Hosting Customers</p>
              <p className="text-2xl font-black text-emerald-400 mt-1">{countCustomer}</p>
            </Card>
            <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Resellers</p>
              <p className="text-2xl font-black text-cyan-400 mt-1">{countReseller}</p>
            </Card>
            <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">Admins & Staff</p>
              <p className="text-2xl font-black text-purple-400 mt-1">{countStaff}</p>
            </Card>
          </div>

          {/* Search & Filter Bar */}
          <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              <div className="w-full sm:w-80">
                <input
                  placeholder="Search by username, email, workspace…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="field text-xs w-full"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <span className="text-xs text-[var(--axon-muted)] shrink-0">Role:</span>
                <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="field text-xs">
                  <option value="all">All Roles</option>
                  <option value="customer">Customers</option>
                  <option value="developer">Developers</option>
                  <option value="reseller">Resellers</option>
                  <option value="server_admin">Server Admins</option>
                  <option value="super_admin">Super Admins</option>
                </select>
                <Button variant="outline" onClick={loadData} className="text-xs">
                  Refresh
                </Button>
              </div>
            </div>
          </Card>

          {/* Users Table */}
          <Card className="overflow-hidden bg-[var(--axon-card)] border-[var(--axon-border)]">
            {loading ? (
              <div className="p-12 text-center text-xs text-[var(--axon-muted)] flex items-center justify-center gap-2">
                <Spinner /> Loading users…
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-12 text-center text-xs text-[var(--axon-muted)]">
                No accounts found matching your filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[var(--axon-border)] bg-[var(--axon-sidebar)] text-[10px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Workspace & Plan</th>
                      <th className="px-4 py-3">Resources</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Last Active</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--axon-border)]">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--axon-primary)]/15 text-xs font-bold text-[var(--axon-primary)] border border-[var(--axon-primary)]/30">
                              {u.username.slice(0, 1).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-[var(--axon-text)]">@{u.username}</p>
                              <p className="text-[11px] text-[var(--axon-muted)] truncate max-w-[180px]">{u.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">{roleBadge(u.role)}</td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-[var(--axon-text)] font-medium">{u.organization_name || "Default Workspace"}</p>
                            <p className="text-[10px] text-[var(--axon-primary)] font-semibold">{u.plan_name || "Enterprise"}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[var(--axon-text)] font-mono">{u.website_count}</span> sites,{" "}
                          <span className="text-[var(--axon-text)] font-mono">{u.database_count}</span> dbs
                        </td>
                        <td className="px-4 py-3">
                          {u.status === "active" ? (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-rose-400 font-medium">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-400" /> Suspended
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-[var(--axon-muted)]">
                          {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : "Never"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenEdit(u)}
                              className="h-7 text-[11px] px-2"
                            >
                              Edit
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setResettingUser(u);
                                setNewPassword(generatePassword());
                              }}
                              className="h-7 text-[11px] px-2 text-[var(--axon-muted)] hover:text-[var(--axon-text)]"
                              title="Reset Password"
                            >
                              Key
                            </Button>
                            {currentUser?.username !== u.username && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDeletingUser(u)}
                                className="h-7 text-[11px] px-2 text-rose-400 hover:text-rose-300 hover:border-rose-500/40"
                                title="Delete User"
                              >
                                ✕
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : (
        /* Role Permissions & Server Telemetry Configurator */
        <div className="space-y-6">
          {loadingRoles && !rolesData ? (
            <div className="p-16 text-center text-xs text-[var(--axon-muted)] flex items-center justify-center gap-2">
              <Spinner /> Loading configurable roles & permissions catalog…
            </div>
          ) : !rolesData ? (
            <div className="p-12 text-center text-xs text-rose-400">
              Failed to load permissions catalog.
            </div>
          ) : (
            <>
              {/* Role Picker Pills */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
                {rolesData.roles.map((r) => {
                  const isSelected = selectedRole === r.id;
                  const permsCount = r.id === "super_admin"
                    ? "Full Access"
                    : `${(rolePermsState[r.id] || []).length} active`;

                  return (
                    <button
                      key={r.id}
                      onClick={() => {
                        setSelectedRole(r.id);
                        setHasUnsavedChanges(false);
                      }}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        isSelected
                          ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 shadow-sm ring-1 ring-[var(--axon-primary)]/50"
                          : "border-[var(--axon-border)] bg-[var(--axon-card)] hover:bg-[var(--axon-card-hover)]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                          r.id === "super_admin"
                            ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                            : isSelected
                            ? "bg-[var(--axon-primary)]/20 text-[var(--axon-primary)]"
                            : "bg-[var(--axon-border)] text-[var(--axon-muted)]"
                        }`}>
                          {r.badge}
                        </span>
                        {isSelected && (
                          <span className="h-1.5 w-1.5 rounded-full bg-[var(--axon-primary)]" />
                        )}
                      </div>
                      <p className="font-bold text-xs text-[var(--axon-text)] truncate">{r.name}</p>
                      <p className="text-[10px] text-[var(--axon-muted)] mt-0.5 font-mono">{permsCount}</p>
                    </button>
                  );
                })}
              </div>

              {/* Selected Role Banner & Action Bar */}
              {(() => {
                const curRoleDef = rolesData.roles.find((r) => r.id === selectedRole) || rolesData.roles[0];
                const isSuper = selectedRole === "super_admin";
                const activeCount = isSuper
                  ? rolesData.catalog.reduce((acc, cat) => acc + cat.permissions.length, 0)
                  : (rolePermsState[selectedRole] || []).length;
                const totalCount = rolesData.catalog.reduce((acc, cat) => acc + cat.permissions.length, 0);

                return (
                  <Card className="p-4 bg-[var(--axon-card)] border-[var(--axon-border)]">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[var(--axon-border)]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-bold text-[var(--axon-text)]">{curRoleDef.name} Permissions</h2>
                          <span className="rounded-full bg-[var(--axon-primary)]/15 border border-[var(--axon-primary)]/30 px-2 py-0.5 text-[10px] font-semibold text-[var(--axon-primary)]">
                            {activeCount} of {totalCount} features enabled
                          </span>
                          {isSuper && (
                            <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-bold text-purple-400">
                              Locked Root
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--axon-muted)]">
                          {curRoleDef.description}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          placeholder="Filter permissions…"
                          value={permSearch}
                          onChange={(e) => setPermSearch(e.target.value)}
                          className="field text-xs w-44"
                        />
                        {!isSuper && rolesData.canEdit && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSelectAll(selectedRole)}
                              className="text-xs"
                            >
                              Select All
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeselectAll(selectedRole)}
                              className="text-xs"
                            >
                              Deselect All
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {hasUnsavedChanges && !isSuper && (
                      <div className="mt-3 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex justify-between items-center">
                        <span className="flex items-center gap-2">
                          <span>⚠️</span>
                          <span>You have unsaved changes for <strong>{curRoleDef.name}</strong>.</span>
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            onClick={() => handleSavePermissions(selectedRole)}
                            disabled={savingRole}
                            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs"
                          >
                            {savingRole ? "Saving…" : "Save Now"}
                          </Button>
                        </div>
                      </div>
                    )}

                    {!rolesData.canEdit && (
                      <div className="mt-3 p-2.5 rounded-lg border border-slate-700 bg-slate-800/50 text-slate-400 text-xs flex items-center gap-2">
                        <span>ℹ️</span>
                        <span>Permissions are displayed in view-only mode. Only <strong>Super Admin</strong> can reconfigure role privileges.</span>
                      </div>
                    )}
                  </Card>
                );
              })()}

              {/* Categorized Permissions Grid */}
              <div className="space-y-6">
                {rolesData.catalog.map((group) => {
                  const isServerTelemetryCategory = group.category.includes("Server Details");
                  const activeRolePerms = rolePermsState[selectedRole] || [];
                  const isSuper = selectedRole === "super_admin";

                  const filteredItems = group.permissions.filter((p) => {
                    if (!permSearch) return true;
                    const q = permSearch.toLowerCase();
                    return p.label.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
                  });

                  if (filteredItems.length === 0) return null;

                  return (
                    <Card
                      key={group.category}
                      className={`overflow-hidden border transition-all ${
                        isServerTelemetryCategory
                          ? "border-cyan-500/30 bg-gradient-to-b from-cyan-950/10 to-[var(--axon-card)] shadow-xs"
                          : "border-[var(--axon-border)] bg-[var(--axon-card)]"
                      }`}
                    >
                      <div className={`p-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                        isServerTelemetryCategory
                          ? "border-cyan-500/20 bg-cyan-950/20"
                          : "border-[var(--axon-border)] bg-[var(--axon-sidebar)]"
                      }`}>
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-xs text-[var(--axon-text)] uppercase tracking-wider flex items-center gap-1.5">
                              {isServerTelemetryCategory && <span>📡</span>}
                              <span>{group.category}</span>
                            </h3>
                            {isServerTelemetryCategory && (
                              <span className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[9px] font-bold text-cyan-400 uppercase tracking-wider">
                                Server Telemetry & Visibility
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-[var(--axon-muted)] mt-0.5">
                            {group.description}
                          </p>
                        </div>
                      </div>

                      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                        {filteredItems.map((item) => {
                          const isChecked = isSuper ? true : activeRolePerms.includes(item.id);
                          const isDisabled = isSuper || !rolesData.canEdit;

                          return (
                            <label
                              key={item.id}
                              className={`flex items-start gap-3 p-3.5 rounded-xl border transition-all select-none cursor-pointer ${
                                isChecked
                                  ? item.isServerDetail
                                    ? "border-cyan-500/40 bg-cyan-500/10 shadow-xs"
                                    : "border-[var(--axon-primary)]/40 bg-[var(--axon-primary)]/5 shadow-xs"
                                  : "border-[var(--axon-border)] bg-[var(--axon-card)]/40 opacity-70 hover:opacity-100 hover:border-[var(--axon-border)]/80"
                              } ${isDisabled ? "cursor-default" : ""}`}
                              onClick={(e) => {
                                if (isDisabled) {
                                  e.preventDefault();
                                  return;
                                }
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                disabled={isDisabled}
                                onChange={() => handleTogglePermission(selectedRole, item.id)}
                                className="mt-0.5 h-4 w-4 rounded border-[var(--axon-border)] text-[var(--axon-primary)] focus:ring-[var(--axon-primary)] shrink-0 cursor-pointer disabled:opacity-50"
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="font-semibold text-xs text-[var(--axon-text)]">{item.label}</span>
                                  {item.isServerDetail && (
                                    <span className="rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 px-1.5 py-0.2 text-[9px] font-semibold">
                                      Telemetry
                                    </span>
                                  )}
                                  <span className="font-mono text-[9px] text-[var(--axon-muted)] bg-[var(--axon-sidebar)] px-1.5 py-0.5 rounded border border-[var(--axon-border)]">
                                    {item.id}
                                  </span>
                                </div>
                                <p className="text-[11px] text-[var(--axon-muted)] leading-relaxed">
                                  {item.description}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Add User Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-[var(--axon-text)]">Create New Account</h2>
              <button onClick={() => setIsAddOpen(false)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <form onSubmit={handleAddSubmit} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Username *</label>
                <input
                  required
                  className="field text-xs w-full"
                  placeholder="e.g. acme_admin"
                  value={addForm.username}
                  onChange={(e) => setAddForm({ ...addForm, username: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Email Address *</label>
                <input
                  required
                  type="email"
                  className="field text-xs w-full"
                  placeholder="user@example.com"
                  value={addForm.email}
                  onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
                />
              </div>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-medium text-[var(--axon-muted)]">Initial Password *</label>
                  <button
                    type="button"
                    onClick={() => setAddForm({ ...addForm, password: generatePassword() })}
                    className="text-[10px] text-[var(--axon-primary)] hover:underline"
                  >
                    Generate Strong
                  </button>
                </div>
                <input
                  required
                  type="text"
                  value={addForm.password}
                  onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
                  className="field font-mono text-xs w-full"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Role *</label>
                  <select
                    className="field text-xs w-full"
                    value={addForm.role}
                    onChange={(e) => setAddForm({ ...addForm, role: e.target.value })}
                  >
                    <option value="customer">Customer</option>
                    <option value="developer">Developer</option>
                    <option value="reseller">Reseller</option>
                    <option value="server_admin">Server Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Hosting Plan</label>
                  <select
                    className="field text-xs w-full"
                    value={addForm.planId}
                    onChange={(e) => setAddForm({ ...addForm, planId: e.target.value })}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.max_websites} sites)
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Workspace / Org Name (optional)</label>
                <input
                  className="field text-xs w-full"
                  placeholder="e.g. Acme Corporation"
                  value={addForm.orgName}
                  onChange={(e) => setAddForm({ ...addForm, orgName: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submittingAdd} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold">
                  {submittingAdd ? <Spinner /> : "Create Account"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Edit User Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-md p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-[var(--axon-text)]">Edit @{editingUser.username}</h2>
              <button onClick={() => setEditingUser(null)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <form onSubmit={handleEditSubmit} className="space-y-4 pt-4 text-xs">
              <div>
                <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Email</label>
                <input
                  required
                  type="email"
                  className="field text-xs w-full"
                  value={editForm.email}
                  onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Role</label>
                  <select
                    className="field text-xs w-full"
                    value={editForm.role}
                    onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                  >
                    <option value="customer">Customer</option>
                    <option value="developer">Developer</option>
                    <option value="reseller">Reseller</option>
                    <option value="server_admin">Server Admin</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Status</label>
                  <select
                    className="field text-xs w-full"
                    value={editForm.status}
                    onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[var(--axon-muted)] mb-1">Hosting Plan</label>
                <select
                  className="field text-xs w-full"
                  value={editForm.planId}
                  onChange={(e) => setEditForm({ ...editForm, planId: e.target.value })}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.max_websites} sites, {p.max_databases} dbs)
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submittingEdit} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold">
                  {submittingEdit ? <Spinner /> : "Save Changes"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Reset Password Modal */}
      {resettingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-4 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-[var(--axon-text)]">Reset Password</h2>
              <button onClick={() => setResettingUser(null)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <form onSubmit={handleResetPassword} className="space-y-4 pt-4 text-xs">
              <p className="text-[var(--axon-muted)]">
                Set a new password for <span className="font-semibold text-[var(--axon-text)]">@{resettingUser.username}</span>:
              </p>
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-medium text-[var(--axon-muted)]">New Password</label>
                  <button
                    type="button"
                    onClick={() => setNewPassword(generatePassword())}
                    className="text-[10px] text-[var(--axon-primary)] hover:underline"
                  >
                    Generate Strong
                  </button>
                </div>
                <input
                  required
                  type="text"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="field font-mono text-xs w-full"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setResettingUser(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submittingReset} className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold">
                  {submittingReset ? <Spinner /> : "Update Password"}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Delete User Modal */}
      {deletingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <Card className="w-full max-w-sm p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[var(--axon-border)]">
              <h2 className="text-sm font-bold text-rose-400">Delete Account</h2>
              <button onClick={() => setDeletingUser(null)} className="text-[var(--axon-muted)] hover:text-[var(--axon-text)]">✕</button>
            </div>
            <div className="pt-4 text-xs space-y-3">
              <p className="text-[var(--axon-text)]">
                Are you sure you want to permanently delete account <span className="font-bold text-rose-400">@{deletingUser.username}</span>?
              </p>
              <p className="text-[var(--axon-muted)] text-[11px]">
                This user will immediately lose access to the Axon Panel.
              </p>
              <div className="flex justify-end gap-2 pt-4 border-t border-[var(--axon-border)]">
                <Button type="button" variant="outline" onClick={() => setDeletingUser(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleDeleteSubmit}
                  disabled={submittingDelete}
                  className="bg-rose-600 hover:bg-rose-500 text-white font-semibold"
                >
                  {submittingDelete ? <Spinner /> : "Confirm Delete"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
