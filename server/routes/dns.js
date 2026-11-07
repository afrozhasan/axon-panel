import { Router } from "express";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { assertDomain } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { run } from "../lib/exec.js";
import { CONFIG_DIR } from "../config.js";

const router = Router();
const DNS_DIR = path.join(CONFIG_DIR, "dns");
const ZONES_FILE = path.join(DNS_DIR, "zones.json");

export function getServerIps() {
  let ipv4 = process.env.SERVER_IPV4 || "";
  let ipv6 = process.env.SERVER_IPV6 || "";
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.internal) continue;
        if (net.family === "IPv4" && !ipv4) {
          ipv4 = net.address;
        } else if (net.family === "IPv6" && !ipv6 && !net.scopeid) {
          ipv6 = net.address;
        }
      }
    }
  } catch {
    // Best effort detection
  }
  return {
    ipv4: ipv4 || "127.0.0.1",
    ipv6: ipv6 || "::1",
  };
}

function loadZones() {
  if (!existsSync(DNS_DIR)) mkdirSync(DNS_DIR, { recursive: true, mode: 0o700 });
  if (!existsSync(ZONES_FILE)) {
    writeFileSync(ZONES_FILE, JSON.stringify({ zones: [] }, null, 2), "utf8");
    return [];
  }
  try {
    const data = JSON.parse(readFileSync(ZONES_FILE, "utf8"));
    return Array.isArray(data.zones) ? data.zones : [];
  } catch {
    return [];
  }
}

