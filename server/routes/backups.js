import { Router } from "express";
import { listSnapshots, createSnapshot, restoreSnapshot, forgetSnapshots, isRepoInitialized } from "../lib/restic.js";
import { enqueueTask } from "../lib/queue.js";
import { audit } from "../lib/audit.js";
import { clientIp } from "../middleware/auth.js";

const router = Router();

router.get("/status", async (_req, res, next) => {
  try {
    const initialized = await isRepoInitialized().catch(() => false);
    const snapshots = initialized ? await listSnapshots().catch(() => []) : [];
    res.json({
      engine: "restic",
      initialized,
      repo: "/root/backups/restic-repo",
      snapshotsCount: snapshots.length,
      latestSnapshot: snapshots[0] || null,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/snapshots", async (_req, res, next) => {
  try {
    const snapshots = await listSnapshots();
    res.json({ snapshots });
  } catch (error) {
    next(error);
  }
});

router.post("/create", async (req, res, next) => {
  try {
    const { paths = ["/var/www", "/etc/nginx/sites-available"], tags = ["axon-backup"] } = req.body ?? {};

    const task = enqueueTask({
      taskType: "backup.snapshot",
      payload: { paths, tags },
      userId: req.actor?.id || null,
    });

    audit({
      action: "backup.snapshot.enqueued",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { taskId: task.id, paths },
    });

    res.status(202).json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

router.post("/restore", async (req, res, next) => {
  try {
    const { snapshotId, targetPath = "/tmp/axon-restore" } = req.body ?? {};
    if (!snapshotId) return res.status(400).json({ error: "Snapshot ID required" });

    const task = enqueueTask({
      taskType: "backup.restore",
      payload: { snapshotId, targetPath },
      userId: req.actor?.id || null,
    });

    audit({
      action: "backup.restore.enqueued",
      actor: req.actor.username,
      ip: clientIp(req),
      params: { taskId: task.id, snapshotId, targetPath },
    });

    res.status(202).json({ ok: true, task });
  } catch (error) {
    next(error);
  }
});

router.post("/prune", async (req, res, next) => {
  try {
    const { keepDaily = 7, keepWeekly = 4 } = req.body ?? {};
    const result = await forgetSnapshots({ keepDaily, keepWeekly, prune: true });
    audit({ action: "backup.prune", actor: req.actor.username, ip: clientIp(req) });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
