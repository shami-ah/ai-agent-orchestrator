// ============================================================
// StateMachine — Enforces valid Task status transitions
// Prevents illegal state jumps (e.g. created → completed).
// ============================================================

import type { Task, TaskStatus } from "../types/index.js";

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  created: ["planned", "cancelled"],
  planned: ["pending_approval", "in_progress", "cancelled"],
  pending_approval: ["in_progress", "cancelled"],
  in_progress: ["validating", "completed", "failed"],
  validating: ["completed", "failed", "in_progress"],
  failed: ["in_progress", "cancelled"],
  completed: [],
  cancelled: [],
} as const;

export class StateMachine {
  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    const allowed = VALID_TRANSITIONS[from];
    return allowed.includes(to);
  }

  transition(task: Task, newStatus: TaskStatus): Task {
    if (!this.canTransition(task.status, newStatus)) {
      throw new Error(
        `Invalid transition: ${task.status} → ${newStatus} (task ${task.id})`,
      );
    }

    return {
      ...task,
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
  }
}
