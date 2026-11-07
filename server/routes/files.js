import { Router } from "express";
import path from "node:path";
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  rmSync,
  existsSync,
  copyFileSync,
  lstatSync,
  createReadStream,
} from "node:fs";
import { resolveSafePath, assertNotSensitive } from "../lib/validate.js";
import { upload } from "../lib/upload.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";
import { loadConfig } from "../config.js";
import { run } from "../lib/exec.js";

const router = Router();
const MAX_READ_BYTES = 4 * 1024 * 1024; // 4MB

function roots(actor) {
  const allRoots = loadConfig().allowedRoots;
  if (!actor || actor.role === "super_admin" || actor.role === "server_admin") {
    return allRoots;
  }
  const scoped = allRoots.filter((r) => r.startsWith("/var/www"));
  return scoped.length > 0 ? scoped : ["/var/www"];
}

function resolvePath(input, actor) {
  return resolveSafePath(input, roots(actor));
}

let userMap = null;
let groupMap = null;

function getUserName(uid) {
  if (!userMap) {
    userMap = new Map();
    try {
      const lines = readFileSync("/etc/passwd", "utf8").split("\n");
      for (const line of lines) {
        const parts = line.split(":");
        if (parts[0] && parts[2]) userMap.set(parseInt(parts[2], 10), parts[0]);
      }
    } catch {}
  }
  return userMap.get(uid) || String(uid);
}

function getGroupName(gid) {
  if (!groupMap) {
    groupMap = new Map();
    try {
      const lines = readFileSync("/etc/group", "utf8").split("\n");
      for (const line of lines) {
        const parts = line.split(":");
        if (parts[0] && parts[2]) groupMap.set(parseInt(parts[2], 10), parts[0]);
      }
    } catch {}
  }
  return groupMap.get(gid) || String(gid);
}

const TEXT_EXTENSIONS = new Set([
  ".conf", ".cfg", ".ini", ".env", ".log", ".txt", ".md", ".json", ".yml", ".yaml", ".xml", ".html", ".htm",
  ".css", ".scss", ".sass", ".less", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".php",
  ".sh", ".bash", ".zsh", ".py", ".rb", ".sql", ".htaccess", ".service", ".timer", ".socket", ".properties",
  ".toml", ".lock", ".gitignore", ".gitattributes", ".editorconfig", ".csv", ".svg", ".astro", ".graphql",
]);

const MEDIA_TYPES = {
  // Images
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image", ".webp": "image", ".svg": "image", ".ico": "image", ".bmp": "image",
  // Video
  ".mp4": "video", ".webm": "video", ".ogg": "video", ".mov": "video",
  // Audio
  ".mp3": "audio", ".wav": "audio", ".aac": "audio", ".flac": "audio",
  // Document
  ".pdf": "pdf",
  // Archives
  ".zip": "archive", ".tar": "archive", ".gz": "archive", ".tgz": "archive", ".bz2": "archive", ".rar": "archive", ".7z": "archive",
};

const MIME_TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg",
  ".pdf": "application/pdf", ".txt": "text/plain", ".html": "text/html", ".css": "text/css", ".js": "application/javascript",
  ".json": "application/json", ".xml": "application/xml",
};

function getMediaType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (MEDIA_TYPES[ext]) return MEDIA_TYPES[ext];
  if (TEXT_EXTENSIONS.has(ext)) return "code";
  const base = path.basename(filePath).toLowerCase();
  if (["dockerfile", "makefile", "procfile", "readme", "license", "artisan"].includes(base)) return "code";
  return "binary";
}

function looksTextual(filePath, size) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  if (["dockerfile", "makefile", "procfile", "readme", "license", "artisan"].includes(base)) return true;
  return size < 512 * 1024;
}

