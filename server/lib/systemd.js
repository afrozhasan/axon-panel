import { run } from "./exec.js";
import { isProtectedUnit } from "./validate.js";

export const SERVICE_ACTIONS = ["start", "stop", "restart", "reload", "enable", "disable"];

export async function unitStates(units) {
  const result = await run("systemctl", ["is-active", ...units], { timeout: 15000 });
  const lines = (result.stdout || "").trim().split("\n");
  const states = {};
  units.forEach((unit, index) => {
    states[unit] = (lines[index] || "unknown").trim();
  });
  return states;
}

export async function unitEnabledStates(units) {
  const result = await run("systemctl", ["is-enabled", ...units], { timeout: 15000 });
  const lines = (result.stdout || "").trim().split("\n");
  const states = {};
  units.forEach((unit, index) => {
    states[unit] = (lines[index] || "unknown").trim();
  });
  return states;
}

export async function listUnits() {
  const [unitsResult, filesResult] = await Promise.all([
    run("systemctl", ["list-units", "--type=service", "--all", "--no-pager", "--plain", "--output=json"], {
      timeout: 25000,
      maxBuffer: 8 * 1024 * 1024,
    }),
    run("systemctl", ["list-unit-files", "--type=service", "--no-pager", "--plain", "--output=json"], {
      timeout: 25000,
      maxBuffer: 8 * 1024 * 1024,
    }),
  ]);

  let units = [];
  if (unitsResult.ok) {
    try {
      units = JSON.parse(unitsResult.stdout.trim() || "[]").map((unit) => ({
        unit: unit.unit,
        load: unit.load,
        active: unit.active,
        sub: unit.sub,
        description: unit.description,
      }));
    } catch {
      units = parseUnitLines(unitsResult.stdout);
    }
  }

  const enabledMap = {};
  if (filesResult.ok) {
    try {
      for (const entry of JSON.parse(filesResult.stdout.trim() || "[]")) {
        enabledMap[entry.unit_file] = entry.state;
      }
    } catch {
      /* enabled state is best-effort */
    }
  }

  return units
    .map((unit) => ({
      ...unit,
      enabled: enabledMap[unit.unit] || "unknown",
      protected: isProtectedUnit(unit.unit),
    }))
    .sort((a, b) => a.unit.localeCompare(b.unit));
}

function parseUnitLines(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.replace(/^[●•*]\s*/, "").trim())
    .filter((line) => line.includes(".service"))
    .map((line) => {
      const cols = line.split(/\s+/);
      return {
        unit: cols[0],
        load: cols[1],
        active: cols[2],
        sub: cols[3],
        description: cols.slice(4).join(" "),
      };
    });
}

export async function controlUnit(action, unit) {
  return run("systemctl", [action, unit], { timeout: 60000 });
}

export async function unitLogs(unit, lines = 200) {
  const safeLines = Math.min(Math.max(Number(lines) || 200, 1), 2000);
  return run("journalctl", ["-u", unit, "-n", String(safeLines), "--no-pager", "-o", "short-iso"], {
    timeout: 25000,
    maxBuffer: 8 * 1024 * 1024,
  });
}
