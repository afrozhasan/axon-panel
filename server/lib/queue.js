import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";

export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(50);

export function enqueueTask({
  taskType,
  payload = {},
  organizationId = "org_default",
  userId = null,
  maxAttempts = 3,
}) {
  const db = getDb();
  const id = `task_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const payloadJson = JSON.stringify(payload);

  db.prepare(`
    INSERT INTO tasks (id, organization_id, user_id, task_type, status, payload_json, progress_percent, logs, attempts, max_attempts)
    VALUES (?, ?, ?, ?, 'pending', ?, 0, '', 0, ?)
  `).run(id, organizationId, userId, taskType, payloadJson, maxAttempts);

  const task = getTask(id);
  taskEvents.emit("enqueued", task);
  return task;
}

export function getTask(taskId) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!row) return null;
  return {
    ...row,
    payload: safeJsonParse(row.payload_json, {}),
  };
}

export function listTasks({ limit = 50, status = null, organizationId = null } = {}) {
  const db = getDb();
  let query = "SELECT * FROM tasks WHERE 1=1";
  const params = [];

  if (status) {
    query += " AND status = ?";
    params.push(status);
  }
  if (organizationId) {
    query += " AND organization_id = ?";
    params.push(organizationId);
  }

  query += " ORDER BY scheduled_at DESC LIMIT ?";
  params.push(limit);

  return db.prepare(query).all(...params).map((row) => ({
    ...row,
    payload: safeJsonParse(row.payload_json, {}),
  }));
}

export function updateTask(taskId, updates = {}) {
  const db = getDb();
  const fields = [];
  const params = [];

  for (const [key, val] of Object.entries(updates)) {
    if (key === "payload") {
      fields.push("payload_json = ?");
      params.push(JSON.stringify(val));
    } else if (["status", "progress_percent", "logs", "error_message", "attempts", "started_at", "completed_at"].includes(key)) {
      fields.push(`${key} = ?`);
      params.push(val);
    }
  }

  if (fields.length === 0) return getTask(taskId);

  params.push(taskId);
  db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);

  const updated = getTask(taskId);
  taskEvents.emit("updated", updated);
  taskEvents.emit(`task:${taskId}`, updated);
  return updated;
}

export function appendTaskLog(taskId, line) {
  const db = getDb();
  const timestamp = new Date().toISOString().slice(11, 19);
  const formatted = `[${timestamp}] ${line}\n`;
  db.prepare("UPDATE tasks SET logs = COALESCE(logs, '') || ? WHERE id = ?").run(formatted, taskId);
  taskEvents.emit(`task:${taskId}:log`, formatted);
}

export function cancelTask(taskId) {
  return updateTask(taskId, { status: "cancelled", completed_at: new Date().toISOString() });
}

function safeJsonParse(str, fallback = {}) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}
