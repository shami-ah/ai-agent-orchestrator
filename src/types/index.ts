// ============================================================
// Orchestra — Core Types
// Multi-Agent Orchestration Framework
// ============================================================

import { z } from "zod";

// --- Enums ---

export const TaskStatus = {
  CREATED: "created",
  PLANNED: "planned",
  PENDING_APPROVAL: "pending_approval",
  IN_PROGRESS: "in_progress",
  VALIDATING: "validating",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const AgentRole = {
  PLANNER: "planner",
  WORKER: "worker",
  VALIDATOR: "validator",
  ORCHESTRATOR: "orchestrator",
} as const;

export type AgentRole = (typeof AgentRole)[keyof typeof AgentRole];

export const MemoryType = {
  OBSERVATION: "observation",
  DECISION: "decision",
  LEARNING: "learning",
  ERROR: "error",
} as const;

export type MemoryType = (typeof MemoryType)[keyof typeof MemoryType];

export const ApprovalStatus = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXPIRED: "expired",
} as const;

export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

// --- Core Interfaces ---

export interface Task {
  id: string;
  parentId: string | null;
  goal: string;
  status: TaskStatus;
  priority: number;
  assignedAgentId: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  retryCount: number;
  maxRetries: number;
  dependencies: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  name: string;
  role: AgentRole;
  model: string;
  systemPrompt: string;
  tools: string[];
  metadata: Record<string, unknown>;
  active: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  execute: (input: unknown) => Promise<unknown>;
}

export interface ToolCall {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
}

export interface Memory {
  id: string;
  agentId: string | null;
  taskId: string | null;
  content: string;
  memoryType: MemoryType;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRequest {
  id: string;
  taskId: string;
  requestedBy: string;
  status: ApprovalStatus;
  context: {
    goal: string;
    plan: string;
    agentReasoning: string;
    riskLevel: "low" | "medium" | "high";
  };
  decisionReason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

// --- LLM Provider Types ---

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: LLMToolCall[];
  toolCallId?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatResponse {
  content: string;
  toolCalls: LLMToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;
  chatWithTools(
    messages: ChatMessage[],
    tools: LLMToolDef[],
    options?: ChatOptions,
  ): Promise<ChatResponse>;
}

export interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

// --- Event Types ---

export type OrchestraEvent =
  | { type: "task:created"; task: Task }
  | { type: "task:planned"; task: Task; subtasks: Task[] }
  | { type: "task:claimed"; task: Task; agentId: string }
  | { type: "task:completed"; task: Task }
  | { type: "task:failed"; task: Task; error: string }
  | { type: "approval:requested"; request: ApprovalRequest }
  | { type: "approval:granted"; request: ApprovalRequest }
  | { type: "approval:denied"; request: ApprovalRequest }
  | { type: "agent:thinking"; agentId: string; thought: string }
  | { type: "tool:called"; agentId: string; toolCall: ToolCall }
  | { type: "memory:stored"; memory: Memory }
  | { type: "run:started"; goal: string }
  | { type: "run:completed"; goal: string; result: Record<string, unknown> }
  | { type: "run:failed"; goal: string; error: string }
  | { type: "task:validated"; task: Task; round: number; approved: boolean }
  | { type: "task:critique"; task: Task; round: number; feedback: string };

// --- Store Interface (adapter pattern) ---

export interface Store {
  // Tasks
  createTask(task: Task): Promise<void>;
  getTask(id: string): Promise<Task | null>;
  updateTask(id: string, updates: Partial<Task>): Promise<void>;
  listTasks(filter?: { status?: TaskStatus; parentId?: string }): Promise<Task[]>;
  dequeueTask(agentId: string): Promise<Task | null>;

  // Agents
  createAgent(agent: Agent): Promise<void>;
  getAgent(id: string): Promise<Agent | null>;
  listAgents(filter?: { role?: AgentRole; active?: boolean }): Promise<Agent[]>;

  // Memory
  storeMemory(memory: Memory): Promise<void>;
  recallMemories(query: string, limit?: number): Promise<Memory[]>;

  // Approvals
  createApproval(request: ApprovalRequest): Promise<void>;
  getApproval(id: string): Promise<ApprovalRequest | null>;
  getPendingApprovals(): Promise<ApprovalRequest[]>;
  updateApproval(id: string, updates: Partial<ApprovalRequest>): Promise<void>;
}

// --- Config ---

export interface OrchestraConfig {
  defaultModel: string;
  maxRetries: number;
  approvalTimeoutMs: number;
  maxPlanningAttempts: number;
  maxValidationRounds: number;
  costBudget: number | null;
  verbose: boolean;
}

export const DEFAULT_CONFIG: OrchestraConfig = {
  defaultModel: "claude-sonnet-4-20250514",
  maxRetries: 3,
  approvalTimeoutMs: 3600000, // 1 hour
  maxPlanningAttempts: 3,
  maxValidationRounds: 3,
  costBudget: null,
  verbose: true,
};
