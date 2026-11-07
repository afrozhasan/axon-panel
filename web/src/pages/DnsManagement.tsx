import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Badge, Button, Card, Spinner, useAsyncAction, useToast } from "../components/ui";

type DnsRecord = {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  priority?: number;
};

type DnsZone = {
  domain: string;
  createdAt: string;
  updatedAt: string;
  records: DnsRecord[];
};

type ZoneSummary = {
  domain: string;
  recordsCount: number;
  createdAt: string;
  updatedAt: string;
};

export default function DnsManagement() {
  const [zones, setZones] = useState<ZoneSummary[]>([]);
  const [serverIps, setServerIps] = useState<{ ipv4: string; ipv6: string }>({
    ipv4: typeof window !== "undefined" ? window.location.hostname : "",
    ipv6: "",
  });
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null);
  const [activeZone, setActiveZone] = useState<DnsZone | null>(null);

  // Modals & form state
  const [showAddZone, setShowAddZone] = useState(false);
  const [newDomain, setNewDomain] = useState("");

  const [showAddRecord, setShowAddRecord] = useState(false);
  const [recordType, setRecordType] = useState("A");
  const [recordName, setRecordName] = useState("@");
  const [recordValue, setRecordValue] = useState("");
  const [recordTtl, setRecordTtl] = useState(3600);
  const [recordPriority, setRecordPriority] = useState(10);

  const [exportBind, setExportBind] = useState<string | null>(null);

  const { busy, run } = useAsyncAction();
  const toast = useToast();

  const loadZones = async () => {
    try {
      const res = await api.get<{ zones: ZoneSummary[]; serverIps: { ipv4: string; ipv6: string } }>("/dns/zones");
      setZones(res.zones);
      setServerIps(res.serverIps);
      if (res.zones.length > 0 && !selectedDomain) {
        setSelectedDomain(res.zones[0].domain);
      }
    } catch (e: any) {
      toast("error", e.message || "Failed to load DNS zones");
    }
  };

  const loadZoneDetails = async (domain: string) => {
    try {
      const res = await api.get<{ zone: DnsZone }>(`/dns/zones/${domain}`);
      setActiveZone(res.zone);
    } catch (e: any) {
      toast("error", e.message || "Failed to load zone details");
    }
  };

  useEffect(() => {
    loadZones();
  }, []);

  useEffect(() => {
    if (selectedDomain) {
      loadZoneDetails(selectedDomain);
      setExportBind(null);
    }
  }, [selectedDomain]);

  const handleCreateZone = () => {
    if (!newDomain.trim()) return;
    run(async () => {
      await api.post("/dns/zones", { domain: newDomain.trim() });
      setShowAddZone(false);
      const createdDomain = newDomain.trim();
      setNewDomain("");
      await loadZones();
      setSelectedDomain(createdDomain);
    }, `DNS Zone created for ${newDomain}`);
  };

  const handleDeleteZone = (domain: string) => {
    if (!confirm(`Are you sure you want to delete the DNS zone for ${domain}?`)) return;
    run(async () => {
      await api.delete(`/dns/zones/${domain}`);
      if (selectedDomain === domain) setSelectedDomain(null);
      await loadZones();
    }, `Zone ${domain} deleted`);
  };

  const handleAddRecord = () => {
    if (!selectedDomain || !recordValue.trim()) return;
    run(async () => {
      await api.post(`/dns/zones/${selectedDomain}/records`, {
        type: recordType,
        name: recordName.trim(),
        value: recordValue.trim(),
        ttl: recordTtl,
        priority: recordType === "MX" ? recordPriority : undefined,
      });
      setShowAddRecord(false);
      setRecordName("@");
      setRecordValue("");
      await loadZoneDetails(selectedDomain);
    }, `DNS record added`);
  };

  const handleDeleteRecord = (id: string) => {
    if (!selectedDomain) return;
    run(async () => {
      await api.delete(`/dns/zones/${selectedDomain}/records/${id}`);
      await loadZoneDetails(selectedDomain);
    }, "DNS record removed");
  };

  const handleExportBind = async () => {
    if (!selectedDomain) return;
    try {
      const bind = await api.getText(`/dns/zones/${selectedDomain}/export-bind`);
      setExportBind(bind);
    } catch (e: any) {
      toast("error", e.message || "Failed to export zone");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--axon-border)] pb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <span className="text-2xl">🗺️</span> DNS Zone & Record Management
          </h1>
          <p className="mt-1 text-xs text-slate-400">
            Configure A, CNAME, MX, TXT and mail records. Easily export standard RFC BIND zone files for Cloudflare, Route53, or Namecheap.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={() => setShowAddZone(true)}>
            + Add DNS Zone
          </Button>
        </div>
      </div>

      {/* Server IP Info Banner */}
      <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600/30 text-indigo-300 font-bold text-sm">
              IP
            </div>
            <div>
              <p className="text-xs font-semibold text-indigo-200">Server Public Addresses</p>
              <div className="flex flex-wrap gap-4 mt-0.5 text-xs">
                <span className="text-slate-300">
                  IPv4: <strong className="font-mono text-emerald-400">{serverIps.ipv4}</strong>
                </span>
                {serverIps.ipv6 && (
                  <span className="text-slate-300">
                    IPv6: <strong className="font-mono text-emerald-400">{serverIps.ipv6}</strong>
                  </span>
                )}
              </div>
            </div>
          </div>
          <p className="text-[11px] text-slate-400 max-w-sm">
            Pointing your domain's A record to <span className="font-mono text-slate-200">{serverIps.ipv4}</span> routes traffic directly to Nginx.
          </p>
        </div>
      </div>

      {/* Main Content: Zones List + Active Zone Details */}
      <div className="grid gap-6 lg:grid-cols-4">
        {/* Left: Zones List */}
        <div className="lg:col-span-1 space-y-3">
          <Card title="Managed Zones" subtitle={`${zones.length} active zones`}>
            {zones.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500">
                No DNS zones yet. Click "+ Add DNS Zone" to create one.
              </div>
            ) : (
              <div className="space-y-1">
                {zones.map((z) => (
                  <div
                    key={z.domain}
                    onClick={() => setSelectedDomain(z.domain)}
                    className={`flex cursor-pointer items-center justify-between rounded-lg px-3 py-2.5 text-xs transition-colors ${
                      selectedDomain === z.domain
                        ? "bg-indigo-600/20 border border-indigo-500/40 text-indigo-200 font-medium"
                        : "text-slate-300 hover:bg-[var(--axon-card-hover)]"
                    }`}
                  >
                    <span className="truncate">{z.domain}</span>
                    <Badge tone="neutral">{z.recordsCount} recs</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right: Zone Details & Records Table */}
        <div className="lg:col-span-3 space-y-4">
          {activeZone ? (
            <Card
              title={`DNS Records for ${activeZone.domain}`}
              subtitle="All records associated with this zone"
              actions={
                <div className="flex items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={handleExportBind}>
                    Export BIND File
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => setShowAddRecord(true)}>
                    + Add Record
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleDeleteZone(activeZone.domain)}
                    disabled={busy}
                  >
                    Delete Zone
                  </Button>
                </div>
              }
            >
              {/* Export BIND View */}
              {exportBind && (
                <div className="mb-4 rounded-lg border border-[var(--axon-border)] bg-[var(--axon-input-bg)] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300">BIND RFC 1035 Zone Format</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(exportBind);
                        toast("ok", "Zone copied to clipboard");
                      }}
                    >
                      Copy to Clipboard
                    </Button>
                  </div>
                  <pre className="mono text-[11px] text-slate-300 max-h-48 overflow-y-auto p-2 bg-[#05070c] rounded">
                    {exportBind}
                  </pre>
                </div>
              )}

              {/* Records Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--axon-border)] text-slate-400">
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Value / Content</th>
                      <th className="pb-2 font-medium">TTL</th>
                      <th className="pb-2 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1f2839]/60">
                    {(activeZone.records || []).map((r) => (
                      <tr key={r.id} className="hover:bg-slate-900/40">
                        <td className="py-2.5 font-bold">
                          <span
                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              r.type === "A"
                                ? "bg-blue-500/20 text-blue-300"
                                : r.type === "CNAME"
                                  ? "bg-purple-500/20 text-purple-300"
                                  : r.type === "MX"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : r.type === "TXT"
                                      ? "bg-emerald-500/20 text-emerald-300"
                                      : "bg-slate-500/20 text-slate-300"
                            }`}
                          >
                            {r.type}
                          </span>
                        </td>
                        <td className="py-2.5 font-mono text-slate-200">{r.name}</td>
                        <td className="py-2.5 font-mono text-slate-300 truncate max-w-[280px]">
                          {r.priority !== undefined ? `[Pri ${r.priority}] ` : ""}
                          {r.value}
                        </td>
                        <td className="py-2.5 text-slate-400">{r.ttl}s</td>
                        <td className="py-2.5 text-right">
                          <button
                            onClick={() => handleDeleteRecord(r.id)}
                            className="text-rose-400 hover:text-rose-300 text-xs transition-colors"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <div className="rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-12 text-center text-xs text-slate-500">
              Select or create a DNS zone on the left to manage records.
            </div>
          )}
        </div>
      </div>

      {/* Add Zone Modal */}
      {showAddZone && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100">Add New DNS Zone</h3>
            <p className="mt-1 text-xs text-slate-400">
              Automatically creates recommended default A, AAAA, CNAME, MX, and SPF TXT records pointing to this server.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Domain Name</label>
                <input
                  type="text"
                  placeholder="example.com"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-3 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAddZone(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleCreateZone} disabled={!newDomain.trim() || busy}>
                Create Zone
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Record Modal */}
      {showAddRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--axon-border)] bg-[var(--axon-card)] p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-100">Add DNS Record to {selectedDomain}</h3>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Record Type</label>
                  <select
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value)}
                    className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  >
                    <option value="A">A (IPv4)</option>
                    <option value="AAAA">AAAA (IPv6)</option>
                    <option value="CNAME">CNAME (Alias)</option>
                    <option value="TXT">TXT (Text)</option>
                    <option value="MX">MX (Mail Exchange)</option>
                    <option value="NS">NS (Name Server)</option>
                    <option value="CAA">CAA (Certificate Authority)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-400 mb-1 font-medium">Host / Name</label>
                  <input
                    type="text"
                    value={recordName}
                    onChange={(e) => setRecordName(e.target.value)}
                    placeholder="@ or sub"
                    className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Value / Target</label>
                <input
                  type="text"
                  value={recordValue}
                  onChange={(e) => setRecordValue(e.target.value)}
                  placeholder={recordType === "A" ? serverIps.ipv4 : "Target address or text"}
                  className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1 font-medium">TTL (Seconds)</label>
                  <input
                    type="number"
                    value={recordTtl}
                    onChange={(e) => setRecordTtl(Number(e.target.value))}
                    className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 focus:outline-none"
                  />
                </div>
                {recordType === "MX" && (
                  <div>
                    <label className="block text-slate-400 mb-1 font-medium">Priority</label>
                    <input
                      type="number"
                      value={recordPriority}
                      onChange={(e) => setRecordPriority(Number(e.target.value))}
                      className="w-full rounded-md border border-[var(--axon-border)] bg-[var(--axon-input-bg)] px-2.5 py-1.5 text-slate-200 focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setShowAddRecord(false)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleAddRecord} disabled={!recordValue.trim() || busy}>
                Add Record
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
