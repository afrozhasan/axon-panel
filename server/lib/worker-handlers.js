import { registerTaskHandler } from "./worker.js";
import { run } from "./exec.js";
import { createSnapshot, restoreSnapshot } from "./restic.js";
import { executeAstroProvision, executeAstroRebuild } from "./astro-engine.js";
import { existsSync } from "node:fs";
import path from "node:path";

export function initWorkerHandlers() {
  // 1. App Build Handler
  registerTaskHandler("app.build", async (payload, context) => {
    const { siteName, docroot } = payload;
    if (!docroot || !existsSync(docroot)) {
      throw new Error(`Document root does not exist: ${docroot}`);
    }

    context.log(`Starting build for site: ${siteName}`);
    context.setProgress(10);

    const hasPnpm = existsSync(path.join(docroot, "pnpm-lock.yaml"));
    const hasYarn = existsSync(path.join(docroot, "yarn.lock"));
    const pkgManager = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";

    // Install dependencies if node_modules missing
    if (!existsSync(path.join(docroot, "node_modules"))) {
      context.log(`Installing dependencies using ${pkgManager}...`);
      context.setProgress(25);
      const installRes = await run(pkgManager, ["install"], {
        cwd: docroot,
        timeout: 300000,
      });
      context.log(installRes.stdout || installRes.stderr || "Dependencies installed");
      if (!installRes.ok) {
        throw new Error(`Dependency installation failed: ${installRes.stderr.slice(0, 500)}`);
      }
    }

    context.log("Running production build script...");
    context.setProgress(50);

    const buildRes = await run(pkgManager, ["run", "build"], {
      cwd: docroot,
      timeout: 300000,
    });

    context.log(buildRes.stdout || buildRes.stderr || "Build completed");
    if (!buildRes.ok) {
      throw new Error(`Build failed: ${buildRes.stderr.slice(0, 800)}`);
    }

    context.setProgress(90);
    context.log("Build succeeded. Artifacts are ready.");
    return { ok: true, output: buildRes.stdout.slice(0, 1000) };
  });

  // 2. Git Pull Handler
  registerTaskHandler("git.pull", async (payload, context) => {
    const { docroot } = payload;
    if (!docroot || !existsSync(docroot)) {
      throw new Error(`Document root does not exist: ${docroot}`);
    }

    context.log("Executing git pull origin...");
    context.setProgress(30);

    const pullRes = await run("git", ["-C", docroot, "pull"], {
      timeout: 120000,
    });

    context.log(pullRes.stdout || pullRes.stderr || "Git pull executed");
    if (!pullRes.ok) {
      throw new Error(`Git pull failed: ${pullRes.stderr.slice(0, 500)}`);
    }

    context.setProgress(100);
    return { ok: true, output: pullRes.stdout };
  });

  // 3. Restic Backup Snapshot Handler
  registerTaskHandler("backup.snapshot", async (payload, context) => {
    context.log("Initializing Restic backup snapshot...");
    context.setProgress(20);

    const { paths = ["/var/www", "/etc/nginx/sites-available"], tags = ["axon-backup"] } = payload;
    context.log(`Target paths: ${paths.join(", ")}`);
    context.setProgress(40);

    const res = await createSnapshot({ paths, tags });
    context.log("Restic snapshot created successfully.");
    context.setProgress(100);
    return { ok: true, output: res.output };
  });

  // 4. Restic Restore Handler
  registerTaskHandler("backup.restore", async (payload, context) => {
    const { snapshotId, targetPath = "/tmp/axon-restore" } = payload;
    context.log(`Restoring snapshot ${snapshotId} to ${targetPath}...`);
    context.setProgress(30);

    const res = await restoreSnapshot(snapshotId, targetPath);
    context.log(`Restore completed at ${res.targetPath}`);
    context.setProgress(100);
    return { ok: true, targetPath: res.targetPath };
  });

  // 5. Astro Project Provision Handler
  registerTaskHandler("astro.provision", async (payload, context) => {
    return executeAstroProvision(payload, context);
  });

  // 6. Astro Project Rebuild Handler
  registerTaskHandler("astro.rebuild", async (payload, context) => {
    return executeAstroRebuild(payload, context);
  });
}
