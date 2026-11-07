import { useState } from "react";
import { Link } from "react-router-dom";
import { Button, Card } from "../components/ui";
import Breadcrumbs from "../components/Breadcrumbs";

export default function Support() {
  const [copiedDns, setCopiedDns] = useState(false);
  const host = typeof window !== "undefined" ? window.location.hostname : "your-server-ip";

  const copyIp = () => {
    navigator.clipboard.writeText(host);
    setCopiedDns(true);
    setTimeout(() => setCopiedDns(false), 2000);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: "Support & Documentation" }]} />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)]">Customer Support & Knowledgebase</h1>
          <p className="text-xs text-[var(--axon-muted)] mt-1">
            Documentation, DNS configuration, and troubleshooting guides for your hosting account.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Guides */}
        <div className="md:col-span-2 space-y-6">
          <Card title="Quick Configuration Guide">
            <div className="space-y-4 text-xs">
              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm text-[var(--axon-text)]">1. Pointing Your Domain</span>
                  <Button variant="ghost" onClick={copyIp}>
                    {copiedDns ? "Copied!" : "Copy Server IP"}
                  </Button>
                </div>
                <p className="text-[var(--axon-muted)]">
                  Log in to your domain registrar (Namecheap, GoDaddy, Cloudflare, etc.) and create an <strong>A Record</strong> pointing to:
                </p>
                <div className="p-2 rounded bg-[var(--axon-card)] border border-[var(--axon-border)] font-mono text-[var(--axon-primary)]">
                  Host: @ &nbsp;|&nbsp; Value: {host} &nbsp;|&nbsp; TTL: Automatic
                </div>
              </div>

              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3.5 space-y-2">
                <span className="font-semibold text-sm text-[var(--axon-text)]">2. Requesting Free SSL / HTTPS</span>
                <p className="text-[var(--axon-muted)]">
                  Once your DNS record resolves to the server, navigate to <Link to="/ssl" className="text-[var(--axon-primary)] hover:underline font-semibold">SSL Certificates</Link> and click <strong>Issue Certificate</strong>. Let's Encrypt will verify ownership and automatically configure HTTPS.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3.5 space-y-2">
                <span className="font-semibold text-sm text-[var(--axon-text)]">3. Database Credentials</span>
                <p className="text-[var(--axon-muted)]">
                  Create dedicated MariaDB or PostgreSQL databases from the <Link to="/databases" className="text-[var(--axon-primary)] hover:underline font-semibold">Databases</Link> page. All databases connect locally via host <code className="font-mono text-[var(--axon-text)]">127.0.0.1:3306</code> or <code className="font-mono text-[var(--axon-text)]">127.0.0.1:5432</code>.
                </p>
              </div>

              <div className="rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3.5 space-y-2">
                <span className="font-semibold text-sm text-[var(--axon-text)]">4. WordPress Management</span>
                <p className="text-[var(--axon-muted)]">
                  Use the integrated <Link to="/wordpress" className="text-[var(--axon-primary)] hover:underline font-semibold">WordPress Toolkit Pro</Link> to run instant security audits, clear FastCGI disk cache, optimize bloated database tables, and convert media into modern WebP format.
                </p>
              </div>
            </div>
          </Card>

          <Card title="Frequently Asked Questions">
            <div className="divide-y divide-[var(--axon-border)] text-xs">
              <div className="py-3">
                <p className="font-semibold text-[var(--axon-text)]">How do I upload website files?</p>
                <p className="text-[var(--axon-muted)] mt-1">
                  You can use the built-in web <Link to="/files" className="text-[var(--axon-primary)] hover:underline">File Manager</Link> with drag-and-drop upload support, or use Git integration under <Link to="/deployments" className="text-[var(--axon-primary)] hover:underline">Git Deployments</Link>.
                </p>
              </div>
              <div className="py-3">
                <p className="font-semibold text-[var(--axon-text)]">How do backup snapshots work?</p>
                <p className="text-[var(--axon-muted)] mt-1">
                  Your files and database dumps are backed up incrementally using Restic snapshot encryption under <Link to="/backups" className="text-[var(--axon-primary)] hover:underline">Backups</Link>. You can trigger on-demand backups anytime.
                </p>
              </div>
              <div className="py-3">
                <p className="font-semibold text-[var(--axon-text)]">What PHP versions are supported?</p>
                <p className="text-[var(--axon-muted)] mt-1">
                  The server supports PHP 8.1, 8.2, 8.3, and 8.4 via high-performance PHP-FPM sockets. You can switch versions per site inside each website's workspace.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card title="Help Desk Contact">
            <div className="space-y-3 text-xs">
              <p className="text-[var(--axon-muted)]">
                Need technical assistance or plan adjustments? Our infrastructure engineering team is here to assist.
              </p>
              <div className="p-3 rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] space-y-1">
                <p className="font-medium text-[var(--axon-text)]">Support Desk Email</p>
                <p className="font-mono text-[var(--axon-primary)]">support@axonpanel.com</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--axon-input-bg)] border border-[var(--axon-border)] space-y-1">
                <p className="font-medium text-[var(--axon-text)]">Target SLA Response</p>
                <p className="text-[var(--axon-text)] font-semibold">&lt; 15 minutes (Critical Incidents)</p>
              </div>
            </div>
          </Card>

          <Card title="Server Telemetry Status">
            <div className="space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
                <span className="text-[var(--axon-muted)]">Web Server</span>
                <span className="font-semibold text-emerald-400">Nginx 1.30 Operational</span>
              </div>
              <div className="flex justify-between py-1 border-b border-[var(--axon-border)]">
                <span className="text-[var(--axon-muted)]">Database Services</span>
                <span className="font-semibold text-emerald-400">MariaDB & Postgres Online</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-[var(--axon-muted)]">Firewall & Security</span>
                <span className="font-semibold text-emerald-400">Fail2Ban / UFW Active</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
