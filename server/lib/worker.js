import { getDb } from "./db.js";
import { getTask, updateTask, appendTaskLog, taskEvents } from "./queue.js";

const handlers = new Map();
let runningCount = 0;
const MAX_CONCURRENT = 2; // Keep low for 1-2 GB RAM compliance
let pollingTimer = null;
let isShuttingDown = false;

export function registerTaskHandler(type, handler) {
  handlers.set(type, handler);
}

export function startWorker({ intervalMs = 2000 } = {}) {
  if (pollingTimer) return;

  const poll = async () => {
    if (isShuttingDown) return;
    try {
      while (runningCount < MAX_CONCURRENT) {
        const nextTask = claimNextTask();
        if (!nextTask) break;
        runTask(nextTask).catch((err) => {
          console.error(`[worker] unexpected error executing task ${nextTask.id}:`, err);
        });
      }
    } catch (err) {
      console.error("[worker] poll error:", err);
    }
  };

  pollingTimer = setInterval(poll, intervalMs);
  taskEvents.on("enqueued", () => {
    setImmediate(poll);
  });

  // Run initial poll
  setImmediate(poll);
}

export function stopWorker() {
  isShuttingDown = true;
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

function claimNextTask() {
  const db = getDb();
  // Atomically claim the oldest pending task
  const row = db.prepare(`
    SELECT id, task_type, payload_json, attempts, max_attempts
    FROM tasks
    WHERE status = 'pending'
    ORDER BY scheduled_at ASC
    LIMIT 1
  `).get();

  if (!row) return null;

  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE tasks
    SET status = 'running', started_at = ?, attempts = attempts + 1
    WHERE id = ? AND status = 'pending'
  `).run(now, row.id);

  if (result.changes === 0) {
    // Another worker claimed it
    return null;
  }

  return getTask(row.id);
}

async function runTask(task) {
  runningCount += 1;
  const handler = handlers.get(task.task_type);

  const context = {
    log: (msg) => appendTaskLog(task.id, msg),
    setProgress: (percent) => updateTask(task.id, { progress_percent: Math.min(100, Math.max(0, percent)) }),
    isCancelled: () => {
      const current = getTask(task.id);
      return current?.status === "cancelled";
    },
  };

  context.log(`Task started: ${task.task_type} (${task.id})`);

  try {
    if (!handler) {
      throw new Error(`No worker registered for task type: ${task.task_type}`);
    }

    const result = await handler(task.payload, context);
    const now = new Date().toISOString();

    context.log("Task finished successfully.");
    updateTask(task.id, {
      status: "completed",
      progress_percent: 100,
      completed_at: now,
    });
    taskEvents.emit("task:completed", { id: task.id, result });
  } catch (error) {
    const errorMsg = error?.message || String(error);
    context.log(`Task failed: ${errorMsg}`);

    const current = getTask(task.id);
    const canRetry = current.attempts < current.max_attempts;

    if (canRetry && current.status !== "cancelled") {
      context.log(`Will retry (attempt ${current.attempts}/${current.max_attempts})...`);
      updateTask(task.id, {
        status: "pending",
        error_message: errorMsg,
      });
    } else {
      updateTask(task.id, {
        status: "failed",
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      });
      taskEvents.emit("task:failed", { id: task.id, error: errorMsg });
    }
  } finally {
    runningCount = Math.max(0, runningCount - 1);
  }
}