// 1. Permitted Roots & Shortcuts
router.get("/roots", (req, res) => {
  const actorRoots = roots(req.actor);
  const commonShortcuts = [
    { path: "/var/www", label: "Websites (/var/www)", icon: "globe" },
    { path: "/etc/nginx", label: "Nginx (/etc/nginx)", icon: "server" },
    { path: "/var/log", label: "Logs (/var/log)", icon: "file-text" },
    { path: "/root/backups", label: "Backups (/root/backups)", icon: "archive" },
    { path: "/", label: "System Root (/)", icon: "hard-drive" },
  ];

  const shortcuts = commonShortcuts.filter((s) => actorRoots.some((r) => s.path === r || s.path.startsWith(r) || r === "/"));

  res.json({
    roots: actorRoots.map((root) => ({
      path: root,
      label: root.replace(/^\//, "").replace(/\//g, " / ") || "/",
      exists: existsSync(root),
    })),
    shortcuts,
  });
});

// 2. Directory Listing with Full Webhosting Metadata
router.get("/list", (req, res, next) => {
  try {
    const defaultRoot = roots(req.actor)[0] || "/var/www";
    const target = resolvePath(String(req.query.path || defaultRoot), req.actor);
    const showHidden = req.query.showHidden === "true" || req.query.showHidden === "1";

    if (!existsSync(target)) return res.status(404).json({ error: "Directory not found" });

    const info = statSync(target);
    if (!info.isDirectory()) return res.status(400).json({ error: "Not a directory" });

    let rawEntries = readdirSync(target, { withFileTypes: true });
    if (!showHidden) {
      rawEntries = rawEntries.filter((e) => !e.name.startsWith("."));
    }

    let totalBytes = 0;
    let totalFiles = 0;
    let totalDirs = 0;

    const entries = rawEntries.map((entry) => {
      const full = path.join(target, entry.name);
      let stat = null;
      try {
        stat = lstatSync(full);
      } catch {
        stat = null;
      }

      const isSymlink = stat?.isSymbolicLink() ?? false;
      let kind = entry.isDirectory() ? "directory" : "file";
      if (isSymlink) kind = "symlink";

      const size = stat?.size ?? 0;
      if (kind === "directory") totalDirs++;
      else {
        totalFiles++;
        totalBytes += size;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const mediaType = getMediaType(full);

      return {
        name: entry.name,
        path: full,
        kind,
        symlink: isSymlink,
        size,
        modified: stat?.mtime?.toISOString() ?? null,
        mode: stat ? (stat.mode & 0o777).toString(8).padStart(4, "0") : "0644",
        owner: stat ? getUserName(stat.uid) : "root",
        group: stat ? getGroupName(stat.gid) : "root",
        ext,
        mediaType,
        isArchive: mediaType === "archive",
        isMedia: ["image", "video", "audio", "pdf"].includes(mediaType),
        readable: looksTextual(full, size),
      };
    });

    entries.sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") return -1;
      if (a.kind !== "directory" && b.kind === "directory") return 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });

    return res.json({
      path: target,
      parent: target === "/" ? "/" : path.dirname(target),
      entries,
      stats: { totalFiles, totalDirs, totalBytes },
      writable: true,
    });
  } catch (error) {
    return next(error);
  }
});

// 3. Read File Content
router.get("/read", (req, res, next) => {
  try {
    const target = resolvePath(String(req.query.path || ""), req.actor);
    assertNotSensitive(target);
    if (!existsSync(target)) return res.status(404).json({ error: "File not found" });

    const info = statSync(target);
    if (info.isDirectory()) return res.status(400).json({ error: "That is a directory" });
    if (info.size > MAX_READ_BYTES) {
      return res.status(413).json({ error: `File is larger than ${MAX_READ_BYTES / 1024 / 1024} MB and cannot be opened in the web editor` });
    }

    const content = readFileSync(target, "utf8");
    const ext = path.extname(target).toLowerCase();

    return res.json({
      path: target,
      content,
      size: info.size,
      modified: info.mtime.toISOString(),
      mode: (info.mode & 0o777).toString(8).padStart(4, "0"),
      owner: getUserName(info.uid),
      group: getGroupName(info.gid),
      ext,
      mediaType: getMediaType(target),
      binary: !looksTextual(target, info.size),
    });
  } catch (error) {
    if (error.code === "ERR_INVALID_ARG" || /invalid utf-8/i.test(String(error.message))) {
      return res.status(415).json({ error: "This file is binary or not valid UTF-8 text" });
    }
    return next(error);
  }
});

