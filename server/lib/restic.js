import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { run } from "./exec.js";
import { CONFIG_DIR } from "../config.js";

const PASSWORD_FILE = `${CONFIG_DIR}/restic.password`;
const DEFAULT_REPO = "/root/backups/restic-repo";

export function ensurePassword() {
  if (existsSync(PASSWORD_FILE)) {
    return readFileSync(PASSWORD_FILE, "utf8").trim();
  }
  const secret = randomBytes(32).toString("hex");
  writeFileSync(PASSWORD_FILE, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export function getResticEnv(customEnv = {}) {
  const password = ensurePassword();
  return {
    ...process.env,
    RESTIC_PASSWORD: password,
    RESTIC_REPOSITORY: customEnv.repo || process.env.RESTIC_REPOSITORY || DEFAULT_REPO,
    ...(customEnv.awsAccessKeyId ? { AWS_ACCESS_KEY_ID: customEnv.awsAccessKeyId } : {}),
    ...(customEnv.awsSecretAccessKey ? { AWS_SECRET_ACCESS_KEY: customEnv.awsSecretAccessKey } : {}),
  };
}

export async function isRepoInitialized(repo = DEFAULT_REPO, envOpts = {}) {
  const env = getResticEnv({ repo, ...envOpts });
  const result = await run("restic", ["snapshots", "--json"], { env, timeout: 20000 });
  return result.ok;
}

export async function initRepo(repo = DEFAULT_REPO, envOpts = {}) {
  const env = getResticEnv({ repo, ...envOpts });
  if (repo.startsWith("/") && !existsSync(repo)) {
    mkdirSync(repo, { recursive: true, mode: 0o700 });
  }

  const result = await run("restic", ["init", "--json"], { env, timeout: 60000 });
  if (!result.ok) {
    if (result.stderr.includes("already initialized") || result.stdout.includes("already initialized")) {
      return { ok: true, message: "Repository already initialized" };
    }
    throw new Error(result.stderr || result.stdout || "Failed to initialize restic repository");
  }
  return { ok: true, message: "Restic repository initialized successfully" };
}

export async function listSnapshots(repo = DEFAULT_REPO, envOpts = {}) {
  const env = getResticEnv({ repo, ...envOpts });
  const result = await run("restic", ["snapshots", "--json"], { env, timeout: 40000 });
  if (!result.ok) {
    if (result.stderr.includes("Is there a repository") || result.stderr.includes("does not exist")) {
      return [];
    }
    throw new Error(result.stderr || "Failed to list snapshots");
  }

  try {
    const list = JSON.parse(result.stdout || "[]");
    return list.map((item) => ({
      id: item.short_id || item.id?.slice(0, 8),
      fullId: item.id,
      time: item.time,
      paths: item.paths || [],
      tags: item.tags || [],
      hostname: item.hostname,
      username: item.username,
    }));
  } catch {
    return [];
  }
}

export async function createSnapshot({
  paths = ["/var/www", "/etc/nginx/sites-available"],
  tags = ["axon"],
  repo = DEFAULT_REPO,
  envOpts = {},
} = {}) {
  const initialized = await isRepoInitialized(repo, envOpts);
  if (!initialized) {
    await initRepo(repo, envOpts);
  }

  const env = getResticEnv({ repo, ...envOpts });
  const args = ["backup", "--json", ...paths.map(String)];
  for (const tag of tags) {
    args.push("--tag", tag);
  }

  const result = await run("restic", args, {
    env,
    timeout: 600000, // 10 minutes timeout
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "Backup snapshot creation failed");
  }

  return { ok: true, output: result.stdout };
}

export async function restoreSnapshot(snapshotId, targetPath, { repo = DEFAULT_REPO, envOpts = {} } = {}) {
  if (!snapshotId) throw new Error("Snapshot ID is required");
  if (!targetPath) throw new Error("Target restore directory is required");

  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true, mode: 0o700 });
  }

  const env = getResticEnv({ repo, ...envOpts });
  const result = await run("restic", ["restore", snapshotId, "--target", targetPath], {
    env,
    timeout: 600000,
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `Restore failed for snapshot ${snapshotId}`);
  }

  return { ok: true, targetPath };
}

export async function forgetSnapshots({ keepDaily = 7, keepWeekly = 4, prune = true, repo = DEFAULT_REPO, envOpts = {} } = {}) {
  const env = getResticEnv({ repo, ...envOpts });
  const args = ["forget", "--keep-daily", String(keepDaily), "--keep-weekly", String(keepWeekly)];
  if (prune) args.push("--prune");

  const result = await run("restic", args, { env, timeout: 300000 });
  if (!result.ok) {
    throw new Error(result.stderr || "Forget/prune operation failed");
  }
  return { ok: true, output: result.stdout };
}
