// ============================================================
// TaskQueue — Priority queue with dependency resolution
// Creates, dequeues, completes, fails, and retries tasks
// using the Store adapter and StateMachine for transitions.
// ============================================================

import { nanoid } from "nanoid";
import type { Task, Store } from "../types/index.js";
import { TaskStatus } from "../types/index.js";
import { StateMachine } from "../core/state-machine.js";

interface EnqueueOptions {
  parentId?: string;
  priority?: number;
  input?: Record<string, unknown>;
  maxRetries?: number;
  dependencies?: string[];
}

export class TaskQueue {
  private readonly store: Store;
  private readonly sm: StateMachine;

  constructor(store: Store, stateMachine?: StateMachine) {
    this.store = store;
    this.sm = stateMachine ?? new StateMachine();
  }

  async enqueue(goal: string, options?: EnqueueOptions): Promise<Task> {
    const now = new Date().toISOString();
    const task: Task = {
      id: nanoid(),
      parentId: options?.parentId ?? null,
      goal,
      status: TaskStatus.CREATED,
      priority: options?.priority ?? 0,
      assignedAgentId: null,
      input: options?.input ?? {},
      output: null,
      error: null,
      retryCount: 0,
      maxRetries: options?.maxRetries ?? 3,
      dependencies: options?.dependencies ?? [],
      createdAt: now,
      updatedAt: now,
    };

    await this.store.createTask(task);
    return task;
  }

  async dequeue(agentId: string): Promise<Task | null> {
    return this.store.dequeueTask(agentId);
  }

  async complete(
    taskId: string,
    output: Record<string, unknown>,
  ): Promise<Task> {
    const task = await this.requireTask(taskId);
    const updated = this.sm.transition(task, TaskStatus.COMPLETED);
    updated.output = output;

    await this.store.updateTask(taskId, {
      status: updated.status,
      output: updated.output,
      updatedAt: updated.updatedAt,
    });

    return updated;
  }

  async fail(taskId: string, error: string): Promise<Task> {
    const task = await this.requireTask(taskId);
    const updated = this.sm.transition(task, TaskStatus.FAILED);
    updated.error = error;

    await this.store.updateTask(taskId, {
      status: updated.status,
      error: updated.error,
      updatedAt: updated.updatedAt,
    });

    // Auto-retry if retries remaining
    if (task.retryCount < task.maxRetries) {
      return this.retry(taskId);
    }

    return updated;
  }

  async retry(taskId: string): Promise<Task> {
    const task = await this.requireTask(taskId);

    if (task.retryCount >= task.maxRetries) {
      throw new Error(
        `Task ${taskId} has exhausted all retries (${task.maxRetries})`,
      );
    }

    const updated = this.sm.transition(task, TaskStatus.IN_PROGRESS);
    updated.retryCount = task.retryCount + 1;
    updated.error = null;
    updated.assignedAgentId = null;

    await this.store.updateTask(taskId, {
      status: updated.status,
      retryCount: updated.retryCount,
      error: null,
      assignedAgentId: null,
      updatedAt: updated.updatedAt,
    });

    return updated;
  }

  private async requireTask(taskId: string): Promise<Task> {
    const task = await this.store.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    return task;
  }
}
