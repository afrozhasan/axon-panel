import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  useAsyncAction,
  useToast,
} from "../components/ui";

type Certificate = {
  name: string;
  domains: string[];
  expiry: string | null;
  daysRemaining: number | null;
  certPath: string | null;
  keyType: string | null;
};

type SslResponse = {
  ok: boolean;
  error: string | null;
  certificates: Certificate[];
  autoRenew: { active: boolean; schedule: string | null };
};

function expiryTone(days: number | null): "ok" | "warn" | "bad" | "neutral" {
  if (days === null) return "neutral";
  if (days <= 7) return "bad";
  if (days <= 30) return "warn";
  return "ok";
}

export default function Ssl() {
  const [data, setData] = useState<SslResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [issuing, setIssuing] = useState(false);
  const [domain, setDomain] = useState("");
  const [email, setEmail] = useState("");
  const [includeWww, setIncludeWww] = useState(true);
  const [redirect, setRedirect] = useState(true);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);

  const { busy, error, run, setError } = useAsyncAction();
  const toast = useToast();

  const load = async () => {
    try {
      const result = await api.get<SslResponse>("/ssl");
      setData(result);
      if (!email) setEmail("");
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const issue = async (event: React.FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => {
      const result = await api.post<{ output: string }>("/ssl/issue", {
        domain: domain.trim(),
        email: email.trim() || undefined,
        includeWww,
        redirect,
      });
      setIssuing(false);
      setOutput({ title: `Issued certificate for ${domain}`, text: result.output });
      setDomain("");
      await load();
    }, "Certificate issued");
    if (!ok) return;
  };

  const renew = async (certName?: string, dryRun = false) => {
    await run(async () => {
      const result = await api.post<{ output: string }>("/ssl/renew", { certName, dryRun });
      setOutput({
        title: dryRun ? "Renewal dry run complete" : `Renewal complete${certName ? ` for ${certName}` : ""}`,
        text: result.output,
      });
      await load();
    }, dryRun ? "Dry run finished" : "Renewal finished");
  };

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-sm text-slate-400">
        <Spinner /> Loading certificates…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">SSL certificates</h1>
          <p className="text-xs text-slate-500">
            {data?.certificates.length ?? 0} certificates · Let&apos;s Encrypt via certbot
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={data?.autoRenew.active ? "ok" : "warn"}>
            auto-renew {data?.autoRenew.active ? "active" : "inactive"}
          </Badge>
          <Button onClick={() => renew(undefined, true)} loading={busy}>
            Dry run
          </Button>
          <Button onClick={() => renew()}>Renew all</Button>
          <Button variant="primary" onClick={() => { setIssuing(true); setError(null); }}>
            Issue certificate
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      <Card
        title="Issued certificates"
        subtitle={data?.error ?? "Expiry dates reported by certbot"}
        bodyClassName="p-0"
      >
        {data && data.certificates.length === 0 ? (
          <EmptyState message="No certificates found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="th">Name</th>
                  <th className="th">Domains</th>
                  <th className="th">Expires</th>
                  <th className="th">Remaining</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.certificates.map((cert) => (
                  <tr key={cert.name} className="hover:bg-[var(--axon-card-hover)] transition-colors">
                    <td className="td">
                      <span className="mono text-xs text-[var(--axon-text)]">{cert.name}</span>
                      <p className="text-[10px] text-[var(--axon-muted)]">{cert.keyType}</p>
                    </td>
                    <td className="td">
                      <p className="mono truncate text-[11px] text-[var(--axon-muted)]">{cert.domains.join(", ")}</p>
                    </td>
                    <td className="td text-[11px] text-[var(--axon-muted)]">{formatDate(cert.expiry)}</td>
                    <td className="td">
                      <Badge tone={expiryTone(cert.daysRemaining)}>
                        {cert.daysRemaining === null ? "unknown" : `${cert.daysRemaining} days`}
                      </Badge>
                    </td>
                    <td className="td">
                      <div className="flex justify-end gap-1.5">
                        <Button onClick={() => renew(cert.name)}>Renew</Button>
                        <Button variant="danger" onClick={() => setRevoking(cert)}>
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={issuing} title="Issue a Let's Encrypt certificate" onClose={() => setIssuing(false)}>
        <form onSubmit={issue} className="space-y-3">
          <ErrorBanner message={error} />
          <Field label="Domain" hint="The domain must already point at this server and have an nginx site">
            <input
              className="field mono"
              placeholder="example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Contact email" hint="Defaults to the address configured in Settings">
            <input
              className="field"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={includeWww} onChange={(event) => setIncludeWww(event.target.checked)} />
            Also include <span className="mono">www</span> subdomain
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input type="checkbox" checked={redirect} onChange={(event) => setRedirect(event.target.checked)} />
            Redirect HTTP traffic to HTTPS
          </label>
          <p className="text-[11px] text-slate-500">
            certbot will modify the nginx configuration for this domain to install the certificate.
          </p>
          <footer className="flex justify-end gap-2">
            <Button type="button" onClick={() => setIssuing(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!domain.trim()}>
              Issue certificate
            </Button>
          </footer>
        </form>
      </Modal>

      <Modal open={Boolean(output)} title={output?.title ?? ""} onClose={() => setOutput(null)} width="max-w-3xl">
        <pre className="mono max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-md bg-[var(--axon-input-bg)] p-3 text-[11px] text-slate-300">
          {output?.text || "No output"}
        </pre>
      </Modal>

      <ConfirmDialog
        open={Boolean(revoking)}
        title="Revoke certificate"
        message={
          <>
            Revoking <span className="mono text-amber-300">{revoking?.name}</span> immediately invalidates it. Browsers will show
            security warnings until a new certificate is issued. The certificate is also deleted from certbot.
          </>
        }
        requireText={revoking?.name}
        busy={busy}
        confirmLabel="Revoke"
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          const cert = revoking;
          setRevoking(null);
          if (!cert) return;
          await run(async () => {
            const result = await api.post<{ output: string }>("/ssl/revoke", { certName: cert.name, deleteAfter: true });
            setOutput({ title: `Revoked ${cert.name}`, text: result.output });
            await load();
          }, "Certificate revoked");
        }}
      />
    </div>
  );
}
