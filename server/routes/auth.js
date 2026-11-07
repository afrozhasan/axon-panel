import { Router } from "express";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { loadConfig, saveConfig, publicConfig } from "../config.js";
import { audit } from "../lib/audit.js";
import { generateSecret, verifyCode, otpauthUri } from "../lib/totp.js";
import { getDb } from "../lib/db.js";
import { getRolePermissions } from "../lib/rbac.js";
import {
  COOKIE_NAME,
  signSession,
  verifySession,
  requireAuth,
  requireCsrf,
  loginLimiter,
  clientIp,
  checkLockout,
  recordFailure,
  clearFailures,
  sessionCookieOptions,
} from "../middleware/auth.js";

const router = Router();
const MIN_PASSWORD_LENGTH = 12;

router.post("/login", loginLimiter, requireCsrf, async (req, res) => {
  const ip = clientIp(req);
  const lock = checkLockout(ip);
  if (lock.locked) {
    audit({ action: "auth.login.locked", actor: "unknown", ip, result: "denied" });
    return res.status(429).json({
      error: `Too many failed attempts. Try again in ${Math.ceil(lock.retryAfterMs / 60000)} minute(s).`,
    });
  }

  const { username, password, totp } = req.body ?? {};
  const candidate = typeof password === "string" && password.length > 0 ? password : "invalid-placeholder";
  const userCandidate = typeof username === "string" ? username.trim() : "";

  const db = getDb();
  let dbUser = null;
  try {
    dbUser = db.prepare("SELECT * FROM users WHERE username = ? LIMIT 1").get(userCandidate);
  } catch {
    /* fallback to config if db query fails */
  }

  const cfg = loadConfig();

  // If found in SQLite
  if (dbUser) {
    if (dbUser.status !== "active") {
      return res.status(403).json({ error: "Your account has been suspended or is inactive" });
    }

    const passwordOk = await bcrypt.compare(candidate, dbUser.password_hash);
    if (!passwordOk) {
      const record = recordFailure(ip);
      audit({ action: "auth.login.failed", actor: userCandidate, ip, result: "denied" });
      return res.status(401).json({
        error: "Invalid username or password",
        attemptsRemaining: Math.max(0, 5 - record.count),
      });
    }

    if (dbUser.totp_enabled && dbUser.totp_secret) {
      if (!totp) {
        return res.status(401).json({ error: "Two-factor code required", totpRequired: true });
      }
      if (!verifyCode(dbUser.totp_secret, String(totp))) {
        recordFailure(ip);
        audit({ action: "auth.login.totp-failed", actor: userCandidate, ip, result: "denied" });
        return res.status(401).json({ error: "Invalid two-factor code", totpRequired: true });
      }
    }

    clearFailures(ip);
    try {
      db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(dbUser.id);
    } catch {
      /* ignore */
    }

    const actor = {
      id: dbUser.id,
      username: dbUser.username,
      role: dbUser.role || "super_admin",
      orgId: dbUser.organization_id || "org_default",
      permissions: getRolePermissions(dbUser.role || "super_admin"),
    };

    res.cookie(COOKIE_NAME, signSession(actor), sessionCookieOptions());
    audit({ action: "auth.login", actor: dbUser.username, ip });
    return res.json({ ok: true, user: actor, config: publicConfig() });
  }

  // Fallback to config.json
  if (!cfg.passwordHash) {
    return res.status(503).json({ error: "Panel is not initialised yet. Run install.sh to set an admin password." });
  }

  const usernameOk = userCandidate === cfg.adminUser;
  const passwordOk = await bcrypt.compare(candidate, cfg.passwordHash);

  if (!usernameOk || !passwordOk) {
    const record = recordFailure(ip);
    audit({ action: "auth.login.failed", actor: String(username || "unknown").slice(0, 64), ip, result: "denied" });
    return res.status(401).json({
      error: "Invalid username or password",
      attemptsRemaining: Math.max(0, 5 - record.count),
    });
  }

  if (cfg.totpEnabled && cfg.totpSecret) {
    if (!totp) {
      return res.status(401).json({ error: "Two-factor code required", totpRequired: true });
    }
    if (!verifyCode(cfg.totpSecret, String(totp))) {
      recordFailure(ip);
      audit({ action: "auth.login.totp-failed", actor: cfg.adminUser, ip, result: "denied" });
      return res.status(401).json({ error: "Invalid two-factor code", totpRequired: true });
    }
  }

  clearFailures(ip);
  const actor = { username: cfg.adminUser, role: "super_admin", orgId: "org_default" };
  res.cookie(COOKIE_NAME, signSession(actor), sessionCookieOptions());
  audit({ action: "auth.login", actor: cfg.adminUser, ip });
  return res.json({ ok: true, user: actor, config: publicConfig() });
});

router.post("/logout", requireAuth, requireCsrf, (req, res) => {
  res.clearCookie(COOKIE_NAME, { ...sessionCookieOptions(), maxAge: 0 });
  audit({ action: "auth.logout", actor: req.actor.username, ip: clientIp(req) });
  res.json({ ok: true });
});