// 4. Save / Write File
router.put("/write", (req, res, next) => {
  try {
    const target = resolvePath(String(req.body?.path || ""), req.actor);
    assertNotSensitive(target);
    const { content } = req.body ?? {};
    if (typeof content !== "string") return res.status(400).json({ error: "Content is required" });
    if (Buffer.byteLength(content) > MAX_READ_BYTES) return res.status(413).json({ error: "Content is too large" });

    if (existsSync(target)) {
      const backup = `${target}.panel-bak`;
      try { copyFileSync(target, backup); } catch {}
    }
    writeFileSync(target, content, { mode: existsSync(target) ? undefined : 0o644 });

    audit({ action: "file.write", actor: req.actor.username, ip: clientIp(req), params: { path: target, bytes: Buffer.byteLength(content) } });
    return res.json({ ok: true, message: "File saved successfully" });
  } catch (error) {
    return next(error);
  }
});

// 5. Create Empty File (Touch)
router.post("/touch", (req, res, next) => {
  try {
    const target = resolvePath(String(req.body?.path || ""), req.actor);
    assertNotSensitive(target);
    if (existsSync(target)) return res.status(400).json({ error: "A file or directory already exists at this path" });

    const content = typeof req.body?.content === "string" ? req.body.content : "";
    writeFileSync(target, content, { mode: 0o644 });

    // Inherit directory ownership
    try {
      const parentStat = statSync(path.dirname(target));
      run("chown", [`${parentStat.uid}:${parentStat.gid}`, target]).catch(() => {});
    } catch {}

    audit({ action: "file.touch", actor: req.actor.username, ip: clientIp(req), params: { path: target } });
    return res.status(201).json({ ok: true, path: target });
  } catch (error) {
    return next(error);
  }
});

// 6. Create Directory
router.post("/mkdir", (req, res, next) => {
  try {
    const target = resolvePath(String(req.body?.path || ""), req.actor);
    if (existsSync(target)) return res.status(400).json({ error: "Directory already exists" });

    const mode = req.body?.mode ? parseInt(req.body.mode, 8) : 0o755;
    mkdirSync(target, { recursive: true, mode });

    try {
      const parentStat = statSync(path.dirname(target));
      run("chown", [`${parentStat.uid}:${parentStat.gid}`, target]).catch(() => {});
    } catch {}

    audit({ action: "file.mkdir", actor: req.actor.username, ip: clientIp(req), params: { path: target } });
    return res.status(201).json({ ok: true, path: target });
  } catch (error) {
    return next(error);
  }
});

// 7. Rename Single Item
router.post("/rename", (req, res, next) => {
  try {
    const from = resolvePath(String(req.body?.from || ""), req.actor);
    const to = resolvePath(String(req.body?.to || ""), req.actor);
    if (!existsSync(from)) return res.status(404).json({ error: "Source not found" });
    if (existsSync(to)) return res.status(400).json({ error: "Destination already exists" });

    renameSync(from, to);
    audit({ action: "file.rename", actor: req.actor.username, ip: clientIp(req), params: { from, to } });
    return res.json({ ok: true, message: "Renamed successfully" });
  } catch (error) {
    return next(error);
  }
});

// 8. Copy File(s) / Folder(s)
router.post("/copy", async (req, res, next) => {
  try {
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : (req.body?.from ? [req.body.from] : []);
    const destination = resolvePath(String(req.body?.destination || req.body?.to || ""), req.actor);

    if (sources.length === 0) return res.status(400).json({ error: "No source files specified" });
    if (!existsSync(destination)) return res.status(404).json({ error: "Destination folder not found" });

    const destStat = statSync(destination);
    if (!destStat.isDirectory()) return res.status(400).json({ error: "Destination must be a directory" });

    const resolvedSources = sources.map((s) => resolvePath(String(s), req.actor));
    for (const src of resolvedSources) {
      if (!existsSync(src)) return res.status(404).json({ error: `Source not found: ${path.basename(src)}` });
    }

    const cpResult = await run("cp", ["-r", ...resolvedSources, destination]);
    if (!cpResult.ok) {
      return res.status(500).json({ error: `Copy failed: ${cpResult.stderr || cpResult.stdout}` });
    }

    audit({ action: "file.copy", actor: req.actor.username, ip: clientIp(req), params: { count: sources.length, destination } });
    return res.json({ ok: true, message: `Copied ${sources.length} item(s) successfully` });
  } catch (error) {
    return next(error);
  }
});

