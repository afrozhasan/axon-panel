import { Router } from "express";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { run } from "../lib/exec.js";
import { testConfig, reloadNginx, NGINX_AVAILABLE } from "../lib/nginx.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { unitStates } from "../lib/systemd.js";

const router = Router();
const AVAILABLE_VERSIONS = ["8.1", "8.2", "8.3", "8.4"];

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
      return {
        version,
        service: `php${version}-fpm.service`,
        status: states[`php${version}-fpm.service`] || "unknown",
        socketExists: existsSync(sockPath),
        socketPath: sockPath,
        iniExists: existsSync(iniPath),
        isDefaultCli: defaultCli === version,
        activeSitesCount: countSitesForVersion(version),
      };
    });

    res.json({
      versions,
      availableToInstall: AVAILABLE_VERSIONS.filter((v) => !installed.includes(v)),
      defaultCli,
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
    if (!version || !AVAILABLE_VERSIONS.includes(version)) {
      return res.status(400).json({ error: `Invalid PHP version. Supported: ${AVAILABLE_VERSIONS.join(", ")}` });
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
      return res.status(500).json({ error: `Installation failed: ${installResult.stderr}` });
    }

    await run("systemctl", ["enable", "--now", `php${version}-fpm`], { timeout: 30000 });
    audit({ action: "php.install", actor: req.actor?.username, ip: clientIp(req), params: { version }, result: "ok" });
    res.json({ ok: true, message: `PHP ${version} and extensions installed successfully` });
  } catch (error) {
    next(error);
  }
});

export default router;
