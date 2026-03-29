// ============================================================
// Agent Registry — Register and discover agents by role/capability
// ============================================================

import type { Agent, AgentRole, Store } from "../types/index.js";

export class AgentRegistry {
  constructor(private store: Store) {}

  async register(agent: Agent): Promise<void> {
    await this.store.createAgent(agent);
  }

  async get(id: string): Promise<Agent | null> {
    return this.store.getAgent(id);
  }

  async getByRole(role: AgentRole): Promise<Agent[]> {
    return this.store.listAgents({ role, active: true });
  }

  async getPlanner(): Promise<Agent | null> {
    const planners = await this.getByRole("planner");
    return planners[0] ?? null;
  }

  async getValidator(): Promise<Agent | null> {
    const validators = await this.getByRole("validator");
    return validators[0] ?? null;
  }

  async getWorkers(): Promise<Agent[]> {
    return this.getByRole("worker");
  }

  async listAll(): Promise<Agent[]> {
    return this.store.listAgents();
  }

  async deactivate(id: string): Promise<void> {
    const agent = await this.store.getAgent(id);
    if (agent) {
      await this.store.createAgent({ ...agent, active: false });
    }
  }
}