// 9. Move File(s) / Folder(s)
router.post("/move", async (req, res, next) => {
  try {
    const sources = Array.isArray(req.body?.sources) ? req.body.sources : (req.body?.from ? [req.body.from] : []);
    const destination = resolvePath(String(req.body?.destination || req.body?.to || ""), req.actor);

    if (sources.length === 0) return res.status(400).json({ error: "No source files specified" });
    if (!existsSync(destination)) return res.status(404).json({ error: "Destination folder not found" });

    const destStat = statSync(destination);
    if (!destStat.isDirectory()) return res.status(400).json({ error: "Destination must be a directory" });

    const resolvedSources = sources.map((s) => resolvePath(String(s), req.actor));
    for (const src of resolvedSources) {
      if (!existsSync(src)) return res.status(404).json({ error: `Source not found: ${path.basename(src)}` });
    }

    const mvResult = await run("mv", [...resolvedSources, destination]);
    if (!mvResult.ok) {
      return res.status(500).json({ error: `Move failed: ${mvResult.stderr || mvResult.stdout}` });
    }

    audit({ action: "file.move", actor: req.actor.username, ip: clientIp(req), params: { count: sources.length, destination } });
    return res.json({ ok: true, message: `Moved ${sources.length} item(s) successfully` });
  } catch (error) {
    return next(error);
  }
});

// 10. Delete Single or Multiple Files/Folders
router.post("/delete", (req, res, next) => {
  try {
    const targets = Array.isArray(req.body?.paths)
      ? req.body.paths
      : (req.body?.path ? [req.body.path] : []);

    if (targets.length === 0) return res.status(400).json({ error: "No items specified to delete" });

    const permittedRoots = roots(req.actor);
    const resolvedTargets = targets.map((t) => resolvePath(String(t), req.actor));

    for (const target of resolvedTargets) {
      if (!existsSync(target)) continue;
      if (permittedRoots.includes(target)) {
        return res.status(400).json({ error: `Refusing to delete a protected root directory: ${target}` });
      }
      const info = lstatSync(target);
      if (info.isDirectory()) rmSync(target, { recursive: true, force: true });
      else unlinkSync(target);
    }

    audit({ action: "file.delete", actor: req.actor.username, ip: clientIp(req), params: { count: resolvedTargets.length, targets: resolvedTargets } });
    return res.json({ ok: true, message: `Deleted ${resolvedTargets.length} item(s)` });
  } catch (error) {
    return next(error);
  }
});

// 11. Change Permissions (chmod)
router.post("/chmod", async (req, res, next) => {
  try {
    const targets = Array.isArray(req.body?.paths) ? req.body.paths : (req.body?.path ? [req.body.path] : []);
    const mode = String(req.body?.mode || "").trim();
    const recursive = Boolean(req.body?.recursive);

    if (targets.length === 0) return res.status(400).json({ error: "No target items specified" });
    if (!/^[0-7]{3,4}$/.test(mode)) return res.status(400).json({ error: "Invalid octal permission mode (e.g. 0644, 0755, 0600)" });

    const resolved = targets.map((t) => resolvePath(String(t), req.actor));
    const args = recursive ? ["-R", mode, ...resolved] : [mode, ...resolved];

    const result = await run("chmod", args);
    if (!result.ok) {
      return res.status(500).json({ error: `Chmod failed: ${result.stderr || result.stdout}` });
    }

    audit({ action: "file.chmod", actor: req.actor.username, ip: clientIp(req), params: { mode, recursive, count: targets.length } });
    return res.json({ ok: true, message: `Permissions updated to ${mode}` });
  } catch (error) {
    return next(error);
  }
});

// 12. Change Ownership (chown)
router.post("/chown", async (req, res, next) => {
  try {
    const targets = Array.isArray(req.body?.paths) ? req.body.paths : (req.body?.path ? [req.body.path] : []);
    const user = String(req.body?.user || "").trim();
    const group = String(req.body?.group || user).trim();
    const recursive = Boolean(req.body?.recursive);

    if (targets.length === 0) return res.status(400).json({ error: "No target items specified" });
    if (!/^[a-zA-Z0-9_-]+$/.test(user) || !/^[a-zA-Z0-9_-]+$/.test(group)) {
      return res.status(400).json({ error: "Invalid username or group name" });
    }

    const resolved = targets.map((t) => resolvePath(String(t), req.actor));
    const chownStr = `${user}:${group}`;
    const args = recursive ? ["-R", chownStr, ...resolved] : [chownStr, ...resolved];

    const result = await run("chown", args);
    if (!result.ok) {
      return res.status(500).json({ error: `Chown failed: ${result.stderr || result.stdout}` });
    }

    audit({ action: "file.chown", actor: req.actor.username, ip: clientIp(req), params: { owner: chownStr, recursive, count: targets.length } });
    return res.json({ ok: true, message: `Ownership changed to ${chownStr}` });
  } catch (error) {
    return next(error);
  }
});