function saveZones(zones) {
  if (!existsSync(DNS_DIR)) mkdirSync(DNS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(ZONES_FILE, JSON.stringify({ zones, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

router.get("/server-ips", (_req, res) => {
  const serverIps = getServerIps();
  res.json(serverIps);
});

router.get("/zones", (_req, res) => {
  const zones = loadZones();
  const serverIps = getServerIps();
  res.json({
    zones: zones.map((z) => ({
      domain: z.domain,
      recordsCount: (z.records ?? []).length,
      createdAt: z.createdAt,
      updatedAt: z.updatedAt,
    })),
    serverIps,
  });
});

router.get("/zones/:domain", (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const zones = loadZones();
  const zone = zones.find((z) => z.domain === domain);
  if (!zone) return res.status(404).json({ error: "Zone not found" });
  res.json({ zone, serverIps: getServerIps() });
});

router.post("/zones", (req, res, next) => {
  try {
    const rawDomain = req.body.domain;
    const domain = assertDomain(rawDomain).toLowerCase();
    const zones = loadZones();

    if (zones.some((z) => z.domain === domain)) {
      return res.status(400).json({ error: `Zone for ${domain} already exists` });
    }

    const { ipv4, ipv6 } = getServerIps();
    const defaultRecords = [
      { id: randomUUID(), type: "A", name: "@", value: ipv4, ttl: 3600 },
      { id: randomUUID(), type: "AAAA", name: "@", value: ipv6, ttl: 3600 },
      { id: randomUUID(), type: "CNAME", name: "www", value: domain, ttl: 3600 },
      { id: randomUUID(), type: "A", name: "mail", value: ipv4, ttl: 3600 },
      { id: randomUUID(), type: "MX", name: "@", value: `mail.${domain}`, priority: 10, ttl: 3600 },
      { id: randomUUID(), type: "TXT", name: "@", value: "v=spf1 a mx ~all", ttl: 3600 },
      { id: randomUUID(), type: "A", name: "panel", value: ipv4, ttl: 3600 },
    ];

    const newZone = {
      domain,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      records: defaultRecords,
    };

    zones.push(newZone);
    saveZones(zones);

    audit({ action: "dns.zone.create", actor: req.actor?.username, ip: clientIp(req), params: { domain }, result: "ok" });
    res.status(201).json({ zone: newZone });
  } catch (error) {
    next(error);
  }
});

router.delete("/zones/:domain", (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase();
    let zones = loadZones();
    const beforeCount = zones.length;
    zones = zones.filter((z) => z.domain !== domain);

    if (zones.length === beforeCount) {
      return res.status(404).json({ error: "Zone not found" });
    }

    saveZones(zones);
    audit({ action: "dns.zone.delete", actor: req.actor?.username, ip: clientIp(req), params: { domain }, result: "ok" });
    res.json({ ok: true, message: `Zone ${domain} deleted` });
  } catch (error) {
    next(error);
  }
});

router.post("/zones/:domain/records", (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase();
    const { type, name, value, ttl, priority } = req.body ?? {};

    if (!type || !["A", "AAAA", "CNAME", "TXT", "MX", "NS", "SRV", "CAA"].includes(type.toUpperCase())) {
      return res.status(400).json({ error: "Invalid DNS record type" });
    }
    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Record name is required" });
    }
    if (!value || typeof value !== "string") {
      return res.status(400).json({ error: "Record value is required" });
    }

    const zones = loadZones();
    const zone = zones.find((z) => z.domain === domain);
    if (!zone) return res.status(404).json({ error: "Zone not found" });

    const newRecord = {
      id: randomUUID(),
      type: type.toUpperCase(),
      name: name.trim(),
      value: value.trim(),
      ttl: Number(ttl) || 3600,
      priority: type.toUpperCase() === "MX" ? Number(priority) || 10 : undefined,
    };

    zone.records = zone.records || [];
    zone.records.push(newRecord);
    zone.updatedAt = new Date().toISOString();
    saveZones(zones);

    audit({ action: "dns.record.add", actor: req.actor?.username, ip: clientIp(req), params: { domain, record: newRecord }, result: "ok" });
    res.status(201).json({ record: newRecord, zone });
  } catch (error) {
    next(error);
  }
});

router.put("/zones/:domain/records/:id", (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase();
    const { id } = req.params;
    const { type, name, value, ttl, priority } = req.body ?? {};

    const zones = loadZones();
    const zone = zones.find((z) => z.domain === domain);
    if (!zone) return res.status(404).json({ error: "Zone not found" });

    const recordIndex = (zone.records || []).findIndex((r) => r.id === id);
    if (recordIndex === -1) return res.status(404).json({ error: "Record not found" });

    zone.records[recordIndex] = {
      ...zone.records[recordIndex],
      type: type ? type.toUpperCase() : zone.records[recordIndex].type,
      name: name !== undefined ? name.trim() : zone.records[recordIndex].name,
      value: value !== undefined ? value.trim() : zone.records[recordIndex].value,
      ttl: ttl !== undefined ? Number(ttl) || 3600 : zone.records[recordIndex].ttl,
      priority: priority !== undefined ? Number(priority) : zone.records[recordIndex].priority,
    };

    zone.updatedAt = new Date().toISOString();
    saveZones(zones);

    audit({ action: "dns.record.edit", actor: req.actor?.username, ip: clientIp(req), params: { domain, id }, result: "ok" });
    res.json({ record: zone.records[recordIndex], zone });
  } catch (error) {
    next(error);
  }
});

router.delete("/zones/:domain/records/:id", (req, res, next) => {
  try {
    const domain = req.params.domain.toLowerCase();
    const { id } = req.params;

    const zones = loadZones();
    const zone = zones.find((z) => z.domain === domain);
    if (!zone) return res.status(404).json({ error: "Zone not found" });

    const beforeLen = (zone.records || []).length;
    zone.records = (zone.records || []).filter((r) => r.id !== id);

    if (zone.records.length === beforeLen) {
      return res.status(404).json({ error: "Record not found" });
    }

    zone.updatedAt = new Date().toISOString();
    saveZones(zones);

    audit({ action: "dns.record.delete", actor: req.actor?.username, ip: clientIp(req), params: { domain, id }, result: "ok" });
    res.json({ ok: true, zone });
  } catch (error) {
    next(error);
  }
});

router.get("/zones/:domain/export-bind", (req, res) => {
  const domain = req.params.domain.toLowerCase();
  const zones = loadZones();
  const zone = zones.find((z) => z.domain === domain);
  if (!zone) return res.status(404).json({ error: "Zone not found" });

  const serial = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 10) + "01";
  let bind = `; Zone file for ${domain}\n; Exported from ServerPanel\n`;
  bind += `$ORIGIN ${domain}.\n$TTL 3600\n\n`;
  bind += `@ IN SOA ns1.${domain}. hostmaster.${domain}. (\n`;
  bind += `    ${serial} ; serial\n`;
  bind += `    3600       ; refresh\n`;
  bind += `    1800       ; retry\n`;
  bind += `    604800     ; expire\n`;
  bind += `    86400      ; minimum\n)\n\n`;

  for (const r of zone.records || []) {
    const name = r.name === "@" ? `${domain}.` : `${r.name}.${domain}.`;
    if (r.type === "MX") {
      bind += `${name.padEnd(30)} ${String(r.ttl || 3600).padEnd(6)} IN MX ${r.priority || 10} ${r.value}.\n`;
    } else if (r.type === "CNAME") {
      bind += `${name.padEnd(30)} ${String(r.ttl || 3600).padEnd(6)} IN CNAME ${r.value.endsWith(".") ? r.value : r.value + "."}\n`;
    } else if (r.type === "TXT") {
      bind += `${name.padEnd(30)} ${String(r.ttl || 3600).padEnd(6)} IN TXT "${r.value.replace(/"/g, '\\"')}"\n`;
    } else {
      bind += `${name.padEnd(30)} ${String(r.ttl || 3600).padEnd(6)} IN ${r.type} ${r.value}\n`;
    }
  }

  res.type("text/plain").send(bind);
});

export default router;
