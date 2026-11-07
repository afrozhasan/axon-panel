import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { PanelConfig } from "../lib/app-context";
import { Button, ErrorBanner, Field } from "../components/ui";

export default function Login({
  onAuthenticated,
}: {
  onAuthenticated: (user: { username: string; role: string }, config: PanelConfig) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ user: { username: string; role: string }; config: PanelConfig }>("/auth/login", {
        username,
        password,
        totp: totp || undefined,
      });
      onAuthenticated(result.user, result.config);
    } catch (caught) {
      const message = errorMessage(caught);
      setError(message);
      if (/two-factor/i.test(message)) setNeedsTotp(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 via-blue-500 to-indigo-600 text-sm font-black text-white shadow-md shadow-blue-500/20">
            AP
          </div>
          <div>
            <h1 className="text-base font-semibold text-[var(--axon-text)]">Axon Panel</h1>
            <p className="text-[11px] text-[var(--axon-muted)]">Sign in to manage this server</p>
          </div>
        </div>

        <ErrorBanner message={error} />

        <div className="space-y-3">
          <Field label="Username">
            <input
              className="field"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
            />
          </Field>

          <Field label="Password">
            <input
              className="field"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </Field>

          {needsTotp && (
            <Field label="Two-factor code" hint="6-digit code from your authenticator app">
              <input
                className="field mono tracking-[0.3em]"
                value={totp}
                onChange={(event) => setTotp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                autoFocus
              />
            </Field>
          )}
        </div>

        <Button type="submit" variant="primary" loading={busy} className="mt-5 w-full justify-center">
          Sign in
        </Button>

        <p className="mt-4 text-center text-[11px] text-slate-600">
          Access is logged. Failed attempts are rate limited and locked out.
        </p>
      </form>
    </div>
  );
}
