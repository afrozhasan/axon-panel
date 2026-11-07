import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";
import { readSite, writeSiteValidated, reloadNginx, NGINX_AVAILABLE } from "./nginx.js";
import { assertDomain, assertSiteName } from "./validate.js";
import { run } from "./exec.js";
import { audit } from "./audit.js";
import { loadConfig } from "../config.js";

export function addDomainToNginx(content, primaryDomain, newDomain) {
  let matched = false;
  let updated = content.replace(/(server_name\s+)([^;]+)(;)/g, (match, prefix, namesStr, suffix) => {
    const names = namesStr.trim().split(/\s+/).filter(Boolean);
    if (names.includes(primaryDomain)) {
      matched = true;
      if (!names.includes(newDomain)) {
        names.push(newDomain);
      }
      return `${prefix}${names.join(" ")}${suffix}`;
    }
    return match;
  });

  // If primaryDomain wasn't matched explicitly, append to the first server_name found
  if (!matched) {
    updated = updated.replace(/(server_name\s+)([^;]+)(;)/, (match, prefix, namesStr, suffix) => {
      const names = namesStr.trim().split(/\s+/).filter(Boolean);
      if (!names.includes(newDomain)) names.push(newDomain);
      return `${prefix}${names.join(" ")}${suffix}`;
    });
  }

  return updated;
}

export function addRedirectToNginx(content, domain, targetUrl, redirectCode = 301, docroot = "/var/www") {
  // First clean any prior managed redirect block for this domain
  let updated = removeDomainFromNginx(content, domain);

  const block = `
# [axon-domain-redirect:${domain}]
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location ^~ /.well-known/acme-challenge/ {
        root ${docroot};
        allow all;
    }

    location / {
        return ${redirectCode} ${targetUrl};
    }
}
# [/axon-domain-redirect:${domain}]
`;

  return `${updated.trimEnd()}\n${block}\n`;
}

export function removeDomainFromNginx(content, domainToRemove) {
  // 1. Remove from all server_name directives
  let updated = content.replace(/(server_name\s+)([^;]+)(;)/g, (match, prefix, namesStr, suffix) => {
    let names = namesStr.trim().split(/\s+/).filter(Boolean);
    names = names.filter((n) => n !== domainToRemove);
    if (names.length === 0) names.push("_");
    return `${prefix}${names.join(" ")}${suffix}`;
  });

  // 2. Remove any managed redirect blocks
  const redirectRe = new RegExp(
    `\\n?\\s*# \\[axon-domain-redirect:${domainToRemove.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][\\s\\S]*?# \\[/axon-domain-redirect:${domainToRemove.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\n?`,
    "g",
  );
  updated = updated.replace(redirectRe, "\n");

  return updated;
}

export function promotePrimaryDomainInNginx(content, oldPrimary, newPrimary) {
  return content.replace(/(server_name\s+)([^;]+)(;)/g, (match, prefix, namesStr, suffix) => {
    let names = namesStr.trim().split(/\s+/).filter(Boolean);
    if (names.includes(newPrimary)) {
      names = [newPrimary, ...names.filter((n) => n !== newPrimary)];
      return `${prefix}${names.join(" ")}${suffix}`;
    }
    return match;
  });
}

export function getWebsiteByName(siteName) {
  const name = assertSiteName(siteName);
  const db = getDb();
  let site = db.prepare("SELECT * FROM websites WHERE name = ?").get(name);
  if (!site) {
    // If site exists in Nginx but not yet in SQLite, ensure it is registered
    const availPath = path.join(NGINX_AVAILABLE, name);
    if (existsSync(availPath)) {
      const siteId = `site_${randomBytes(6).toString("hex")}`;
      db.prepare(`
        INSERT OR IGNORE INTO websites (id, organization_id, name, primary_domain, app_type, document_root)
        VALUES (?, 'org_default', ?, ?, 'standard', ?)
      `).run(siteId, name, name, path.join("/var/www", name));
      site = db.prepare("SELECT * FROM websites WHERE name = ?").get(name);
    }
  }
  if (!site) {
    const error = new Error(`Website not found: ${name}`);
    error.status = 404;
    throw error;
  }
  return site;
}

