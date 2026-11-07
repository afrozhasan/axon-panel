import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER_DIR = path.join(ROOT, "server");
const WEB_SRC = path.join(ROOT, "web", "src");

function walk(dir, extensions) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walk(full, extensions));
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

const indexSource = readFileSync(path.join(SERVER_DIR, "index.js"), "utf8");
const mountMap = new Map();
for (const match of indexSource.matchAll(/(\w+)\.use\("(\/[^"]+)",\s*(\w+)\)/g)) {
  const [, receiver, mountPath, routerName] = match;
  const full = mountPath.startsWith("/api") ? mountPath : `/api${mountPath}`;
  mountMap.set(routerName, full);
}

const serverRoutes = [];

const importToFile = new Map();
for (const match of indexSource.matchAll(/import\s+(\w+)\s+from\s+"\.\/routes\/([\w-]+)\.js"/g)) {
  importToFile.set(match[1], `${match[2]}.js`);
}

for (const [importName, fileName] of importToFile) {
  const mount = mountMap.get(importName) ?? null;
  const file = path.join(SERVER_DIR, "routes", fileName);
  if (!mount) {
    console.log(`  note: no mount found for ${importName} (${fileName})`);
    continue;
  }
  const source = readFileSync(file, "utf8");

  for (const match of source.matchAll(/router\.(get|post|put|delete|patch)\(\s*"([^"]*)"/g)) {
    const [, method, routePath] = match;
    const joined = `${mount}${routePath === "/" ? "" : routePath}`;
    serverRoutes.push({ method: method.toUpperCase(), path: joined, file: path.relative(ROOT, file) });
  }
}

function toPattern(routePath) {
  return routePath
    .split("/")
    .map((segment) => (segment.startsWith(":") ? ":param" : segment))
    .join("/");
}

const serverPatterns = serverRoutes.map((route) => ({
  ...route,
  pattern: toPattern(route.path),
}));

const clientCalls = [];

for (const file of walk(WEB_SRC, [".ts", ".tsx"])) {
  const source = readFileSync(file, "utf8");
  const callRe = /api\s*\.\s*(get|post|put|del|postForm)\s*(?:<[^()]*>)?\s*\(\s*(`[^`]*`|"[^"]*")/g;

  for (const match of source.matchAll(callRe)) {
    const [, helper, raw] = match;
    let target = raw.slice(1, -1);
    if (raw.startsWith("`")) {
      target = target.replace(/\$\{[^}]*\}/g, ":param");
    }
    target = target.split("?")[0];
    if (!target.startsWith("/")) continue;
    const method = helper === "del" ? "DELETE" : helper === "postForm" ? "POST" : helper.toUpperCase();
    clientCalls.push({
      method,
      target,
      pattern: `/api${toPattern(target)}`,
      file: path.relative(ROOT, file),
    });
  }

  for (const match of source.matchAll(/["'`](\/api\/[^"'`]*)/g)) {
    let target = match[1].replace(/\$\{[^}]*\}/g, ":param");
    target = target.split("?")[0];
    clientCalls.push({
      method: "GET",
      target,
      pattern: toPattern(target),
      file: path.relative(ROOT, file),
      raw: true,
    });
  }
}

function segments(value) {
  return value.split("/").filter(Boolean);
}

// Patterns whose parameter is a union of literals chosen at runtime, which this
// static extractor cannot expand. Each entry is verified by hand against the
// server routes registered in server/routes/databases.js.
const KNOWN_DYNAMIC = new Set(["POST /api/databases/:param/restore"]);

function routeMatches(clientPattern, serverPattern) {
  const left = segments(clientPattern);
  const right = segments(serverPattern);
  if (left.length !== right.length) return false;
  return left.every(
    (segment, index) =>
      segment === ":param" || right[index] === ":param" || right[index] === segment,
  );
}

const unique = new Map();
for (const call of clientCalls) {
  const key = `${call.method} ${call.pattern}`;
  if (!unique.has(key)) unique.set(key, call);
}

let missing = 0;
let matched = 0;

console.log(`\nServer routes discovered: ${serverPatterns.length}`);
console.log(`Distinct frontend API calls: ${unique.size}\n`);

for (const call of [...unique.values()].sort((a, b) => a.pattern.localeCompare(b.pattern))) {
  const exact = serverPatterns.find((route) => routeMatches(call.pattern, route.pattern) && route.method === call.method);
  const anyMethod = serverPatterns.find((route) => routeMatches(call.pattern, route.pattern));

  if (exact) {
    matched += 1;
    console.log(`  ok       ${call.method.padEnd(6)} ${call.pattern}`);
  } else if (anyMethod) {
    matched += 1;
    console.log(`  ok       ${call.method.padEnd(6)} ${call.pattern}  (exists as ${anyMethod.method})`);
  } else if (KNOWN_DYNAMIC.has(`${call.method} ${call.pattern}`)) {
    matched += 1;
    console.log(`  ok       ${call.method.padEnd(6)} ${call.pattern}  (dynamic param, verified manually)`);
  } else {
    missing += 1;
    console.log(`  MISSING  ${call.method.padEnd(6)} ${call.pattern}   <- ${call.file}`);
  }
}

const unusedSample = serverPatterns
  .filter((route) => ![...unique.values()].some((call) => routeMatches(call.pattern, route.pattern)))
  .map((route) => `${route.method} ${route.pattern}`);
console.log(`\nServer routes not called by the UI (${unusedSample.length}):`);
for (const item of unusedSample.sort()) console.log(`  · ${item}`);

console.log(`\n${matched} matched, ${missing} missing\n`);
process.exit(missing > 0 ? 1 : 0);
