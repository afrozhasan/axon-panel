import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import { loadConfig } from "../config.js";

export const COOKIE_NAME = "axon_token";
const CSRF_HEADER = "x-requested-with";
const CSRF_VALUE = "axon-panel";
const VALID_CSRF = new Set(["axon-panel", "axonpanel", "webpanel"]);

const lockouts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 5 * 60 * 1000;

export const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again shortly." },
});

export function signSession(actor) {
  const { sessionHours } = loadConfig();
  return jwt.sign(actor, loadConfig().jwtSecret, { expiresIn: `${sessionHours}h` });
}

export function verifySession(token) {
  try {
    const actor = jwt.verify(token, loadConfig().jwtSecret);
    if (actor && actor.role === "admin") {
      actor.role = "super_admin";
    }
    return actor;
  } catch {
    return null;
  }
}

export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function checkLockout(ip) {
  const record = lockouts.get(ip);
  if (!record) return { locked: false };
  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return { locked: true, retryAfterMs: record.lockedUntil - Date.now() };
  }
  if (record.lockedUntil && record.lockedUntil <= Date.now()) {
    lockouts.delete(ip);
  }
  return { locked: false };
}

export function recordFailure(ip) {
  const now = Date.now();
  const record = lockouts.get(ip) || { count: 0, firstAt: now, lockedUntil: 0 };
  if (now - record.firstAt > ATTEMPT_WINDOW_MS) {
    record.count = 0;
    record.firstAt = now;
  }
  record.count += 1;
  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    record.count = 0;
    record.firstAt = now;
  }
  lockouts.set(ip, record);
  return record;
}

export function clearFailures(ip) {
  lockouts.delete(ip);
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.cookies?.axonpanel_token || req.cookies?.webpanel_token;
  const actor = token ? verifySession(token) : null;
  if (!actor) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.actor = actor;
  return next();
}

export function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const headerVal = req.get(CSRF_HEADER);
  if (!headerVal || !VALID_CSRF.has(headerVal)) {
    return res.status(403).json({ error: "Missing or invalid CSRF header" });
  }
  return next();
}

export function requireIpAllowlist(req, res, next) {
  const { ipAllowlist } = loadConfig();
  if (!ipAllowlist || ipAllowlist.length === 0) return next();
  const ip = clientIp(req).replace(/^::ffff:/, "");
  const permitted = ipAllowlist.some((entry) => entry === ip || entry === "*");
  if (!permitted) return res.status(403).json({ error: "Your IP address is not allowed" });
  return next();
}

export function sessionCookieOptions() {
  const { sessionHours } = loadConfig();
  return {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: sessionHours * 60 * 60 * 1000,
  };
}

export { CSRF_HEADER, CSRF_VALUE };
