import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Badge, Button, ConfirmDialog, EmptyState, ErrorBanner, Field, Modal, Spinner, useToast } from "../ui";

export type WpUser = {
  ID: number | string;
  user_login: string;
  display_name: string;
  user_email: string;
  user_registered: string;
  roles: string;
};

const WP_ROLES = [
  { id: "administrator", label: "Administrator", desc: "Full administrative access" },
  { id: "editor", label: "Editor", desc: "Publish and manage all posts & pages" },
  { id: "author", label: "Author", desc: "Publish and manage own posts" },
  { id: "contributor", label: "Contributor", desc: "Write and manage own posts without publishing" },
  { id: "subscriber", label: "Subscriber", desc: "Manage profile only" },
];

function generateRandomPassword(length = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=";
  let pass = "";
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    pass += chars[array[i] % chars.length];
  }
  return pass;
}

function getRoleTone(roles: string): "ok" | "warn" | "bad" | "neutral" | "info" {
  const r = roles.toLowerCase();
  if (r.includes("administrator")) return "bad";
  if (r.includes("editor")) return "ok";
  if (r.includes("author")) return "warn";
  if (r.includes("contributor")) return "info";
  return "neutral";
}

export default function WpUsersTab({ siteName, docroot }: { siteName: string; docroot?: string }) {
  const [users, setUsers] = useState<WpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  // Create User Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("subscriber");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  // Edit User Modal
  const [editingUser, setEditingUser] = useState<WpUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editRole, setEditRole] = useState("subscriber");

  // Reset Password Modal
  const [passwordUser, setPasswordUser] = useState<WpUser | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Delete User Dialog
  const [deletingUser, setDeletingUser] = useState<WpUser | null>(null);
  const [reassignUserId, setReassignUserId] = useState<string>("");

  const toast = useToast();

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ users: WpUser[] }>(`/wp/${encodeURIComponent(siteName)}/users`);
      setUsers(res.users || []);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [siteName]);

  const handleOpenCreate = () => {
    setNewUsername("");
    setNewEmail("");
    setNewPassword(generateRandomPassword(16));
    setNewRole("subscriber");
    setNewDisplayName("");
    setShowNewPassword(false);
    setShowCreateModal(true);
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newEmail.trim()) {
      toast("error", "Username and email are required.");
      return;
    }
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/users/create`, {
        username: newUsername.trim(),
        email: newEmail.trim(),
        password: newPassword.trim(),
        role: newRole,
        displayName: newDisplayName.trim() || newUsername.trim(),
      });
      toast("ok", `WordPress user "${newUsername}" created successfully`);
      setShowCreateModal(false);
      await loadUsers();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenEdit = (user: WpUser) => {
    setEditingUser(user);
    setEditEmail(user.user_email || "");
    setEditDisplayName(user.display_name || user.user_login);
    setEditRole(user.roles || "subscriber");
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/users/update`, {
        id: editingUser.ID,
        email: editEmail.trim(),
        displayName: editDisplayName.trim(),
        role: editRole,
      });
      toast("ok", `User "${editingUser.user_login}" updated`);
      setEditingUser(null);
      await loadUsers();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenPassword = (user: WpUser) => {
    setPasswordUser(user);
    setResetPasswordVal(generateRandomPassword(16));
    setShowResetPassword(false);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordUser || !resetPasswordVal.trim()) return;
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/users/update`, {
        id: passwordUser.ID,
        password: resetPasswordVal.trim(),
      });
      toast("ok", `Password updated for "${passwordUser.user_login}"`);
      setPasswordUser(null);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDelete = (user: WpUser) => {
    setDeletingUser(user);
    // Find first other user to default reassignment, or none
    const otherUser = users.find((u) => String(u.ID) !== String(user.ID));
    setReassignUserId(otherUser ? String(otherUser.ID) : "");
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;
    setBusy(true);
    try {
      await api.post(`/wp/${encodeURIComponent(siteName)}/users/delete`, {
        id: deletingUser.ID,
        reassignId: reassignUserId ? Number(reassignUserId) : undefined,
      });
      toast("ok", `User "${deletingUser.user_login}" deleted successfully`);
      setDeletingUser(null);
      await loadUsers();
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.user_login.toLowerCase().includes(search.toLowerCase()) ||
      u.display_name.toLowerCase().includes(search.toLowerCase()) ||
      u.user_email.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === "all" || u.roles.toLowerCase().includes(roleFilter.toLowerCase());
    return matchesSearch && matchesRole;
  });

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-sm text-[var(--axon-muted)]">
        <Spinner className="h-6 w-6 mb-2" />
        Loading WordPress user accounts via WP-CLI...
      </div>
    );
  }

  const otherUsersForReassignment = deletingUser
    ? users.filter((u) => String(u.ID) !== String(deletingUser.ID))
    : [];

  return (
    <div className="space-y-4 pt-1">
      <ErrorBanner message={error} />

      {/* Control Header & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-b border-[var(--axon-border)] pb-3">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <input
              type="text"
              placeholder="Search users by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="field text-xs w-full py-1.5"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--axon-muted)] hover:text-[var(--axon-text)]"
              >
                ✕
              </button>
            )}
          </div>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="field text-xs py-1.5"
          >
            <option value="all">All Roles ({users.length})</option>
            {WP_ROLES.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} ({users.filter((u) => u.roles.toLowerCase().includes(r.id)).length})
              </option>
            ))}
          </select>

          <Button variant="ghost" onClick={loadUsers} loading={loading} className="text-xs py-1.5 px-2.5">
            ↻ Refresh
          </Button>
        </div>

        <Button variant="primary" onClick={handleOpenCreate} className="text-xs py-1.5 px-3 shrink-0">
          + Add New User
        </Button>
      </div>

      {/* User Accounts Table */}
      {filteredUsers.length === 0 ? (
        <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-8">
          <EmptyState
            title="No WordPress users found"
            description={
              search || roleFilter !== "all"
                ? "No users matched your search criteria."
                : "No WordPress users are currently registered on this site."
            }
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] shadow-xs">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--axon-border)] bg-[var(--axon-card-hover)] text-[10px] uppercase tracking-wider text-[var(--axon-muted)]">
                <th className="p-3">User</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Registered</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--axon-border)]">
              {filteredUsers.map((user) => (
                <tr key={user.ID} className="hover:bg-[var(--axon-card-hover)] transition">
                  <td className="p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--axon-primary)]/15 text-[var(--axon-primary)] font-bold text-xs uppercase border border-[var(--axon-primary)]/20 shrink-0">
                        {user.user_login.slice(0, 2)}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--axon-text)] flex items-center gap-1.5">
                          <span>{user.user_login}</span>
                          <span className="text-[10px] text-[var(--axon-muted)] font-mono">#{user.ID}</span>
                        </div>
                        {user.display_name && user.display_name !== user.user_login && (
                          <div className="text-[11px] text-[var(--axon-muted)] truncate">{user.display_name}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="p-3 font-mono text-[var(--axon-muted)]">{user.user_email}</td>
                  <td className="p-3">
                    <Badge tone={getRoleTone(user.roles)}>
                      {user.roles.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="p-3 text-[11px] text-[var(--axon-muted)]">
                    {user.user_registered ? user.user_registered.split(" ")[0] : "—"}
                  </td>
                  <td className="p-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        onClick={() => handleOpenEdit(user)}
                        className="text-[11px] py-1 px-2"
                        title="Edit profile & role"
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleOpenPassword(user)}
                        className="text-[11px] py-1 px-2 text-amber-400 hover:text-amber-300"
                        title="Reset password"
                      >
                        Password
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => handleOpenDelete(user)}
                        className="text-[11px] py-1 px-2"
                        title="Delete user"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Create User */}
      <Modal open={showCreateModal} title="Add New WordPress User" onClose={() => setShowCreateModal(false)} width="max-w-md">
        <form onSubmit={handleCreateUser} className="space-y-4">
          <Field label="Username" hint="Required. Lowercase alphanumeric and hyphens.">
            <input
              type="text"
              required
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder="e.g. john_doe"
              className="field w-full text-xs"
              autoFocus
            />
          </Field>

          <Field label="Email Address" hint="Required. WordPress notification and recovery email.">
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="john@example.com"
              className="field w-full text-xs"
            />
          </Field>

          <Field label="Display Name" hint="Optional. Defaults to username.">
            <input
              type="text"
              value={newDisplayName}
              onChange={(e) => setNewDisplayName(e.target.value)}
              placeholder="e.g. John Doe"
              className="field w-full text-xs"
            />
          </Field>

          <Field label="Role" hint="WordPress capability tier.">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="field w-full text-xs"
            >
              {WP_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.desc}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Password" hint="Strong password generated automatically.">
            <div className="flex gap-2">
              <input
                type={showNewPassword ? "text" : "password"}
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="field flex-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="btn btn-ghost text-xs px-2.5"
              >
                {showNewPassword ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                onClick={() => setNewPassword(generateRandomPassword(18))}
                className="btn btn-ghost text-xs px-2.5 text-[var(--axon-primary)]"
                title="Generate new strong password"
              >
                ↻ Gen
              </button>
            </div>
          </Field>

          <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button type="button" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Edit User */}
      <Modal
        open={!!editingUser}
        title={`Edit WordPress User: ${editingUser?.user_login || ""}`}
        onClose={() => setEditingUser(null)}
        width="max-w-md"
      >
        <form onSubmit={handleUpdateUser} className="space-y-4">
          <Field label="Username" hint="WordPress username cannot be changed.">
            <input
              type="text"
              disabled
              value={editingUser?.user_login || ""}
              className="field w-full text-xs opacity-60 cursor-not-allowed font-mono"
            />
          </Field>

          <Field label="Display Name">
            <input
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              className="field w-full text-xs"
            />
          </Field>

          <Field label="Email Address">
            <input
              type="email"
              required
              value={editEmail}
              onChange={(e) => setEditEmail(e.target.value)}
              className="field w-full text-xs"
            />
          </Field>

          <Field label="Role">
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              className="field w-full text-xs"
            >
              {WP_ROLES.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.desc}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button type="button" onClick={() => setEditingUser(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Reset Password */}
      <Modal
        open={!!passwordUser}
        title={`Reset Password: ${passwordUser?.user_login || ""}`}
        onClose={() => setPasswordUser(null)}
        width="max-w-md"
      >
        <form onSubmit={handleResetPassword} className="space-y-4">
          <p className="text-xs text-[var(--axon-muted)]">
            Update password for WordPress user <strong className="text-[var(--axon-text)]">{passwordUser?.user_login}</strong>. The user will be immediately required to use the new credentials.
          </p>

          <Field label="New Password">
            <div className="flex gap-2">
              <input
                type={showResetPassword ? "text" : "password"}
                required
                value={resetPasswordVal}
                onChange={(e) => setResetPasswordVal(e.target.value)}
                className="field flex-1 font-mono text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowResetPassword(!showResetPassword)}
                className="btn btn-ghost text-xs px-2.5"
              >
                {showResetPassword ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                onClick={() => setResetPasswordVal(generateRandomPassword(18))}
                className="btn btn-ghost text-xs px-2.5 text-[var(--axon-primary)]"
                title="Generate new strong password"
              >
                ↻ Gen
              </button>
            </div>
          </Field>

          <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button type="button" onClick={() => setPasswordUser(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy}>
              Update Password
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Delete User with Post Reassignment */}
      <Modal
        open={!!deletingUser}
        title="Delete WordPress User"
        onClose={() => setDeletingUser(null)}
        width="max-w-md"
      >
        <div className="space-y-4 text-xs">
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-rose-300">
            Are you sure you want to delete user <strong className="font-bold underline">{deletingUser?.user_login}</strong> (#{deletingUser?.ID})?
            {deletingUser?.roles.toLowerCase().includes("administrator") && (
              <div className="mt-1 font-semibold text-rose-400">
                Warning: This user holds the Administrator role!
              </div>
            )}
          </div>

          {otherUsersForReassignment.length > 0 ? (
            <Field
              label="Reassign Posts & Content To"
              hint="Select which user will inherit any posts or links authored by this user."
            >
              <select
                value={reassignUserId}
                onChange={(e) => setReassignUserId(e.target.value)}
                className="field w-full text-xs"
              >
                <option value="">Do not reassign (Delete all posts)</option>
                {otherUsersForReassignment.map((u) => (
                  <option key={u.ID} value={u.ID}>
                    #{u.ID} {u.user_login} ({u.display_name}) — {u.roles}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-[var(--axon-muted)]">
              No other users exist on this WordPress site. Any posts created by this user will be deleted permanently.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button onClick={() => setDeletingUser(null)}>Cancel</Button>
            <Button variant="danger" loading={busy} onClick={handleDeleteUser}>
              Confirm Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
