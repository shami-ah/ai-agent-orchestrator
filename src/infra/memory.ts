// ============================================================
// MemoryStore — Agent memory management layer
// Wraps the Store interface with convenient memory operations.
// ============================================================

import { nanoid } from "nanoid";
import type { Store, Memory, MemoryType } from "../types/index.js";

export class MemoryStore {
  private readonly backend: Store;

  constructor(store: Store) {
    this.backend = store;
  }

  /** Create and persist a new memory entry. */
  async store(
    agentId: string | null,
    taskId: string | null,
    content: string,
    type: MemoryType,
    metadata: Record<string, unknown> = {},
  ): Promise<Memory> {
    const memory: Memory = {
      id: nanoid(),
      agentId,
      taskId,
      content,
      memoryType: type,
      metadata,
      createdAt: new Date().toISOString(),
    };

    await this.backend.storeMemory(memory);
    return memory;
  }

  /** Recall memories matching a semantic query. */
  async recall(query: string, limit?: number): Promise<Memory[]> {
    return this.backend.recallMemories(query, limit);
  }

  /** Get all memories associated with a specific task. */
  async getTaskMemories(taskId: string): Promise<Memory[]> {
    // Recall with taskId as query, then filter to exact match
    const candidates = await this.backend.recallMemories(taskId, 100);
    return candidates.filter((m) => m.taskId === taskId);
  }

  /** Get recent memories for a specific agent. */
  async getAgentMemories(agentId: string, limit = 20): Promise<Memory[]> {
    // Recall with agentId as query, then filter to exact match
    const candidates = await this.backend.recallMemories(agentId, 100);
    return candidates
      .filter((m) => m.agentId === agentId)
      .slice(0, limit);
  }
}
