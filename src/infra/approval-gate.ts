// ============================================================
// ApprovalGate — Human-in-the-loop approval workflow
// Creates approval requests and handles approve/reject/expire
// transitions with proper state machine enforcement.
// ============================================================

import { nanoid } from "nanoid";
import type {
  Store,
  ApprovalRequest,
  ApprovalStatus,
} from "../types/index.js";
import type { EventBus } from "../core/event-bus.js";
import type { StateMachine } from "../core/state-machine.js";

interface ApprovalContext {
  goal: string;
  plan: string;
  agentReasoning: string;
  riskLevel: "low" | "medium" | "high";
}

export class ApprovalGate {
  private readonly store: Store;
  private readonly bus: EventBus;
  private readonly sm: StateMachine;

  constructor(store: Store, bus: EventBus, sm: StateMachine) {
    this.store = store;
    this.bus = bus;
    this.sm = sm;
  }

  /** Create an approval request and transition task to pending_approval. */
  async requestApproval(
    taskId: string,
    agentId: string,
    context: ApprovalContext,
  ): Promise<ApprovalRequest> {
    const task = await this.store.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    // Transition task to pending_approval
    const updated = this.sm.transition(task, "pending_approval");
    await this.store.updateTask(taskId, { status: updated.status });

    const request: ApprovalRequest = {
      id: nanoid(),
      taskId,
      requestedBy: agentId,
      status: "pending" satisfies ApprovalStatus,
      context,
      decisionReason: null,
      decidedBy: null,
      decidedAt: null,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    };

    await this.store.createApproval(request);
    this.bus.emit({ type: "approval:requested", request });

    return request;
  }

  /** Approve a pending request and transition task to in_progress. */
  async approve(
    approvalId: string,
    decidedBy: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request = await this.store.getApproval(approvalId);
    if (!request) throw new Error(`Approval ${approvalId} not found`);
    if (request.status !== "pending") {
      throw new Error(`Approval ${approvalId} is already ${request.status}`);
    }

    const now = new Date().toISOString();
    const updates: Partial<ApprovalRequest> = {
      status: "approved" satisfies ApprovalStatus,
      decidedBy,
      decisionReason: reason,
      decidedAt: now,
    };

    await this.store.updateApproval(approvalId, updates);

    // Transition task to in_progress
    const task = await this.store.getTask(request.taskId);
    if (task) {
      const updated = this.sm.transition(task, "in_progress");
      await this.store.updateTask(request.taskId, { status: updated.status });
    }

    const resolved: ApprovalRequest = { ...request, ...updates };
    this.bus.emit({ type: "approval:granted", request: resolved });

    return resolved;
  }

  /** Reject a pending request and transition task to cancelled. */
  async reject(
    approvalId: string,
    decidedBy: string,
    reason: string,
  ): Promise<ApprovalRequest> {
    const request = await this.store.getApproval(approvalId);
    if (!request) throw new Error(`Approval ${approvalId} not found`);
    if (request.status !== "pending") {
      throw new Error(`Approval ${approvalId} is already ${request.status}`);
    }

    const now = new Date().toISOString();
    const updates: Partial<ApprovalRequest> = {
      status: "rejected" satisfies ApprovalStatus,
      decidedBy,
      decisionReason: reason,
      decidedAt: now,
    };

    await this.store.updateApproval(approvalId, updates);

    // Transition task to cancelled
    const task = await this.store.getTask(request.taskId);
    if (task) {
      const updated = this.sm.transition(task, "cancelled");
      await this.store.updateTask(request.taskId, { status: updated.status });
    }

    const resolved: ApprovalRequest = { ...request, ...updates };
    this.bus.emit({ type: "approval:denied", request: resolved });

    return resolved;
  }

  /** Find expired pending approvals and auto-reject them. */
  async checkExpired(): Promise<ApprovalRequest[]> {
    const pending = await this.store.getPendingApprovals();
    const now = Date.now();
    const expired: ApprovalRequest[] = [];

    for (const request of pending) {
      if (!request.expiresAt) continue;
      if (new Date(request.expiresAt).getTime() > now) continue;

      const updates: Partial<ApprovalRequest> = {
        status: "expired" satisfies ApprovalStatus,
        decisionReason: "Approval expired without response",
        decidedAt: new Date().toISOString(),
      };

      await this.store.updateApproval(request.id, updates);

      // Transition task to cancelled
      const task = await this.store.getTask(request.taskId);
      if (task) {
        const updated = this.sm.transition(task, "cancelled");
        await this.store.updateTask(request.taskId, { status: updated.status });
      }

      const resolved: ApprovalRequest = { ...request, ...updates };
      this.bus.emit({ type: "approval:denied", request: resolved });
      expired.push(resolved);
    }

    return expired;
  }
}
