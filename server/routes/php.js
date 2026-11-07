import { Router } from "express";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, lstatSync } from "node:fs";
import path from "node:path";
import { run } from "../lib/exec.js";
import { testConfig, reloadNginx, NGINX_AVAILABLE } from "../lib/nginx.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { unitStates } from "../lib/systemd.js";
import { loadConfig } from "../config.js";

const router = Router();
const AVAILABLE_VERSIONS = ["8.1", "8.2", "8.3", "8.4"];

export function isForbiddenPhpVersion(version) {
  if (!version || typeof version !== "string") return true;
  const trimmed = version.trim();
  const v = parseFloat(trimmed);
  return isNaN(v) || v < 8.1 || trimmed === "7.4" || trimmed.startsWith("7.") || trimmed.startsWith("5.");
}

export const PHP83_COMPONENTS = [
  "php8.3-fpm",
  "php8.3-cli",
  "php8.3-common",
  "php8.3-mysql",
  "php8.3-curl",
  "php8.3-gd",
  "php8.3-mbstring",
  "php8.3-xml",
  "php8.3-zip",
  "php8.3-bcmath",
  "php8.3-intl",
  "php8.3-opcache",
  "php8.3-readline",
  "php8.3-sqlite3",
  "php8.3-redis",
  "php8.3-bz2",
  "php8.3-soap",
];

export const EXTENSION_DEFINITIONS = [
  // Database
  { name: "mysqli", label: "MySQLi", category: "Database", pkg: "mysql", description: "Improved MySQL database client library" },
  { name: "pdo_mysql", label: "PDO MySQL", category: "Database", pkg: "mysql", description: "PHP Data Objects driver for MySQL / MariaDB" },
  { name: "pdo_pgsql", label: "PDO PostgreSQL", category: "Database", pkg: "pgsql", description: "PHP Data Objects driver for PostgreSQL" },
  { name: "pgsql", label: "PostgreSQL", category: "Database", pkg: "pgsql", description: "Native PostgreSQL database client" },
  { name: "sqlite3", label: "SQLite 3", category: "Database", pkg: "sqlite3", description: "Self-contained serverless SQL database engine" },
  { name: "pdo_sqlite", label: "PDO SQLite", category: "Database", pkg: "sqlite3", description: "PHP Data Objects driver for SQLite" },

  // Cache & Performance
  { name: "opcache", label: "Zend OPcache", category: "Performance", pkg: "opcache", description: "High-performance precompiled script bytecode caching" },
  { name: "redis", label: "Redis", category: "Performance", pkg: "redis", description: "In-memory data store for ultra-fast cache and sessions" },
  { name: "memcached", label: "Memcached", category: "Performance", pkg: "memcached", description: "Distributed memory caching system" },

  // Web, API & Networking
  { name: "curl", label: "cURL", category: "Web & API", pkg: "curl", description: "HTTP client library for REST APIs and remote requests" },
  { name: "soap", label: "SOAP", category: "Web & API", pkg: "soap", description: "Simple Object Access Protocol client and server" },

  // Media & Images
  { name: "gd", label: "GD Graphics", category: "Media", pkg: "gd", description: "Image manipulation library (JPEG, PNG, WebP, AVIF)" },
  { name: "imagick", label: "ImageMagick", category: "Media", pkg: "imagick", description: "Advanced image processing and vector rendering" },

  // Math, Data & Compression
  { name: "bcmath", label: "BCMath", category: "Data & Math", pkg: "bcmath", description: "Arbitrary precision arithmetic mathematics" },
  { name: "bz2", label: "Bzip2", category: "Compression", pkg: "bz2", description: "Bzip2 high-ratio compression and archive handling" },
  { name: "gmp", label: "GMP", category: "Data & Math", pkg: "gmp", description: "GNU Multiple Precision arithmetic mathematics" },
  { name: "intl", label: "Intl", category: "International", pkg: "intl", description: "ICU internationalization, collation, and currencies" },
  { name: "mbstring", label: "Mbstring", category: "Text & Encoding", pkg: "mbstring", description: "Multibyte string handling (UTF-8, Unicode, CJK)" },
  { name: "xml", label: "XML & DOM", category: "Data & Math", pkg: "xml", description: "Extensible Markup Language parsing and DOM handling" },
  { name: "zip", label: "Zip", category: "Compression", pkg: "zip", description: "Zip archive compression, extraction, and file management" },

  // Security, Enterprise & Debugging
  { name: "ldap", label: "LDAP", category: "Enterprise", pkg: "ldap", description: "Lightweight Directory Access Protocol authentication" },
  { name: "tidy", label: "Tidy", category: "Text & Encoding", pkg: "tidy", description: "HTML/XHTML clean and repair utility" },
  { name: "xdebug", label: "Xdebug", category: "Development", pkg: "xdebug", description: "Step debugger, profiler, and code coverage tool" },
];