export function listDomainsForWebsite(siteName) {
  const site = getWebsiteByName(siteName);
  const db = getDb();

  let domains = db.prepare("SELECT * FROM domains WHERE website_id = ? ORDER BY is_primary DESC, created_at ASC").all(site.id);

  // If no domains found in DB, auto-populate from Nginx config
  if (domains.length === 0) {
    const availPath = path.join(NGINX_AVAILABLE, site.name);
    if (existsSync(availPath)) {
      const content = readFileSync(availPath, "utf8");
      const serverNames = [...content.matchAll(/server_name\s+([^;]+);/g)]
        .flatMap((m) => m[1].trim().split(/\s+/))
        .filter((d) => d && !d.startsWith("_") && !d.startsWith("$"));
      const uniqueNames = [...new Set(serverNames)];
      const hasSsl = content.includes("ssl_certificate") ? 1 : 0;

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO domains (id, website_id, domain, is_primary, domain_type, routing_type, ssl_active)
        VALUES (?, ?, ?, ?, ?, 'direct', ?)
      `);

      for (const d of uniqueNames) {
        const isPrimary = d === site.primary_domain || (uniqueNames[0] === d && !uniqueNames.includes(site.primary_domain)) ? 1 : 0;
        const isSub = d.endsWith(`.${site.primary_domain}`) || d.startsWith("*.");
        const dType = isPrimary ? "primary" : isSub ? "subdomain" : "alias";
        insertStmt.run(`dom_${randomBytes(6).toString("hex")}`, site.id, d, isPrimary, dType, hasSsl);
      }
      domains = db.prepare("SELECT * FROM domains WHERE website_id = ? ORDER BY is_primary DESC, created_at ASC").all(site.id);
    }
  }

  return domains;
}

export function listAllDomains(orgId, role) {
  const db = getDb();
  if (role === "super_admin" || role === "server_admin") {
    return db.prepare(`
      SELECT d.*, w.name as website_name, w.app_type, w.organization_id
      FROM domains d
      JOIN websites w ON d.website_id = w.id
      ORDER BY w.name ASC, d.is_primary DESC, d.domain ASC
    `).all();
  }
  return db.prepare(`
    SELECT d.*, w.name as website_name, w.app_type, w.organization_id
    FROM domains d
    JOIN websites w ON d.website_id = w.id
    WHERE w.organization_id = ?
    ORDER BY w.name ASC, d.is_primary DESC, d.domain ASC
  `).all(orgId || "org_default");
}

export async function addDomainToWebsite(siteName, options, actor = "system", ip = "127.0.0.1") {
  const site = getWebsiteByName(siteName);
  const domainRaw = assertDomain(options.domain, { allowWildcard: true });
  const routingType = options.routingType === "redirect" ? "redirect" : "direct";
  const redirectCode = Number(options.redirectCode) === 302 ? 302 : 301;
  const targetUrl = options.targetUrl ? String(options.targetUrl).trim() : `https://${site.primary_domain}$request_uri`;

  // Determine domain type (subdomain or alias)
  let domainType = options.domainType;
  if (domainType !== "subdomain" && domainType !== "alias") {
    const isSub = domainRaw.endsWith(`.${site.primary_domain}`) || domainRaw.startsWith("*.");
    domainType = isSub ? "subdomain" : "alias";
  }

  const db = getDb();
  // Prevent duplicate domain across the entire server
  const existing = db.prepare(`
    SELECT d.*, w.name as site_name
    FROM domains d
    JOIN websites w ON d.website_id = w.id
    WHERE d.domain = ?
  `).get(domainRaw);

  if (existing) {
    if (existing.website_id === site.id) {
      const err = new Error(`Domain "${domainRaw}" is already attached to this website.`);
      err.status = 400;
      throw err;
    }
    const err = new Error(`Domain "${domainRaw}" is already in use by website "${existing.site_name}".`);
    err.status = 409;
    throw err;
  }

  // Load existing Nginx config
  const siteFile = readSite(site.name);
  let updatedContent = siteFile.content;

  if (routingType === "direct") {
    updatedContent = addDomainToNginx(updatedContent, site.primary_domain, domainRaw);
  } else {
    updatedContent = addRedirectToNginx(updatedContent, domainRaw, targetUrl, redirectCode, site.document_root);
  }

  // Validate and write to Nginx
  const writeRes = await writeSiteValidated(site.name, updatedContent);
  if (!writeRes.ok) {
    audit({
      action: "site.domain.add",
      actor,
      ip,
      params: { site: site.name, domain: domainRaw, domainType, routingType },
      result: "error",
      detail: writeRes.error,
    });
    const err = new Error(`Nginx rejected the updated configuration:\n${writeRes.error}`);
    err.status = 400;
    throw err;
  }

  // Reload Nginx
  await reloadNginx();

  // Save to SQLite
  const domainId = `dom_${randomBytes(6).toString("hex")}`;
  db.prepare(`
    INSERT INTO domains (id, website_id, domain, is_primary, domain_type, routing_type, target_url, ssl_active)
    VALUES (?, ?, ?, 0, ?, ?, ?, 0)
  `).run(domainId, site.id, domainRaw, domainType, routingType, routingType === "redirect" ? targetUrl : null);

  let sslResult = null;
  if (options.issueSsl && !domainRaw.startsWith("*.")) {
    try {
      const config = loadConfig();
      const email = config.letsencryptEmail || "admin@localhost";
      const certArgs = [
        "--nginx",
        "-d",
        domainRaw,
        "--non-interactive",
        "--agree-tos",
        "-m",
        email,
        "--keep-until-expiring",
        "--expand",
      ];
      const res = await run("certbot", certArgs, { timeout: 180000 });
      if (res.ok) {
        db.prepare("UPDATE domains SET ssl_active = 1 WHERE id = ?").run(domainId);
        sslResult = { ok: true };
      } else {
        sslResult = { ok: false, error: (res.stderr || res.stdout || "").trim() };
      }
    } catch (sslErr) {
      sslResult = { ok: false, error: sslErr.message };
    }
  }

  audit({
    action: "site.domain.add",
    actor,
    ip,
    params: { site: site.name, domain: domainRaw, domainType, routingType, targetUrl },
    result: "ok",
  });

  return {
    ...db.prepare("SELECT * FROM domains WHERE id = ?").get(domainId),
    sslResult,
  };
}

export async function updateDomain(siteName, domainName, updates, actor = "system", ip = "127.0.0.1") {
  const site = getWebsiteByName(siteName);
  const targetDomain = assertDomain(domainName, { allowWildcard: true });
  const db = getDb();

  const domain = db.prepare("SELECT * FROM domains WHERE website_id = ? AND domain = ?").get(site.id, targetDomain);
  if (!domain) {
    const err = new Error(`Domain "${targetDomain}" not found for website "${site.name}".`);
    err.status = 404;
    throw err;
  }

  const siteFile = readSite(site.name);
  let updatedContent = siteFile.content;
  let reloaded = false;

  // 1. Promote to primary domain
  if (updates.isPrimary === true && !domain.is_primary) {
    const oldPrimary = site.primary_domain;
    db.prepare("UPDATE websites SET primary_domain = ? WHERE id = ?").run(targetDomain, site.id);
    db.prepare("UPDATE domains SET is_primary = 0, domain_type = 'alias' WHERE website_id = ? AND is_primary = 1").run(site.id);
    db.prepare("UPDATE domains SET is_primary = 1, domain_type = 'primary', routing_type = 'direct', target_url = NULL WHERE id = ?").run(domain.id);

    // If it was a redirect, remove redirect block and put into direct server_name
    if (domain.routing_type === "redirect") {
      updatedContent = removeDomainFromNginx(updatedContent, targetDomain);
      updatedContent = addDomainToNginx(updatedContent, oldPrimary, targetDomain);
    }

    updatedContent = promotePrimaryDomainInNginx(updatedContent, oldPrimary, targetDomain);
    const writeRes = await writeSiteValidated(site.name, updatedContent);
    if (!writeRes.ok) throw new Error(`Nginx failed to promote primary domain: ${writeRes.error}`);
    await reloadNginx();
    reloaded = true;
  }

  // 2. Change routing type or target URL (only for non-primary domains)
  if (!domain.is_primary && (updates.routingType || updates.targetUrl)) {
    const newRouting = updates.routingType ?? domain.routing_type;
    const targetUrl = updates.targetUrl ? String(updates.targetUrl).trim() : `https://${site.primary_domain}$request_uri`;
    const redirectCode = Number(updates.redirectCode) === 302 ? 302 : 301;

    if (newRouting === "redirect") {
      updatedContent = removeDomainFromNginx(updatedContent, targetDomain);
      updatedContent = addRedirectToNginx(updatedContent, targetDomain, targetUrl, redirectCode, site.document_root);
    } else {
      updatedContent = removeDomainFromNginx(updatedContent, targetDomain);
      updatedContent = addDomainToNginx(updatedContent, site.primary_domain, targetDomain);
    }

    const writeRes = await writeSiteValidated(site.name, updatedContent);
    if (!writeRes.ok) throw new Error(`Nginx failed to update routing: ${writeRes.error}`);
    await reloadNginx();
    reloaded = true;

    db.prepare("UPDATE domains SET routing_type = ?, target_url = ? WHERE id = ?").run(
      newRouting,
      newRouting === "redirect" ? targetUrl : null,
      domain.id,
    );
  }

  // 3. Change domain type tag (subdomain vs alias)
  if (!domain.is_primary && updates.domainType && (updates.domainType === "subdomain" || updates.domainType === "alias")) {
    db.prepare("UPDATE domains SET domain_type = ? WHERE id = ?").run(updates.domainType, domain.id);
  }

  audit({
    action: "site.domain.update",
    actor,
    ip,
    params: { site: site.name, domain: targetDomain, updates },
    result: "ok",
  });

  return {
    ...db.prepare("SELECT * FROM domains WHERE id = ?").get(domain.id),
    reloaded,
  };
}

export async function deleteDomain(siteName, domainName, actor = "system", ip = "127.0.0.1") {
  const site = getWebsiteByName(siteName);
  const targetDomain = assertDomain(domainName, { allowWildcard: true });
  const db = getDb();

  const domain = db.prepare("SELECT * FROM domains WHERE website_id = ? AND domain = ?").get(site.id, targetDomain);
  if (!domain) {
    const err = new Error(`Domain "${targetDomain}" not found for website "${site.name}".`);
    err.status = 404;
    throw err;
  }

  if (domain.is_primary) {
    const err = new Error("Cannot delete the primary domain. Promote another domain to primary first.");
    err.status = 400;
    throw err;
  }

  // Remove from Nginx
  const siteFile = readSite(site.name);
  const updatedContent = removeDomainFromNginx(siteFile.content, targetDomain);

  const writeRes = await writeSiteValidated(site.name, updatedContent);
  if (!writeRes.ok) {
    throw new Error(`Nginx rejected removing domain "${targetDomain}":\n${writeRes.error}`);
  }

  await reloadNginx();

  // Delete from SQLite
  db.prepare("DELETE FROM domains WHERE id = ?").run(domain.id);

  audit({
    action: "site.domain.delete",
    actor,
    ip,
    params: { site: site.name, domain: targetDomain },
    result: "ok",
  });

  return { ok: true, domain: targetDomain };
}

export async function issueDomainSsl(siteName, domainName, actor = "system", ip = "127.0.0.1") {
  const site = getWebsiteByName(siteName);
  const targetDomain = assertDomain(domainName, { allowWildcard: true });
  const db = getDb();

  const domain = db.prepare("SELECT * FROM domains WHERE website_id = ? AND domain = ?").get(site.id, targetDomain);
  if (!domain) {
    const err = new Error(`Domain "${targetDomain}" not found for website "${site.name}".`);
    err.status = 404;
    throw err;
  }

  const config = loadConfig();
  const email = config.letsencryptEmail || "admin@localhost";
  const certArgs = [
    "--nginx",
    "-d",
    targetDomain,
    "--non-interactive",
    "--agree-tos",
    "-m",
    email,
    "--keep-until-expiring",
    "--expand",
  ];

  const res = await run("certbot", certArgs, { timeout: 180000 });
  if (!res.ok) {
    const errorMsg = (res.stderr || res.stdout || "").trim();
    audit({
      action: "site.domain.ssl",
      actor,
      ip,
      params: { site: site.name, domain: targetDomain },
      result: "error",
      detail: errorMsg,
    });
    const err = new Error(`Certbot SSL issuance failed:\n${errorMsg}`);
    err.status = 500;
    throw err;
  }

  db.prepare("UPDATE domains SET ssl_active = 1 WHERE id = ?").run(domain.id);
  await reloadNginx();

  audit({
    action: "site.domain.ssl",
    actor,
    ip,
    params: { site: site.name, domain: targetDomain },
    result: "ok",
  });

  return { ok: true, output: (res.stdout || "").trim() };
}