router.get("/session", (req, res) => {
  const token = req.cookies?.[COOKIE_NAME];
  const actor = token ? verifySession(token) : null;
  if (!actor) return res.json({ authenticated: false });

  // Refresh role and org from DB if available
  try {
    const db = getDb();
    const user = db.prepare("SELECT id, username, role, organization_id, status FROM users WHERE username = ?").get(actor.username);
    if (user) {
      actor.id = user.id;
      actor.role = user.role;
      actor.orgId = user.organization_id;
    }
  } catch {
    /* fallback to token actor */
  }

  actor.permissions = getRolePermissions(actor.role);

  return res.json({ authenticated: true, user: actor, config: publicConfig() });
});

router.post("/password", requireAuth, requireCsrf, async (req, res) => {
  const { current, next } = req.body ?? {};
  const cfg = loadConfig();
  const db = getDb();

  let user = null;
  try {
    user = db.prepare("SELECT * FROM users WHERE username = ?").get(req.actor.username);
  } catch {
    /* ignore */
  }

  const hashToCheck = user ? user.password_hash : cfg.passwordHash;
  const currentOk = typeof current === "string" && current.length > 0 && (await bcrypt.compare(current, hashToCheck));
  if (!currentOk) {
    audit({ action: "auth.password.change", actor: req.actor.username, ip: clientIp(req), result: "denied" });
    return res.status(403).json({ error: "Current password is incorrect" });
  }
  if (typeof next !== "string" || next.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  const newHash = await bcrypt.hash(next, 12);
  try {
    db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(newHash, req.actor.username);
  } catch {
    /* ignore */
  }

  if (req.actor.username === cfg.adminUser) {
    saveConfig({ passwordHash: newHash });
  }

  audit({ action: "auth.password.change", actor: req.actor.username, ip: clientIp(req) });
  res.json({ ok: true });
});

router.post("/2fa/setup", requireAuth, requireCsrf, async (req, res) => {
  const cfg = loadConfig();
  const secret = generateSecret();
  const db = getDb();

  try {
    db.prepare("UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE username = ?").run(secret, req.actor.username);
  } catch {
    /* ignore */
  }

  if (req.actor.username === cfg.adminUser) {
    saveConfig({ totpSecret: secret, totpEnabled: false });
  }

  audit({ action: "auth.2fa.setup-started", actor: req.actor.username, ip: clientIp(req) });
  const uri = otpauthUri({ secret, account: req.actor.username, issuer: "Axon Panel" });
  let qrCode = null;
  try {
    qrCode = await QRCode.toDataURL(uri, {
      margin: 2,
      width: 200,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });
  } catch (err) {
    console.error("Failed to generate QR code:", err);
  }
  res.json({ secret, uri, qrCode });
});

router.post("/2fa/enable", requireAuth, requireCsrf, (req, res) => {
  const cfg = loadConfig();
  const { token } = req.body ?? {};
  const db = getDb();

  let secret = cfg.totpSecret;
  try {
    const user = db.prepare("SELECT totp_secret FROM users WHERE username = ?").get(req.actor.username);
    if (user?.totp_secret) secret = user.totp_secret;
  } catch {
    /* ignore */
  }

  if (!secret) return res.status(400).json({ error: "Start setup first" });
  if (!verifyCode(secret, String(token ?? ""))) {
    return res.status(400).json({ error: "That code is not valid. Check your authenticator and try again." });
  }

  try {
    db.prepare("UPDATE users SET totp_enabled = 1 WHERE username = ?").run(req.actor.username);
  } catch {
    /* ignore */
  }

  if (req.actor.username === cfg.adminUser) {
    saveConfig({ totpEnabled: true });
  }

  audit({ action: "auth.2fa.enabled", actor: req.actor.username, ip: clientIp(req) });
  res.json({ ok: true });
});

router.post("/2fa/disable", requireAuth, requireCsrf, async (req, res) => {
  const cfg = loadConfig();
  const { password } = req.body ?? {};
  const db = getDb();

  let hash = cfg.passwordHash;
  try {
    const user = db.prepare("SELECT password_hash FROM users WHERE username = ?").get(req.actor.username);
    if (user?.password_hash) hash = user.password_hash;
  } catch {
    /* ignore */
  }

  const ok = typeof password === "string" && password.length > 0 && (await bcrypt.compare(password, hash));
  if (!ok) return res.status(403).json({ error: "Password is incorrect" });

  try {
    db.prepare("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE username = ?").run(req.actor.username);
  } catch {
    /* ignore */
  }

  if (req.actor.username === cfg.adminUser) {
    saveConfig({ totpSecret: null, totpEnabled: false });
  }

  audit({ action: "auth.2fa.disabled", actor: req.actor.username, ip: clientIp(req) });
  res.json({ ok: true });
});

export default router;