function getExtensionStatus(version, extName, pkgName) {
  const modsAvailableDir = `/etc/php/${version}/mods-available`;
  const fpmConfDir = `/etc/php/${version}/fpm/conf.d`;

  let installed = false;
  let enabled = false;

  if (existsSync(`${modsAvailableDir}/${extName}.ini`) || (pkgName && existsSync(`${modsAvailableDir}/${pkgName}.ini`))) {
    installed = true;
  }

  if (existsSync(fpmConfDir)) {
    try {
      const activeMods = readdirSync(fpmConfDir);
      for (const mod of activeMods) {
        if (mod.endsWith(`${extName}.ini`) || (pkgName && mod.endsWith(`${pkgName}.ini`))) {
          enabled = true;
          installed = true;
          break;
        }
      }
    } catch {}
  }

  return { installed, enabled };
}

function getInstalledVersions() {
  if (!existsSync("/etc/php")) return [];
  try {
    return readdirSync("/etc/php")
      .filter((dir) => /^[0-9]+\.[0-9]+$/.test(dir))
      .sort();
  } catch {
    return [];
  }
}

function countSitesForVersion(version) {
  if (!existsSync(NGINX_AVAILABLE)) return 0;
  let count = 0;
  const targetSock = `php${version}-fpm.sock`;
  try {
    const files = readdirSync(NGINX_AVAILABLE);
    for (const file of files) {
      const content = readFileSync(path.join(NGINX_AVAILABLE, file), "utf8");
      if (content.includes(targetSock)) count++;
    }
  } catch {}
  return count;
}

