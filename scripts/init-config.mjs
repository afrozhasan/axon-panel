import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import bcrypt from "bcryptjs";
import { CONFIG_PATH, CONFIG_DIR, LOG_DIR, randomSecret } from "../server/config.js";

function flag(name, fallback) {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const resetPassword = process.argv.includes("--reset-password");
const domain = flag("--domain", process.env.PANEL_DOMAIN || process.env.AXONPANEL_DOMAIN || "localhost");
const email = flag("--email", process.env.LETSENCRYPT_EMAIL || "admin@localhost");
const port = Number(flag("--port", process.env.AXONPANEL_PORT || process.env.WEBPANEL_PORT || "9090"));

for (const dir of [CONFIG_DIR, LOG_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

const existed = existsSync(CONFIG_PATH);
const existing = existed ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};

let password = null;
const config = {
  host: "127.0.0.1",
  port,
  panelDomain: domain,
  letsencryptEmail: email,
  adminUser: "admin",
  sessionHours: 12,
  ipAllowlist: [],
  allowedRoots: ["/var/www", "/etc/nginx", "/etc/letsencrypt", "/root", "/var/log", "/etc/postgresql", "/etc/php", "/opt/axon-panel"],
  backupDir: "/var/backups/axon-panel",
  phpFpmSocket: "/var/run/php/php8.3-fpm.sock",
  maxUploadMb: 512,
  commandTimeoutMs: 120000,
  ...existing,
  panelDomain: domain,
  letsencryptEmail: email,
  port,
  host: "127.0.0.1",
};

if (!config.jwtSecret) config.jwtSecret = randomSecret(48);

if (!config.passwordHash || resetPassword) {
  password = randomBytes(15).toString("base64url");
  config.passwordHash = await bcrypt.hash(password, 12);
}

writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
chmodSync(CONFIG_PATH, 0o600);
mkdirSync(config.backupDir, { recursive: true, mode: 0o700 });

console.log(
  JSON.stringify({
    password,
    created: !existed,
    reset: Boolean(password),
    configPath: CONFIG_PATH,
    domain: config.panelDomain,
    port: config.port,
  }),
);
