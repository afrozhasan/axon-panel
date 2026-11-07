import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run } from "../exec.js";

export function isNodeApp(docroot) {
  if (!docroot || !existsSync(docroot)) return false;
  return existsSync(path.join(docroot, "package.json"));
}

export function isNextJs(docroot) {
  if (!isNodeApp(docroot)) return false;
  try {
    const pkg = JSON.parse(readFileSync(path.join(docroot, "package.json"), "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    return "next" in deps;
  } catch {
    return false;
  }
}

export async function getNodeOverview(docroot) {
  if (!isNodeApp(docroot)) {
    return { isNode: false };
  }

  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(docroot, "package.json"), "utf8"));
  } catch {}

  const next = isNextJs(docroot);
  const lockfile = existsSync(path.join(docroot, "pnpm-lock.yaml"))
    ? "pnpm"
    : existsSync(path.join(docroot, "yarn.lock"))
      ? "yarn"
      : "npm";

  return {
    isNode: true,
    isNextJs: next,
    name: pkg.name || "node-app",
    version: pkg.version || "1.0.0",
    packageManager: lockfile,
    scripts: pkg.scripts || {},
    main: pkg.main || (next ? ".next/standalone/server.js" : "index.js"),
    nodeModulesExist: existsSync(path.join(docroot, "node_modules")),
  };
}

export function generateNodeSystemdUnit({ siteName, docroot, port, startCommand = "node index.js", env = {} }) {
  const envLines = Object.entries(env)
    .map(([k, v]) => `Environment="${k}=${v}"`)
    .join("\n");

  const [bin, ...args] = startCommand.split(/\s+/);
  const resolvedBin = bin === "npm" ? "/usr/bin/npm" : bin === "node" ? "/usr/bin/node" : bin;

  return `[Unit]
Description=Axon Panel Node App: ${siteName}
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=${docroot}
Environment="NODE_ENV=production"
Environment="PORT=${port}"
${envLines}
ExecStart=${resolvedBin} ${args.join(" ")}
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
`;
}
