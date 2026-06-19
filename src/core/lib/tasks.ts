import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { setProperties, setProperty } from "./persist.js";

export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "done" | "cancelled" | "declined";
export type TaskKey = "email" | "website_url" | "name" | "record_id";

export interface CreateTaskArgs {
  title: string;
  task_type: string;
  assigned_to?: string;
  priority?: TaskPriority;
  due_date?: string;
  notes?: string;
  custom_key_name?: TaskKey;
  custom_key_value?: string;
  project?: string;
  created_by: string;
}

export interface CreatedTask {
  task_id: string;
}

/**
 * Create a Task record in the Personize tasks collection. Returns the task_id
 * so the caller can reference it (e.g. in workspace.updates details).
 *
 * Failure mode: logs a warning and returns null. Task-creation failures should
 * not crash the calling operation — the caller should decide whether the
 * missing task is acceptable.
 */
export async function createTask(args: CreateTaskArgs): Promise<CreatedTask | null> {
  const taskId = `t_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;

  const properties = {
    task_id: taskId,
    title: args.title,
    status: "open" as TaskStatus,
    priority: args.priority ?? "medium",
    task_type: args.task_type,
    assigned_to: args.assigned_to ?? "agent",
    ...(args.due_date ? { due_date: args.due_date } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
    ...(args.custom_key_name ? { custom_key_name: args.custom_key_name } : {}),
    ...(args.custom_key_value ? { custom_key_value: args.custom_key_value } : {}),
    ...(args.project ? { project: args.project } : {}),
    created_by: args.created_by,
    created_at: new Date().toISOString(),
  };

  try {
    await setProperties({ type: "task", collection: "tasks", recordId: taskId }, properties);
    return { task_id: taskId };
  } catch (error) {
    logger.warn("Failed to create task", {
      task_type: args.task_type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface CompleteTaskArgs {
  task_id: string;
  status: "done" | "cancelled" | "declined";
  outcome?: string;
  completed_by: string;
}

/**
 * Mark a task as completed. Updates status, completed_at, completed_by, outcome.
 */
export async function completeTask(args: CompleteTaskArgs): Promise<void> {
  const completedAt = new Date().toISOString();
  try {
    for (const [propertyName, value] of Object.entries({
      status: args.status,
      completed_at: completedAt,
      completed_by: args.completed_by,
      ...(args.outcome ? { outcome: args.outcome } : {}),
    })) {
      await setProperty({ type: "task", recordId: args.task_id }, propertyName, value);
    }
  } catch (error) {
    logger.warn("Failed to complete task", {
      task_id: args.task_id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