router.get("/", async (_req, res, next) => {
  try {
    const installed = getInstalledVersions();
    const serviceNames = installed.map((v) => `php${v}-fpm.service`);
    const states = await unitStates(serviceNames);

    const defaultCliResult = await run("php", ["-r", "echo PHP_MAJOR_VERSION . '.' . PHP_MINOR_VERSION;"], { timeout: 5000 });
    const defaultCli = defaultCliResult.ok ? defaultCliResult.stdout.trim() : null;

    const versions = installed.map((version) => {
      const sockPath = `/var/run/php/php${version}-fpm.sock`;
      const iniPath = `/etc/php/${version}/fpm/php.ini`;
      const isOlder = parseFloat(version) < 8.3;
      const isForbidden = isForbiddenPhpVersion(version);
      return {
        version,
        service: `php${version}-fpm.service`,
        status: states[`php${version}-fpm.service`] || "unknown",
        socketExists: existsSync(sockPath),
        socketPath: sockPath,
        iniExists: existsSync(iniPath),
        isDefaultCli: defaultCli === version,
        activeSitesCount: countSitesForVersion(version),
        isOlder,
        isForbidden,
      };
    });

    const olderInstalled = versions.filter((v) => v.isOlder).map((v) => v.version);
    const hasForbidden = versions.some((v) => v.isForbidden);

    res.json({
      versions,
      availableToInstall: AVAILABLE_VERSIONS.filter((v) => !installed.includes(v)),
      defaultCli,
      hasOlderInstalled: olderInstalled.length > 0,
      olderInstalled,
      hasForbidden,
      isPhp83Installed: installed.includes("8.3"),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/service", async (req, res, next) => {
  try {
    const { version, action } = req.body ?? {};
    if (!version || !/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Invalid PHP version" });
    }
    if (!["start", "stop", "restart", "reload"].includes(action)) {
      return res.status(400).json({ error: "Invalid service action" });
    }

    const unit = `php${version}-fpm.service`;
    const result = await run("systemctl", [action, unit], { timeout: 30000 });
    if (!result.ok) {
      return res.status(500).json({ error: result.stderr || `Failed to ${action} ${unit}` });
    }

    audit({ action: `php.service.${action}`, actor: req.actor?.username, ip: clientIp(req), params: { unit }, result: "ok" });
    res.json({ ok: true, message: `${unit} ${action}ed successfully` });
  } catch (error) {
    next(error);
  }
});

router.get("/:version/config", async (req, res, next) => {
  try {
    const { version } = req.params;
    const iniPath = `/etc/php/${version}/fpm/php.ini`;
    if (!existsSync(iniPath)) {
      return res.status(404).json({ error: `php.ini for version ${version} not found` });
    }

    const content = readFileSync(iniPath, "utf8");

    const settings = {
      upload_max_filesize: content.match(/^upload_max_filesize\s*=\s*(.+)$/m)?.[1]?.trim() || "2M",
      post_max_size: content.match(/^post_max_size\s*=\s*(.+)$/m)?.[1]?.trim() || "8M",
      memory_limit: content.match(/^memory_limit\s*=\s*(.+)$/m)?.[1]?.trim() || "128M",
      max_execution_time: content.match(/^max_execution_time\s*=\s*(.+)$/m)?.[1]?.trim() || "30",
      max_input_time: content.match(/^max_input_time\s*=\s*(.+)$/m)?.[1]?.trim() || "60",
      display_errors: content.match(/^display_errors\s*=\s*(.+)$/m)?.[1]?.trim() || "Off",
      date_timezone: content.match(/^date\.timezone\s*=\s*(.+)$/m)?.[1]?.trim() || "UTC",
    };

    res.json({ version, iniPath, settings, raw: content });
  } catch (error) {
    next(error);
  }
});

router.post("/:version/config", async (req, res, next) => {
  try {
    const { version } = req.params;
    const { settings, raw } = req.body ?? {};
    const iniPath = `/etc/php/${version}/fpm/php.ini`;
    if (!existsSync(iniPath)) {
      return res.status(404).json({ error: `php.ini for version ${version} not found` });
    }

    if (typeof raw === "string") {
      writeFileSync(iniPath, raw, "utf8");
    } else if (settings && typeof settings === "object") {
      let content = readFileSync(iniPath, "utf8");
      const mapping = {
        upload_max_filesize: `upload_max_filesize = ${settings.upload_max_filesize || "64M"}`,
        post_max_size: `post_max_size = ${settings.post_max_size || "64M"}`,
        memory_limit: `memory_limit = ${settings.memory_limit || "256M"}`,
        max_execution_time: `max_execution_time = ${settings.max_execution_time || "300"}`,
        max_input_time: `max_input_time = ${settings.max_input_time || "300"}`,
        display_errors: `display_errors = ${settings.display_errors === "On" ? "On" : "Off"}`,
        "date.timezone": `date.timezone = ${settings.date_timezone || "UTC"}`,
      };

      for (const [key, newLine] of Object.entries(mapping)) {
        const regex = new RegExp(`^;?\\s*${key.replace(".", "\\.")}\\s*=.*$`, "m");
        if (regex.test(content)) {
          content = content.replace(regex, newLine);
        } else {
          content += `\n${newLine}\n`;
        }
      }
      writeFileSync(iniPath, content, "utf8");
    }

    await run("systemctl", ["reload", `php${version}-fpm.service`], { timeout: 15000 });
    audit({ action: "php.config.update", actor: req.actor?.username, ip: clientIp(req), params: { version }, result: "ok" });
    res.json({ ok: true, message: `PHP ${version} config updated and FPM reloaded` });
  } catch (error) {
    next(error);
  }
});

router.get("/:version/extensions", async (req, res, next) => {
  try {
    const { version } = req.params;
    if (!/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Invalid PHP version" });
    }

    const bin = `/usr/bin/php${version}`;
    const activeCliResult = existsSync(bin) ? await run(bin, ["-m"], { timeout: 10000 }) : { ok: false, stdout: "" };
    const loadedCliModules = new Set(
      activeCliResult.ok
        ? activeCliResult.stdout.split("\n").map((l) => l.trim().toLowerCase()).filter(Boolean)
        : [],
    );

    const extensions = EXTENSION_DEFINITIONS.map((def) => {
      const { installed, enabled } = getExtensionStatus(version, def.name, def.pkg);
      const isCliLoaded = loadedCliModules.has(def.name.toLowerCase()) || (def.pkg && loadedCliModules.has(def.pkg.toLowerCase()));
      return {
        ...def,
        installed: installed || isCliLoaded,
        enabled: enabled || isCliLoaded,
      };
    });

    res.json({ version, extensions });
  } catch (error) {
    next(error);
  }
});

export async function ensurePhpRepository(version) {
  // Check if php${version}-fpm package is already indexed in apt cache
  const check = await run("apt-cache", ["show", `php${version}-fpm`]);
  if (check.ok && check.stdout.includes(`Package: php${version}-fpm`)) {
    return { ok: true };
  }

  // Detect OS details
  let osId = "ubuntu";
  let codename = "";
  if (existsSync("/etc/os-release")) {
    try {
      const osRelease = readFileSync("/etc/os-release", "utf8");
      const idMatch = osRelease.match(/^ID=(.+)$/m);
      if (idMatch) osId = idMatch[1].replace(/["']/g, "").trim().toLowerCase();
      const codenameMatch = osRelease.match(/^VERSION_CODENAME=(.+)$/m);
      if (codenameMatch) codename = codenameMatch[1].replace(/["']/g, "").trim().toLowerCase();
    } catch {}
  }

  // Ubuntu and Debian derivatives
  if (["ubuntu", "pop", "linuxmint"].includes(osId)) {
    // Check if add-apt-repository exists; if not, install software-properties-common
    if (!existsSync("/usr/bin/add-apt-repository")) {
      const spc = await run("apt-get", ["install", "-y", "-q", "software-properties-common"], {
        timeout: 120000,
        env: { DEBIAN_FRONTEND: "noninteractive" },
      });
      if (!spc.ok) {
        return {
          ok: false,
          error: `Failed to install software-properties-common required for PHP repository setup: ${spc.stderr || spc.stdout}`,
        };
      }
    }

    // Add Ondřej Surý PHP PPA
    const ppa = await run("add-apt-repository", ["-y", "ppa:ondrej/php"], {
      timeout: 180000,
      env: { DEBIAN_FRONTEND: "noninteractive", LC_ALL: "C.UTF-8" },
    });
    if (!ppa.ok) {
      // Direct PPA keyring fallback
      try {
        const cname = codename || "noble";
        const sourcesDir = "/etc/apt/sources.list.d";
        if (!existsSync(sourcesDir)) mkdirSync(sourcesDir, { recursive: true });
        writeFileSync(
          path.join(sourcesDir, "ondrej-php.list"),
          `deb https://ppa.launchpadcontent.net/ondrej/php/ubuntu/ ${cname} main\n`,
          "utf8",
        );
      } catch (e) {
        return { ok: false, error: `Failed to configure Ondřej Surý PHP PPA: ${ppa.stderr || e.message}` };
      }
    }
  } else if (osId === "debian") {
    // Debian: configure packages.sury.org
    const deps = await run("apt-get", ["install", "-y", "-q", "apt-transport-https", "ca-certificates", "curl"], {
      timeout: 120000,
      env: { DEBIAN_FRONTEND: "noninteractive" },
    });
    if (!deps.ok) {
      return { ok: false, error: `Failed to install Debian repository dependencies: ${deps.stderr || deps.stdout}` };
    }

    const gpgDir = "/etc/apt/trusted.gpg.d";
    if (!existsSync(gpgDir)) mkdirSync(gpgDir, { recursive: true });

    await run("curl", ["-sSLo", "/etc/apt/trusted.gpg.d/php.gpg", "https://packages.sury.org/php/apt.gpg"], {
      timeout: 60000,
    });

    const cname = codename || "bookworm";
    writeFileSync("/etc/apt/sources.list.d/php.list", `deb https://packages.sury.org/php/ ${cname} main\n`, "utf8");
  }

  // Refresh apt package lists
  const updateRes = await run("apt-get", ["update", "-q"], {
    timeout: 120000,
    env: { DEBIAN_FRONTEND: "noninteractive" },
  });
  if (!updateRes.ok) {
    return { ok: false, error: `Failed to update package lists after adding PHP repository: ${updateRes.stderr || updateRes.stdout}` };
  }

  // Final verification that php${version}-fpm is indexed
  const verify = await run("apt-cache", ["show", `php${version}-fpm`]);
  if (!verify.ok || !verify.stdout.includes(`Package: php${version}-fpm`)) {
    return {
      ok: false,
      error: `Package php${version}-fpm could not be located in package repositories after adding Ondřej Surý PHP repository.`,
    };
  }

  return { ok: true };
}

router.post("/:version/extensions/toggle", async (req, res, next) => {
  try {
    const { version } = req.params;
    const { extension, enable } = req.body ?? {};

    if (!version || !/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Invalid PHP version" });
    }
    if (!extension || typeof extension !== "string") {
      return res.status(400).json({ error: "Extension identifier is required" });
    }

    const def = EXTENSION_DEFINITIONS.find((e) => e.name === extension || e.pkg === extension) || {
      name: extension,
      pkg: extension,
    };

    const targetPkg = `php${version}-${def.pkg || def.name}`;
    const modName = def.name;

    if (enable) {
      const status = getExtensionStatus(version, def.name, def.pkg);
      if (!status.installed) {
        const repoCheck = await ensurePhpRepository(version);
        if (!repoCheck.ok) {
          return res.status(500).json({ error: `Repository setup failed: ${repoCheck.error}` });
        }
        const aptRes = await run("apt-get", ["install", "-y", "-q", targetPkg], {
          timeout: 180000,
          env: { DEBIAN_FRONTEND: "noninteractive" },
        });
        if (!aptRes.ok) {
          return res.status(500).json({ error: `Package installation failed: ${aptRes.stderr || aptRes.stdout}` });
        }
      }

      await run("phpenmod", ["-v", version, modName], { timeout: 15000 });
      if (def.pkg && def.pkg !== modName) {
        await run("phpenmod", ["-v", version, def.pkg], { timeout: 15000 });
      }
    } else {
      await run("phpdismod", ["-v", version, modName], { timeout: 15000 });
      if (def.pkg && def.pkg !== modName) {
        await run("phpdismod", ["-v", version, def.pkg], { timeout: 15000 });
      }
    }

    await run("systemctl", ["reload", `php${version}-fpm.service`], { timeout: 15000 });

    audit({
      action: `php.extension.${enable ? "enable" : "disable"}`,
      actor: req.actor?.username,
      ip: clientIp(req),
      params: { version, extension: modName, enable },
      result: "ok",
    });

    res.json({
      ok: true,
      extension: modName,
      enabled: Boolean(enable),
      message: `PHP ${version} extension '${modName}' ${enable ? "enabled" : "disabled"} and FPM reloaded`,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/switch-site", async (req, res, next) => {
  try {
    const { site, version } = req.body ?? {};
    if (!site || !version || !/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Site name and valid PHP version required" });
    }

    if (isForbiddenPhpVersion(version)) {
      return res.status(400).json({
        error: "PHP 7.4 and older versions are end-of-life and strictly prohibited. Axon Panel requires PHP 8.1 or higher (PHP 8.3 recommended).",
      });
    }

    const siteFile = path.join(NGINX_AVAILABLE, site);
    if (!existsSync(siteFile)) {
      return res.status(404).json({ error: `Site ${site} configuration not found` });
    }

    const sock = `/var/run/php/php${version}-fpm.sock`;
    let content = readFileSync(siteFile, "utf8");

    if (!content.includes("fastcgi_pass")) {
      return res.status(400).json({ error: "This site does not appear to be a PHP application (no fastcgi_pass directive)" });
    }

    const oldContent = content;
    content = content.replace(
      /fastcgi_pass\s+unix:\/var\/run\/php\/php[0-9.]+-fpm\.sock;/g,
      `fastcgi_pass unix:${sock};`,
    );

    writeFileSync(siteFile, content, "utf8");

    const test = await testConfig();
    if (!test.ok) {
      writeFileSync(siteFile, oldContent, "utf8");
      return res.status(400).json({ error: `Nginx validation failed with PHP ${version}: ${test.error}` });
    }

    await reloadNginx();
    audit({ action: "php.site.switch", actor: req.actor?.username, ip: clientIp(req), params: { site, version }, result: "ok" });
    res.json({ ok: true, message: `Switched ${site} to PHP ${version} successfully` });
  } catch (error) {
    next(error);
  }
});

router.post("/install", async (req, res, next) => {
  try {
    const { version } = req.body ?? {};
    if (isForbiddenPhpVersion(version)) {
      return res.status(400).json({
        error: "PHP 7.4 and older versions are end-of-life and strictly prohibited. Axon Panel requires PHP 8.1 or higher (PHP 8.3 recommended).",
      });
    }
    if (!version || !AVAILABLE_VERSIONS.includes(version)) {
      return res.status(400).json({ error: `Invalid PHP version. Supported: ${AVAILABLE_VERSIONS.join(", ")}` });
    }

    const repoCheck = await ensurePhpRepository(version);
    if (!repoCheck.ok) {
      return res.status(500).json({ error: `Repository setup failed: ${repoCheck.error}` });
    }

    const packages = [
      `php${version}-fpm`,
      `php${version}-cli`,
      `php${version}-common`,
      `php${version}-mysql`,
      `php${version}-curl`,
      `php${version}-gd`,
      `php${version}-mbstring`,
      `php${version}-xml`,
      `php${version}-zip`,
      `php${version}-bcmath`,
      `php${version}-intl`,
    ];

    const installResult = await run(
      "apt-get",
      ["install", "-y", "-q", ...packages],
      { timeout: 300000, env: { DEBIAN_FRONTEND: "noninteractive" } },
    );

    if (!installResult.ok) {
      return res.status(500).json({ error: `Installation failed: ${installResult.stderr || installResult.stdout}` });
    }

    await run("systemctl", ["enable", "--now", `php${version}-fpm`], { timeout: 30000 });
    audit({ action: "php.install", actor: req.actor?.username, ip: clientIp(req), params: { version }, result: "ok" });
    res.json({ ok: true, message: `PHP ${version} and extensions installed successfully` });
  } catch (error) {
    next(error);
  }
});

export async function standardizePhp83({ migrateSites = true, purgeOlder = true } = {}) {
  const steps = [];

  // Step 1: Ensure repository is ready for PHP 8.3
  const repoRes = await ensurePhpRepository("8.3");
  if (!repoRes.ok) {
    throw new Error(`Repository setup failed: ${repoRes.error}`);
  }
  steps.push("Ondřej Surý PHP repository verified for PHP 8.3");

  // Step 2: Install PHP 8.3 and all essential production components
  const installResult = await run(
    "apt-get",
    ["install", "-y", "-q", ...PHP83_COMPONENTS],
    { timeout: 300000, env: { DEBIAN_FRONTEND: "noninteractive" } },
  );
  if (!installResult.ok) {
    throw new Error(`PHP 8.3 installation failed: ${installResult.stderr || installResult.stdout}`);
  }
  steps.push("PHP 8.3 runtime and all components installed successfully");

  // Step 3: Enable and start php8.3-fpm
  await run("systemctl", ["enable", "--now", "php8.3-fpm"], { timeout: 30000 });
  steps.push("php8.3-fpm.service enabled and started");

  // Step 4: Migrate any Nginx virtual hosts using older PHP versions (< 8.3, including 7.4, 8.0, 8.1, 8.2)
  const migratedSites = [];
  if (migrateSites && existsSync(NGINX_AVAILABLE)) {
    try {
      const files = readdirSync(NGINX_AVAILABLE);
      for (const file of files) {
        const fullPath = path.join(NGINX_AVAILABLE, file);
        if (!existsSync(fullPath)) continue;
        try {
          const stat = lstatSync(fullPath);
          if (!stat.isFile()) continue;
        } catch {
          continue;
        }

        let content = readFileSync(fullPath, "utf8");
        const match = content.match(/fastcgi_pass\s+unix:\/var\/run\/php\/php([0-9.]+)-fpm\.sock;/);
        if (match) {
          const oldVer = match[1];
          if (parseFloat(oldVer) < 8.3) {
            const oldContent = content;
            content = content.replace(
              /fastcgi_pass\s+unix:\/var\/run\/php\/php[0-9.]+-fpm\.sock;/g,
              "fastcgi_pass unix:/var/run/php/php8.3-fpm.sock;",
            );
            writeFileSync(fullPath, content, "utf8");

            const check = await testConfig();
            if (!check.ok) {
              writeFileSync(fullPath, oldContent, "utf8");
            } else {
              migratedSites.push({ site: file, from: oldVer, to: "8.3" });
            }
          }
        }
      }
      if (migratedSites.length > 0) {
        await reloadNginx();
        steps.push(`Migrated ${migratedSites.length} website(s) to PHP 8.3 FastCGI socket`);
      }
    } catch (e) {
      steps.push(`Site migration note: ${e.message}`);
    }
  }

  // Step 5: Identify and remove older PHP versions (< 8.3)
  const removedVersions = [];
  const removedPackages = [];
  if (purgeOlder) {
    const installed = getInstalledVersions();
    const older = installed.filter((v) => parseFloat(v) < 8.3);

    for (const ver of older) {
      // 1. Stop and disable legacy service
      try {
        await run("systemctl", ["stop", `php${ver}-fpm`], { timeout: 15000 });
        await run("systemctl", ["disable", `php${ver}-fpm`], { timeout: 15000 });
      } catch {}

      // 2. Discover all installed packages for this version
      const pkgQuery = await run("dpkg-query", ["-W", "-f=${binary:Package}\n", `php${ver}*`]);
      if (pkgQuery.ok && pkgQuery.stdout) {
        const pkgs = pkgQuery.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
        if (pkgs.length > 0) {
          const rmRes = await run("apt-get", ["remove", "--purge", "-y", "-q", ...pkgs], {
            timeout: 180000,
            env: { DEBIAN_FRONTEND: "noninteractive" },
          });
          if (rmRes.ok) {
            removedPackages.push(...pkgs);
          }
        }
      }

      // Clean up /etc/php/<ver> directory if remaining
      try {
        const dir = `/etc/php/${ver}`;
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {}

      removedVersions.push(ver);
    }

    if (removedVersions.length > 0) {
      // Autoremove dangling unneeded dependencies
      await run("apt-get", ["autoremove", "-y", "-q"], {
        timeout: 120000,
        env: { DEBIAN_FRONTEND: "noninteractive" },
      });
      steps.push(`Removed older PHP versions: ${removedVersions.join(", ")}`);
    } else {
      steps.push("No older PHP versions (< 8.3) found on the system");
    }
  }

  // Step 6: Update default CLI alternatives if available
  try {
    if (existsSync("/usr/bin/php8.3")) {
      await run("update-alternatives", ["--set", "php", "/usr/bin/php8.3"], { timeout: 10000 });
      steps.push("Set default CLI php to /usr/bin/php8.3");
    }
  } catch {}

  return {
    ok: true,
    targetVersion: "8.3",
    installedComponents: PHP83_COMPONENTS,
    migratedSites,
    removedVersions,
    removedPackages,
    steps,
  };
}

router.post("/standardize-83", async (req, res, next) => {
  try {
    const { migrateSites = true, purgeOlder = true } = req.body ?? {};
    const result = await standardizePhp83({ migrateSites, purgeOlder });
    audit({
      action: "php.standardize_83",
      actor: req.actor?.username,
      ip: clientIp(req),
      params: { migrateSites, purgeOlder },
      result: "ok",
    });
    res.json({
      ok: true,
      message: "Successfully standardized on PHP 8.3, installed all components, and removed older versions.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/remove-older", async (req, res, next) => {
  try {
    const { migrateSites = true, purgeOlder = true } = req.body ?? {};
    const result = await standardizePhp83({ migrateSites, purgeOlder });
    audit({
      action: "php.remove_older",
      actor: req.actor?.username,
      ip: clientIp(req),
      params: { migrateSites, purgeOlder },
      result: "ok",
    });
    res.json({
      ok: true,
      message: "Older PHP versions removed and PHP 8.3 components verified.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/remove", async (req, res, next) => {
  try {
    const { version, migrateTo = "8.3" } = req.body ?? {};
    if (!version || !/^[0-9]+\.[0-9]+$/.test(version)) {
      return res.status(400).json({ error: "Invalid PHP version" });
    }
    if (version === "8.3") {
      return res.status(400).json({ error: "Cannot remove standard PHP 8.3 runtime." });
    }

    // 1. Migrate sites if any are on this version
    const migratedSites = [];
    if (existsSync(NGINX_AVAILABLE)) {
      const files = readdirSync(NGINX_AVAILABLE);
      const targetSock = `/var/run/php/php${migrateTo}-fpm.sock`;
      for (const file of files) {
        const fullPath = path.join(NGINX_AVAILABLE, file);
        if (!existsSync(fullPath)) continue;
        try {
          if (!lstatSync(fullPath).isFile()) continue;
        } catch {
          continue;
        }

        let content = readFileSync(fullPath, "utf8");
        if (content.includes(`php${version}-fpm.sock`)) {
          const oldContent = content;
          content = content.replace(
            /fastcgi_pass\s+unix:\/var\/run\/php\/php[0-9.]+-fpm\.sock;/g,
            `fastcgi_pass unix:${targetSock};`,
          );
          writeFileSync(fullPath, content, "utf8");
          const check = await testConfig();
          if (!check.ok) {
            writeFileSync(fullPath, oldContent, "utf8");
          } else {
            migratedSites.push({ site: file, from: version, to: migrateTo });
          }
        }
      }
      if (migratedSites.length > 0) {
        await reloadNginx();
      }
    }

    // 2. Stop and disable service
    try {
      await run("systemctl", ["stop", `php${version}-fpm`], { timeout: 15000 });
      await run("systemctl", ["disable", `php${version}-fpm`], { timeout: 15000 });
    } catch {}

    // 3. Remove packages
    const pkgQuery = await run("dpkg-query", ["-W", "-f=${binary:Package}\n", `php${version}*`]);
    let removedPackages = [];
    if (pkgQuery.ok && pkgQuery.stdout) {
      const pkgs = pkgQuery.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
      if (pkgs.length > 0) {
        const rmRes = await run("apt-get", ["remove", "--purge", "-y", "-q", ...pkgs], {
          timeout: 180000,
          env: { DEBIAN_FRONTEND: "noninteractive" },
        });
        if (rmRes.ok) removedPackages = pkgs;
      }
    }

    // 4. Clean up /etc/php/<version>
    try {
      const dir = `/etc/php/${version}`;
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    } catch {}

    await run("apt-get", ["autoremove", "-y", "-q"], { timeout: 120000, env: { DEBIAN_FRONTEND: "noninteractive" } });

    audit({
      action: "php.remove",
      actor: req.actor?.username,
      ip: clientIp(req),
      params: { version, migrateTo, migratedCount: migratedSites.length },
      result: "ok",
    });

    res.json({
      ok: true,
      message: `PHP ${version} removed successfully`,
      migratedSites,
      removedPackages,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
