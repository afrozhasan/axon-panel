import { Router } from "express";
import { listCertificates } from "../lib/certbot.js";
import { run } from "../lib/exec.js";
import { assertDomain, assertCertName } from "../lib/validate.js";
import { assertEmail } from "../lib/validate.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";

const router = Router();
const CERTBOT_TIMEOUT = 180000;

router.get("/", async (_req, res, next) => {
  try {
    const [certs, timerActive, timerList] = await Promise.all([
      listCertificates(),
      run("systemctl", ["is-active", "certbot.timer"], { timeout: 15000 }),
      run("systemctl", ["list-timers", "certbot.timer", "--no-pager", "--no-legend"], { timeout: 15000 }),
    ]);

    res.json({
      ok: certs.ok,
      error: certs.error,
      certificates: certs.certificates,
      autoRenew: {
        active: timerActive.stdout.trim() === "active",
        schedule: timerList.ok ? timerList.stdout.trim() : null,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post("/issue", async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const domain = assertDomain(body.domain);
    const config = loadConfig();
    const email = body.email ? assertEmail(body.email) : config.letsencryptEmail;
    const includeWww = body.includeWww !== false;

    const args = ["--nginx", "-d", domain];
    if (includeWww && !domain.startsWith("www.")) args.push("-d", `www.${domain}`);
    args.push(
      "--non-interactive",
      "--agree-tos",
      "-m",
      email,
      "--keep-until-expiring",
      "--expand",
    );
    if (body.redirect !== false) args.push("--redirect");

    const result = await run("certbot", args, { timeout: CERTBOT_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });

    audit({
      action: "ssl.issue",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { domain, includeWww, email },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : `${result.stdout}${result.stderr}`,
    });

    if (!result.ok) {
      return res.status(500).json({ error: extractCertbotError(result), output: `${result.stdout}${result.stderr}` });
    }
    return res.json({ ok: true, output: `${result.stdout}${result.stderr}`.trim() });
  } catch (error) {
    return next(error);
  }
});

router.post("/renew", async (req, res, next) => {
  try {
    const { certName, dryRun } = req.body ?? {};
    const args = ["renew", "--non-interactive"];
    if (certName) args.push("--cert-name", assertCertName(certName));
    if (dryRun) args.push("--dry-run");

    const result = await run("certbot", args, { timeout: CERTBOT_TIMEOUT, maxBuffer: 8 * 1024 * 1024 });
    audit({
      action: dryRun ? "ssl.renew.dry-run" : "ssl.renew",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { certName: certName ?? "all" },
      result: result.ok ? "ok" : "error",
      detail: result.ok ? null : `${result.stdout}${result.stderr}`,
    });

    if (!result.ok) return res.status(500).json({ error: extractCertbotError(result) });
    return res.json({ ok: true, output: `${result.stdout}${result.stderr}`.trim() });
  } catch (error) {
    return next(error);
  }
});

router.post("/revoke", async (req, res, next) => {
  try {
    const { certName, deleteAfter } = req.body ?? {};
    const name = assertCertName(certName);

    const revoke = await run("certbot", ["revoke", "--cert-name", name, "--non-interactive"], {
      timeout: CERTBOT_TIMEOUT,
      maxBuffer: 8 * 1024 * 1024,
    });

    let deletion = null;
    if (revoke.ok && deleteAfter) {
      deletion = await run("certbot", ["delete", "--cert-name", name, "--non-interactive"], {
        timeout: 60000,
        maxBuffer: 4 * 1024 * 1024,
      });
    }

    audit({
      action: "ssl.revoke",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { certName: name, deleteAfter: Boolean(deleteAfter) },
      result: revoke.ok ? "ok" : "error",
      detail: revoke.ok ? null : `${revoke.stdout}${revoke.stderr}`,
    });

    if (!revoke.ok) return res.status(500).json({ error: extractCertbotError(revoke) });
    return res.json({
      ok: true,
      deleted: Boolean(deletion?.ok),
      output: `${revoke.stdout}${revoke.stderr}`.trim(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/delete", async (req, res, next) => {
  try {
    const name = assertCertName(req.body?.certName);
    const result = await run("certbot", ["delete", "--cert-name", name, "--non-interactive"], {
      timeout: 60000,
      maxBuffer: 4 * 1024 * 1024,
    });
    audit({
      action: "ssl.delete",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { certName: name },
      result: result.ok ? "ok" : "error",
    });
    if (!result.ok) return res.status(500).json({ error: extractCertbotError(result) });
    return res.json({ ok: true, output: `${result.stdout}${result.stderr}`.trim() });
  } catch (error) {
    return next(error);
  }
});

function extractCertbotError(result) {
  const combined = `${result.stderr}\n${result.stdout}`.trim();
  const lines = combined
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("Saving debug log") && !l.startsWith("Requesting a certificate"));
  return lines.slice(-8).join("\n") || "certbot failed";
}

export default router;
