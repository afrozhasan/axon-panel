import { readFileSync } from "node:fs";
import os from "node:os";
import { run } from "./exec.js";

let previousCpu = null;

export function serverIp() {
  let ipv4 = process.env.SERVER_IPV4 || "";
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.internal) continue;
        if (net.family === "IPv4" && !ipv4) {
          ipv4 = net.address;
        }
      }
    }
  } catch {}
  return ipv4 || "127.0.0.1";
}

function readCpuTimes() {
  const line = readFileSync("/proc/stat", "utf8").split("\n")[0];
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  const [user, nice, system, idle, iowait, irq, softirq, steal] = parts;
  const idleTotal = idle + iowait;
  const total = user + nice + system + idle + iowait + irq + softirq + steal;
  return { idle: idleTotal, total };
}

export function cpuUsage() {
  const current = readCpuTimes();
  if (!previousCpu) {
    previousCpu = current;
    return { percent: 0, cores: readCores() };
  }
  const idleDelta = current.idle - previousCpu.idle;
  const totalDelta = current.total - previousCpu.total;
  previousCpu = current;
  const percent = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
  return { percent: Number(percent.toFixed(1)), cores: readCores() };
}

function readCores() {
  return readFileSync("/proc/cpuinfo", "utf8").split("\n").filter((l) => l.startsWith("processor")).length;
}

export function memoryUsage() {
  const info = Object.fromEntries(
    readFileSync("/proc/meminfo", "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [key, rest] = line.split(":");
        return [key.trim(), Number(rest.trim().split(/\s+/)[0]) * 1024];
      }),
  );

  const total = info.MemTotal || 0;
  const available = info.MemAvailable || 0;
  const used = total - available;
  const swapTotal = info.SwapTotal || 0;
  const swapUsed = swapTotal - (info.SwapFree || 0);

  return {
    total,
    used,
    available,
    percent: total ? Number(((used / total) * 100).toFixed(1)) : 0,
    swapTotal,
    swapUsed,
    swapPercent: swapTotal ? Number(((swapUsed / swapTotal) * 100).toFixed(1)) : 0,
  };
}

export function loadAverage() {
  const [one, five, fifteen] = readFileSync("/proc/loadavg", "utf8").trim().split(/\s+/);
  return { one: Number(one), five: Number(five), fifteen: Number(fifteen) };
}

export function uptimeSeconds() {
  return Math.floor(Number(readFileSync("/proc/uptime", "utf8").split(/\s+/)[0]));
}

export function networkUsage() {
  const lines = readFileSync("/proc/net/dev", "utf8").split("\n").slice(2).filter(Boolean);
  const interfaces = [];
  for (const line of lines) {
    const [namePart, rest] = line.split(":");
    const name = namePart.trim();
    if (name === "lo") continue;
    const cols = rest.trim().split(/\s+/).map(Number);
    interfaces.push({ name, rxBytes: cols[0], txBytes: cols[8] });
  }
  return interfaces;
}

export async function diskUsage() {
  const result = await run("df", ["-P", "-B1"], { timeout: 10000 });
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const cols = line.trim().split(/\s+/);
      const [filesystem, size, used, available, percent, ...mountParts] = cols;
      const mount = mountParts.join(" ");
      return {
        filesystem,
        size: Number(size),
        used: Number(used),
        available: Number(available),
        percent: Number(String(percent).replace("%", "")),
        mount,
      };
    })
    .filter((d) => d.filesystem.startsWith("/") && !d.mount.startsWith("/snap"));
}

export async function collect() {
  const [disk] = await Promise.all([diskUsage()]);
  return {
    at: new Date().toISOString(),
    hostname: readFileSync("/proc/sys/kernel/hostname", "utf8").trim(),
    ip: serverIp(),
    cpu: cpuUsage(),
    memory: memoryUsage(),
    load: loadAverage(),
    uptimeSeconds: uptimeSeconds(),
    disks: disk,
    network: networkUsage(),
  };
}
