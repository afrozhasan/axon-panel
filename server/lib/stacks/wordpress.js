import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../exec.js";

export function isWordPress(docroot) {
  if (!docroot || !existsSync(docroot)) return false;
  return existsSync(path.join(docroot, "wp-config.php")) || existsSync(path.join(docroot, "wp-settings.php"));
}

export async function runWpCli(docroot, args = [], options = {}) {
  const fullArgs = ["--allow-root", `--path=${docroot}`, ...args];
  return run("wp", fullArgs, {
    timeout: options.timeout || 60000,
    cwd: docroot,
    env: { ...process.env, HOME: "/root" },
  });
}

export async function getWpOverview(docroot) {
  if (!isWordPress(docroot)) {
    return { installed: false };
  }

  const [versionRes, pluginsRes, themesRes, updateRes] = await Promise.all([
    runWpCli(docroot, ["core", "version"]).catch(() => ({ ok: false, stdout: "unknown" })),
    runWpCli(docroot, ["plugin", "list", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["theme", "list", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
    runWpCli(docroot, ["core", "check-update", "--format=json"]).catch(() => ({ ok: false, stdout: "[]" })),
  ]);

  let plugins = [];
  try {
    plugins = JSON.parse(pluginsRes.stdout || "[]");
  } catch {}

  let themes = [];
  try {
    themes = JSON.parse(themesRes.stdout || "[]");
  } catch {}

  let updates = [];
  try {
    updates = JSON.parse(updateRes.stdout || "[]");
  } catch {}

  const configPath = path.join(docroot, "wp-config.php");
  const configContent = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";

  return {
    installed: true,
    version: versionRes.stdout.trim(),
    updateAvailable: Array.isArray(updates) && updates.length > 0 ? updates[0].version : null,
    pluginsCount: plugins.length,
    activePlugins: plugins.filter((p) => p.status === "active").length,
    plugins,
    themes,
    activeTheme: themes.find((t) => t.status === "active")?.name || null,
    security: {
      disallowFileEdit: /define\s*\(\s*['"]DISALLOW_FILE_EDIT['"]\s*,\s*true\s*\)/i.test(configContent),
      debugDisabled: /define\s*\(\s*['"]WP_DEBUG['"]\s*,\s*false\s*\)/i.test(configContent),
      tablePrefix: (configContent.match(/\$table_prefix\s*=\s*['"]([^'"]+)['"]/i) || [])[1] || "wp_",
    },
  };
}

export async function toggleWpPlugin(docroot, pluginName, activate = true) {
  const action = activate ? "activate" : "deactivate";
  const result = await runWpCli(docroot, ["plugin", action, pluginName]);
  if (!result.ok) throw new Error(result.stderr || `Failed to ${action} plugin ${pluginName}`);
  return { ok: true, output: result.stdout.trim() };
}

export async function updateWpPlugin(docroot, pluginName) {
  const result = await runWpCli(docroot, ["plugin", "update", pluginName]);
  if (!result.ok) throw new Error(result.stderr || `Failed to update plugin ${pluginName}`);
  return { ok: true, output: result.stdout.trim() };
}

export async function applyWpHardening(docroot) {
  const configPath = path.join(docroot, "wp-config.php");
  if (!existsSync(configPath)) {
    throw new Error("wp-config.php not found");
  }

  let content = readFileSync(configPath, "utf8");
  if (!/DISALLOW_FILE_EDIT/i.test(content)) {
    content = content.replace("<?php", "<?php\ndefine('DISALLOW_FILE_EDIT', true);\ndefine('WP_POST_REVISIONS', 5);");
    writeFileSync(configPath, content, { mode: 0o600 });
  }

  return { ok: true, message: "WordPress hardening rules applied" };
}

export async function optimizeWpDatabase(docroot) {
  const result = await runWpCli(docroot, ["db", "optimize"]);
  if (!result.ok) throw new Error(result.stderr || "Database optimize failed");
  return { ok: true, output: result.stdout.trim() };
}
