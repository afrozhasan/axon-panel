import { execFile, spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";

export const ALLOWED_BINARIES = new Set([
  "nginx",
  "certbot",
  "systemctl",
  "journalctl",
  "runuser",
  "pm2",
  "mysql",
  "mysqladmin",
  "mariadb",
  "mysqldump",
  "mysqlimport",
  "psql",
  "pg_dump",
  "pg_dumpall",
  "pg_restore",
  "pg_ctlcluster",
  "pg_lsclusters",
  "createdb",
  "dropdb",
  "redis-cli",
  "df",
  "du",
  "lsblk",
  "tar",
  "gzip",
  "gunzip",
  "unzip",
  "zip",
  "cp",
  "mv",
  "restic",
  "curl",
  "php",
  "php8.1",
  "php8.2",
  "php8.3",
  "php8.4",
  "composer",
  "npm",
  "node",
  "pnpm",
  "yarn",
  "wp",
  "git",
  "chown",
  "chmod",
  "find",
  "openssl",
  "hostname",
  "uptime",
  "script",
  "bash",
  "sh",
  "crontab",
  "su",
  "tail",
  "pgrep",
  "apt-get",
  "apt-cache",
  "dpkg",
  "dpkg-query",
  "update-alternatives",
  "add-apt-repository",
  "phpenmod",
  "phpdismod",
  "ufw",
  "fail2ban-client",
  "ss",
  "sshd",
  "cwebp",
  "convert",
]);

export class ExecError extends Error {
  constructor(message, result) {
    super(message);
    this.name = "ExecError";
    this.result = result;
  }
}

export function isAllowed(binary) {
  if (typeof binary !== "string") return false;
  const base = binary.split("/").pop();
  return ALLOWED_BINARIES.has(binary) || ALLOWED_BINARIES.has(base);
}

function assertSafeCall(binary, args) {
  if (!isAllowed(binary)) {
    throw new ExecError(`Binary not permitted: ${String(binary)}`);
  }
  if (!Array.isArray(args)) throw new ExecError("Arguments must be an array");
  for (const arg of args) {
    if (typeof arg !== "string") throw new ExecError("Every argument must be a string");
    if (arg.includes("\0")) throw new ExecError("Arguments may not contain null bytes");
  }
}

export function run(binary, args = [], options = {}) {
  try {
    assertSafeCall(binary, args);
  } catch (error) {
    return Promise.reject(error);
  }
  const {
    timeout = 60000,
    maxBuffer = 16 * 1024 * 1024,
    cwd,
    env,
    input,
    uid,
    gid,
  } = options;

  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = execFile(
      binary,
      args,
      {
        timeout,
        maxBuffer,
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        uid,
        gid,
      },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          signal: error?.signal ?? null,
          timedOut: error?.killed === true && error?.signal === "SIGTERM",
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          binary,
          args,
          durationMs: Date.now() - startedAt,
        });
      },
    );

    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
  });
}

export async function runOrThrow(binary, args = [], options = {}) {
  const result = await run(binary, args, options);
  if (!result.ok) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new ExecError(`${binary} exited with code ${result.code}: ${detail.slice(0, 2000)}`, result);
  }
  return result;
}

export function spawnAllowed(binary, args = [], options = {}) {
  assertSafeCall(binary, args);
  const { cwd, env, uid, gid } = options;
  return spawn(binary, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    shell: false,
    windowsHide: true,
    uid,
    gid,
  });
}

export function firstLines(text, count = 20) {
  return text.split("\n").slice(0, count).join("\n");
}

export function runToFile(binary, args = [], targetPath, options = {}) {
  try {
    assertSafeCall(binary, args);
  } catch (error) {
    return Promise.reject(error);
  }
  const { cwd, env, timeout = 600000, uid, gid } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      windowsHide: true,
      uid,
      gid,
    });
    const output = createWriteStream(targetPath, { mode: 0o600 });

    let stderr = "";
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...payload, stderr, binary, args, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);

    child.stdout.pipe(output);
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, code: -1, stdout: "", error: error.message }));
    output.on("error", (error) => finish({ ok: false, code: -1, stdout: "", error: error.message }));
    child.on("close", (code) => {
      output.end(() => finish({ ok: code === 0, code, stdout: "" }));
    });
  });
}

export function runFromFile(binary, args = [], sourcePath, options = {}) {
  try {
    assertSafeCall(binary, args);
  } catch (error) {
    return Promise.reject(error);
  }
  const { cwd, env, timeout = 600000, uid, gid } = options;

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      windowsHide: true,
      uid,
      gid,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...payload, stdout, stderr, binary, args, durationMs: Date.now() - startedAt });
    };

    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);

    createReadStream(sourcePath).pipe(child.stdin);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => finish({ ok: false, code: -1, error: error.message }));
    child.on("close", (code) => finish({ ok: code === 0, code }));
  });
}