// 13. Compress / Archive Files & Folders (zip / tar.gz)
router.post("/compress", async (req, res, next) => {
  try {
    const items = Array.isArray(req.body?.paths) ? req.body.paths : [];
    const destinationDir = resolvePath(String(req.body?.destination || ""), req.actor);
    const format = req.body?.format === "tar.gz" ? "tar.gz" : "zip";
    let archiveName = String(req.body?.name || "").trim();

    if (items.length === 0) return res.status(400).json({ error: "No files or folders selected to archive" });
    if (!existsSync(destinationDir)) return res.status(404).json({ error: "Destination folder not found" });

    if (!archiveName) {
      archiveName = `archive-${Date.now()}.${format === "tar.gz" ? "tar.gz" : "zip"}`;
    } else {
      if (format === "zip" && !archiveName.endsWith(".zip")) archiveName += ".zip";
      if (format === "tar.gz" && !archiveName.endsWith(".tar.gz")) archiveName += ".tar.gz";
    }

    const archivePath = path.join(destinationDir, archiveName);
    const resolvedItems = items.map((i) => resolvePath(String(i), req.actor));

    // Base working directory is parent of the first item
    const baseDir = path.dirname(resolvedItems[0]);
    const relativeNames = resolvedItems.map((item) => path.relative(baseDir, item));

    let compressRes;
    if (format === "zip") {
      compressRes = await run("zip", ["-r", archivePath, ...relativeNames], { cwd: baseDir, timeout: 300000 });
    } else {
      compressRes = await run("tar", ["-czf", archivePath, ...relativeNames], { cwd: baseDir, timeout: 300000 });
    }

    if (!compressRes.ok) {
      return res.status(500).json({ error: `Compression failed: ${compressRes.stderr || compressRes.stdout}` });
    }

    audit({ action: "file.compress", actor: req.actor.username, ip: clientIp(req), params: { archive: archivePath, format, count: items.length } });
    return res.json({ ok: true, path: archivePath, message: `Created archive ${archiveName}` });
  } catch (error) {
    return next(error);
  }
});

// 14. Extract / Unarchive Archive Files
router.post("/extract", async (req, res, next) => {
  try {
    const archivePath = resolvePath(String(req.body?.archivePath || ""), req.actor);
    let destination = req.body?.destination ? resolvePath(String(req.body.destination), req.actor) : path.dirname(archivePath);

    if (!existsSync(archivePath)) return res.status(404).json({ error: "Archive file not found" });
    if (!existsSync(destination)) mkdirSync(destination, { recursive: true, mode: 0o755 });

    let extractRes;
    const lowerName = path.basename(archivePath).toLowerCase();

    if (lowerName.endsWith(".zip")) {
      extractRes = await run("unzip", ["-o", archivePath, "-d", destination], { timeout: 300000 });
    } else if (lowerName.endsWith(".tar.gz") || lowerName.endsWith(".tgz")) {
      extractRes = await run("tar", ["-xzf", archivePath, "-C", destination], { timeout: 300000 });
    } else if (lowerName.endsWith(".tar.bz2")) {
      extractRes = await run("tar", ["-xjf", archivePath, "-C", destination], { timeout: 300000 });
    } else if (lowerName.endsWith(".tar")) {
      extractRes = await run("tar", ["-xf", archivePath, "-C", destination], { timeout: 300000 });
    } else {
      return res.status(400).json({ error: "Unsupported archive format (supports .zip, .tar.gz, .tgz, .tar, .tar.bz2)" });
    }

    if (!extractRes.ok) {
      return res.status(500).json({ error: `Extraction failed: ${extractRes.stderr || extractRes.stdout}` });
    }

    audit({ action: "file.extract", actor: req.actor.username, ip: clientIp(req), params: { archive: archivePath, destination } });
    return res.json({ ok: true, destination, message: `Archive extracted into ${destination}` });
  } catch (error) {
    return next(error);
  }
});

