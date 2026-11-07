import { run } from "./exec.js";

export function parseCertificates(stdout) {
  const certificates = [];
  let current = null;

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const nameMatch = line.match(/^Certificate Name:\s*(.+)$/);
    if (nameMatch) {
      if (current) certificates.push(current);
      current = { name: nameMatch[1].trim(), domains: [], expiry: null, daysRemaining: null, certPath: null, keyPath: null, serial: null, keyType: null };
      continue;
    }
    if (!current) continue;

    const domains = line.match(/^Domains:\s*(.+)$/);
    if (domains) {
      current.domains = domains[1].trim().split(/\s+/).filter(Boolean);
      continue;
    }

    const expiry = line.match(/^Expiry Date:\s*(\S+ \S+)\s*\(VALID:\s*(\d+)\s*day/);
    if (expiry) {
      current.expiry = expiry[1];
      current.daysRemaining = Number(expiry[2]);
      continue;
    }

    const certPath = line.match(/^Certificate Path:\s*(.+)$/);
    if (certPath) {
      current.certPath = certPath[1].trim();
      continue;
    }

    const keyPath = line.match(/^Private Key Path:\s*(.+)$/);
    if (keyPath) {
      current.keyPath = keyPath[1].trim();
      continue;
    }

    const serial = line.match(/^Serial Number:\s*(.+)$/);
    if (serial) {
      current.serial = serial[1].trim();
      continue;
    }

    const keyType = line.match(/^Key Type:\s*(.+)$/);
    if (keyType) {
      current.keyType = keyType[1].trim();
    }
  }

  if (current) certificates.push(current);
  return certificates;
}

export async function listCertificates() {
  const result = await run("certbot", ["certificates"], { timeout: 60000 });
  if (!result.ok) {
    return { ok: false, error: (result.stderr || result.stdout || "certbot failed").trim(), certificates: [] };
  }
  return { ok: true, certificates: parseCertificates(result.stdout) };
}
