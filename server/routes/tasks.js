import { Router } from "express";
import { getTask, listTasks, cancelTask, taskEvents } from "../lib/queue.js";
import { assertResourceAccess } from "../lib/rbac.js";

const router = Router();

router.get("/", (req, res) => {
  const { status, limit } = req.query;
  const orgId = req.actor?.role === "super_admin" || req.actor?.role === "server_admin" ? null : req.actor?.orgId;
  const tasks = listTasks({
    status: status ? String(status) : null,
    limit: limit ? Number(limit) : 50,
    organizationId: orgId,
  });
  res.json({ tasks });
});

router.get("/:id", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  assertResourceAccess(req, task.organization_id);
  res.json({ task });
});

router.post("/:id/cancel", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  assertResourceAccess(req, task.organization_id);
  const updated = cancelTask(req.params.id);
  res.json({ task: updated });
});

router.get("/:id/stream", (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });
  assertResourceAccess(req, task.organization_id);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Send initial snapshot
  res.write(`data: ${JSON.stringify({ type: "snapshot", task })}\n\n`);

  const onUpdate = (updated) => {
    res.write(`data: ${JSON.stringify({ type: "update", task: updated })}\n\n`);
    if (["completed", "failed", "cancelled"].includes(updated.status)) {
      cleanup();
      res.end();
    }
  };

  const onLog = (chunk) => {
    res.write(`data: ${JSON.stringify({ type: "log", chunk })}\n\n`);
  };

  taskEvents.on(`task:${task.id}`, onUpdate);
  taskEvents.on(`task:${task.id}:log`, onLog);

  const cleanup = () => {
    taskEvents.off(`task:${task.id}`, onUpdate);
    taskEvents.off(`task:${task.id}:log`, onLog);
  };

  req.on("close", cleanup);
});

export default router;