// 15. Search Files & Folders
router.get("/search", (req, res, next) => {
  try {
    const query = String(req.query.query || "").trim().toLowerCase();
    const defaultRoot = roots(req.actor)[0] || "/var/www";
    const targetDir = resolvePath(String(req.query.path || defaultRoot), req.actor);
    const recursive = req.query.recursive === "true" || req.query.recursive === "1";

    if (!query) return res.json({ results: [] });
    if (!existsSync(targetDir)) return res.status(404).json({ error: "Directory not found" });

    const results = [];
    const maxResults = 100;

    const walk = (dir, depth = 0) => {
      if (results.length >= maxResults) return;
      if (!recursive && depth > 0) return;
      if (depth > 6) return;

      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith(".") && !query.startsWith(".")) continue;
          const full = path.join(dir, entry.name);

          if (entry.name.toLowerCase().includes(query)) {
            let stat = null;
            try { stat = lstatSync(full); } catch {}
            results.push({
              name: entry.name,
              path: full,
              kind: entry.isDirectory() ? "directory" : "file",
              size: stat?.size ?? 0,
              modified: stat?.mtime?.toISOString() ?? null,
              mode: stat ? (stat.mode & 0o777).toString(8).padStart(4, "0") : "0644",
            });
          }

          if (entry.isDirectory() && recursive && results.length < maxResults) {
            walk(full, depth + 1);
          }
        }
      } catch {}
    };

    walk(targetDir, 0);
    return res.json({ query, path: targetDir, results });
  } catch (error) {
    return next(error);
  }
});

// 16. Stream / Direct Preview
router.get("/preview", (req, res, next) => {
  try {
    const target = resolvePath(String(req.query.path || ""), req.actor);
    if (!existsSync(target)) return res.status(404).json({ error: "Not found" });

    const info = statSync(target);
    if (info.isDirectory()) return res.status(400).json({ error: "Cannot preview directories" });

    const ext = path.extname(target).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", info.size);
    res.setHeader("Cache-Control", "public, max-age=3600");

    const stream = createReadStream(target);
    stream.pipe(res);
  } catch (error) {
    return next(error);
  }
});

// 17. Multi-File Upload
router.post("/upload", upload.any(), (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: "No files received" });

    const defaultRoot = roots(req.actor)[0] || "/var/www";
    const directory = resolvePath(String(req.body?.path || defaultRoot), req.actor);
    if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o755 });

    const uploadedPaths = [];
    for (const f of files) {
      const destination = path.join(directory, f.originalname.replace(/[/\\]/g, "_"));
      if (existsSync(destination)) unlinkSync(destination);
      renameSync(f.path, destination);
      uploadedPaths.push(destination);
    }

    // Set ownership to www-data if inside /var/www
    if (directory.startsWith("/var/www")) {
      run("chown", ["-R", "www-data:www-data", ...uploadedPaths]).catch(() => {});
    }

    audit({ action: "file.upload", actor: req.actor.username, ip: clientIp(req), params: { count: files.length, directory } });
    return res.status(201).json({ ok: true, count: files.length, paths: uploadedPaths, message: `Uploaded ${files.length} file(s)` });
  } catch (error) {
    if (req.files) {
      for (const f of req.files) {
        if (f.path && existsSync(f.path)) try { unlinkSync(f.path); } catch {}
      }
    }
    return next(error);
  }
});

// 18. Download File or Folder
router.get("/download", async (req, res, next) => {
  try {
    const target = resolvePath(String(req.query.path || ""), req.actor);
    if (!existsSync(target)) return res.status(404).json({ error: "Not found" });

    const info = statSync(target);
    if (info.isDirectory()) {
      // Create temporary zip on the fly
      const zipName = `${path.basename(target)}.zip`;
      const tempZip = `/tmp/axon-download-${Date.now()}-${zipName}`;
      const zipRes = await run("zip", ["-r", tempZip, "."], { cwd: target, timeout: 300000 });

      if (!zipRes.ok || !existsSync(tempZip)) {
        return res.status(500).json({ error: "Failed to create download archive" });
      }

      res.download(tempZip, zipName, () => {
        try { unlinkSync(tempZip); } catch {}
      });
      return;
    }

    return res.download(target, path.basename(target));
  } catch (error) {
    return next(error);
  }
});

export default router;
