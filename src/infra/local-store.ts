// ============================================================
// Local JSON File Store — Zero-dependency persistence
// Stores data in .orchestra/ directory. Drop-in replacement
// for Supabase store when running locally.
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  Store,
  Task,
  Agent,
  Memory,
  ApprovalRequest,
  TaskStatus,
  AgentRole,
} from "../types/index.js";

interface StoreData {
  tasks: Task[];
  agents: Agent[];
  memories: Memory[];
  approvals: ApprovalRequest[];
}

export class LocalStore implements Store {
  private data: StoreData;
  private readonly dir: string;
  private readonly filePath: string;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, ".orchestra");
    this.filePath = join(this.dir, "store.json");

    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }

    this.data = this.load();
  }

  private load(): StoreData {
    if (existsSync(this.filePath)) {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    }
    return { tasks: [], agents: [], memories: [], approvals: [] };
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  // --- Tasks ---

  async createTask(task: Task): Promise<void> {
    this.data.tasks.push(task);
    this.save();
  }

  async getTask(id: string): Promise<Task | null> {
    return this.data.tasks.find((t) => t.id === id) ?? null;
  }

  async updateTask(id: string, updates: Partial<Task>): Promise<void> {
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`Task ${id} not found`);
    this.data.tasks[idx] = { ...this.data.tasks[idx], ...updates, updatedAt: new Date().toISOString() };
    this.save();
  }

  async listTasks(filter?: { status?: TaskStatus; parentId?: string }): Promise<Task[]> {
    let tasks = this.data.tasks;
    if (filter?.status) tasks = tasks.filter((t) => t.status === filter.status);
    if (filter?.parentId) tasks = tasks.filter((t) => t.parentId === filter.parentId);
    return tasks;
  }

  async dequeueTask(agentId: string): Promise<Task | null> {
    // Find highest-priority task that is ready (all dependencies completed)
    const completedIds = new Set(
      this.data.tasks.filter((t) => t.status === "completed").map((t) => t.id),
    );

    const ready = this.data.tasks
      .filter(
        (t) =>
          t.status === "in_progress" &&
          t.assignedAgentId === null &&
          t.dependencies.every((dep) => completedIds.has(dep)),
      )
      .sort((a, b) => b.priority - a.priority);

    if (ready.length === 0) return null;

    const task = ready[0];
    task.assignedAgentId = agentId;
    task.updatedAt = new Date().toISOString();
    this.save();
    return task;
  }

  // --- Agents ---

  async createAgent(agent: Agent): Promise<void> {
    const existing = this.data.agents.findIndex((a) => a.id === agent.id);
    if (existing >= 0) {
      this.data.agents[existing] = agent;
    } else {
      this.data.agents.push(agent);
    }
    this.save();
  }

  async getAgent(id: string): Promise<Agent | null> {
    return this.data.agents.find((a) => a.id === id) ?? null;
  }

  async listAgents(filter?: { role?: AgentRole; active?: boolean }): Promise<Agent[]> {
    let agents = this.data.agents;
    if (filter?.role) agents = agents.filter((a) => a.role === filter.role);
    if (filter?.active !== undefined) agents = agents.filter((a) => a.active === filter.active);
    return agents;
  }

  // --- Memory ---

  async storeMemory(memory: Memory): Promise<void> {
    this.data.memories.push(memory);
    this.save();
  }

  async recallMemories(query: string, limit = 10): Promise<Memory[]> {
    // Simple keyword matching for local store (Supabase store would use pgvector)
    const queryWords = query.toLowerCase().split(/\s+/);
    return this.data.memories
      .map((m) => {
        const content = m.content.toLowerCase();
        const score = queryWords.filter((w) => content.includes(w)).length;
        return { memory: m, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((m) => m.memory);
  }

  // --- Approvals ---

  async createApproval(request: ApprovalRequest): Promise<void> {
    this.data.approvals.push(request);
    this.save();
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    return this.data.approvals.find((a) => a.id === id) ?? null;
  }

  async getPendingApprovals(): Promise<ApprovalRequest[]> {
    return this.data.approvals.filter((a) => a.status === "pending");
  }

  async updateApproval(id: string, updates: Partial<ApprovalRequest>): Promise<void> {
    const idx = this.data.approvals.findIndex((a) => a.id === id);
    if (idx === -1) throw new Error(`Approval ${id} not found`);
    this.data.approvals[idx] = { ...this.data.approvals[idx], ...updates };
    this.save();
  }
}
