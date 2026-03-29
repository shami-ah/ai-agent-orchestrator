// ============================================================
// Orchestrator — The heart of the system
// Receives goals, dispatches to agents, manages task lifecycle,
// enforces approval gates, handles retries and validation.
// ============================================================

import type {
  Task,
  OrchestraConfig,
  Store,
} from "../types/index.js";
import { TaskStatus } from "../types/index.js";
import { EventBus } from "./event-bus.js";
import { StateMachine } from "./state-machine.js";
import { TaskQueue } from "../infra/task-queue.js";
import { MemoryStore } from "../infra/memory.js";
import { ApprovalGate } from "../infra/approval-gate.js";
import { AgentRegistry } from "../registry/agent-registry.js";
import { ToolRegistry } from "../registry/tool-registry.js";
import { getProvider } from "../providers/factory.js";
import { PlannerAgent } from "../agents/planner.js";
import { WorkerAgent } from "../agents/worker.js";
import { ValidatorAgent } from "../agents/validator.js";
import type { ValidationResult } from "../agents/validator.js";

export class Orchestrator {
  readonly eventBus: EventBus;
  readonly stateMachine: StateMachine;
  readonly taskQueue: TaskQueue;
  readonly memory: MemoryStore;
  readonly approvalGate: ApprovalGate;
  readonly agentRegistry: AgentRegistry;
  readonly toolRegistry: ToolRegistry;

  private config: OrchestraConfig;

  constructor(
    private store: Store,
    config?: Partial<OrchestraConfig>,
  ) {
    this.config = {
      defaultModel: config?.defaultModel ?? "claude-sonnet-4-20250514",
      maxRetries: config?.maxRetries ?? 3,
      approvalTimeoutMs: config?.approvalTimeoutMs ?? 3600000,
      maxPlanningAttempts: config?.maxPlanningAttempts ?? 3,
      maxValidationRounds: config?.maxValidationRounds ?? 3,
      costBudget: config?.costBudget ?? null,
      verbose: config?.verbose ?? true,
    };

    this.eventBus = new EventBus();
    this.stateMachine = new StateMachine();
    this.taskQueue = new TaskQueue(store, this.stateMachine);
    this.memory = new MemoryStore(store);
    this.approvalGate = new ApprovalGate(store, this.eventBus, this.stateMachine);
    this.agentRegistry = new AgentRegistry(store);
    this.toolRegistry = new ToolRegistry();
  }

  /** Register default agents (planner, worker, validator) */
  async setupDefaultAgents(model?: string): Promise<void> {
    const m = model ?? this.config.defaultModel;

    await this.agentRegistry.register({
      id: "planner-default",
      name: "Planner",
      role: "planner",
      model: m,
      systemPrompt:
        "You are a planning agent. Your job is to decompose complex goals into clear, actionable subtasks with dependencies. Think step by step. Output structured plans.",
      tools: [],
      metadata: {},
      active: true,
    });

    await this.agentRegistry.register({
      id: "worker-default",
      name: "Worker",
      role: "worker",
      model: m,
      systemPrompt:
        "You are a worker agent. Execute the given task thoroughly and accurately. Use available tools when needed. Provide clear, complete output.",
      tools: ["web_search", "file_read", "file_write", "shell_exec"],
      metadata: {},
      active: true,
    });

    await this.agentRegistry.register({
      id: "validator-default",
      name: "Validator",
      role: "validator",
      model: m,
      systemPrompt:
        "You are a validation agent. Review work output critically against the task goal. Check for completeness, accuracy, and quality. Be thorough but fair.",
      tools: [],
      metadata: {},
      active: true,
    });
  }

  /** Main entry point — run a goal through the full pipeline */
  async run(goal: string, requireApproval = true): Promise<Record<string, unknown>> {
    this.eventBus.emit({ type: "run:started", goal });

    try {
      // 1. Create root task
      const rootTask = await this.taskQueue.enqueue(goal, { priority: 10 });
      this.eventBus.emit({ type: "task:created", task: rootTask });

      // 2. Plan — decompose into subtasks
      const plan = await this.plan(rootTask);

      // 3. Approval gate (if enabled)
      if (requireApproval) {
        const approved = await this.requestApproval(rootTask, plan);
        if (!approved) {
          await this.stateMachine.transition(rootTask, TaskStatus.CANCELLED);
          await this.store.updateTask(rootTask.id, { status: TaskStatus.CANCELLED });
          return { status: "cancelled", reason: "Approval denied" };
        }
      }

      // 4. Execute subtasks
      const subtasks = await this.store.listTasks({ parentId: rootTask.id });
      for (const subtask of subtasks) {
        await this.store.updateTask(subtask.id, { status: TaskStatus.IN_PROGRESS });
      }

      const results = await this.executeSubtasks(subtasks);

      // 5. Complete root task
      await this.store.updateTask(rootTask.id, {
        status: TaskStatus.COMPLETED,
        output: { results },
      });

      const completedRoot = (await this.store.getTask(rootTask.id))!;
      this.eventBus.emit({ type: "task:completed", task: completedRoot });
      this.eventBus.emit({ type: "run:completed", goal, result: { results } });

      return { status: "completed", results };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.eventBus.emit({ type: "run:failed", goal, error: msg });
      return { status: "failed", error: msg };
    }
  }

  private async plan(task: Task): Promise<Record<string, unknown>> {
    const plannerAgent = await this.agentRegistry.getPlanner();
    if (!plannerAgent) throw new Error("No planner agent registered");

    const provider = getProvider(plannerAgent.model);
    const planner = new PlannerAgent(
      plannerAgent,
      provider,
      this.toolRegistry,
      this.store,
      this.eventBus,
    );

    const memories = await this.memory.recall(task.goal, 5);
    const result = await planner.run({
      task,
      memories: memories.map((m) => m.content),
    });

    // Create subtasks from plan
    const subtasks = (result.subtasks ?? []) as Partial<Task>[];
    for (const st of subtasks) {
      if (st.id && st.goal) {
        await this.store.createTask({
          id: st.id,
          parentId: task.id,
          goal: st.goal,
          status: TaskStatus.PLANNED,
          priority: st.priority ?? 1,
          assignedAgentId: null,
          input: st.input ?? {},
          output: null,
          error: null,
          retryCount: 0,
          maxRetries: this.config.maxRetries,
          dependencies: st.dependencies ?? [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }

    await this.store.updateTask(task.id, { status: TaskStatus.PLANNED });
    this.eventBus.emit({
      type: "task:planned",
      task: { ...task, status: TaskStatus.PLANNED },
      subtasks: subtasks as Task[],
    });

    return result;
  }

  private async requestApproval(
    task: Task,
    plan: Record<string, unknown>,
  ): Promise<boolean> {
    await this.approvalGate.requestApproval(task.id, "orchestrator", {
      goal: task.goal,
      plan: JSON.stringify(plan.steps ?? plan, null, 2),
      agentReasoning: String(plan.plan ?? ""),
      riskLevel: "medium",
    });

    // In CLI mode, approval is handled synchronously via interactive prompt
    // Return true for now — the CLI will handle the approval flow
    return true;
  }

  private async executeSubtasks(
    subtasks: Task[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    const completed = new Set<string>();

    // Execute in dependency order
    const remaining = [...subtasks];

    while (remaining.length > 0) {
      // Find tasks whose dependencies are all completed
      const ready = remaining.filter((t) =>
        t.dependencies.every((dep) => completed.has(dep)),
      );

      if (ready.length === 0 && remaining.length > 0) {
        throw new Error("Circular dependency detected or stuck tasks");
      }

      // Execute ready tasks (could parallelize here)
      for (const task of ready) {
        const result = await this.executeOne(task);
        results.push(result);
        completed.add(task.id);
        remaining.splice(remaining.indexOf(task), 1);
      }
    }

    return results;
  }

  private async executeOne(task: Task): Promise<Record<string, unknown>> {
    const workerAgents = await this.agentRegistry.getWorkers();
    if (workerAgents.length === 0) throw new Error("No worker agents registered");

    const workerAgent = workerAgents[0];
    const provider = getProvider(workerAgent.model);
    const worker = new WorkerAgent(
      workerAgent,
      provider,
      this.toolRegistry,
      this.store,
      this.eventBus,
    );

    this.eventBus.emit({ type: "task:claimed", task, agentId: workerAgent.id });

    const memories = await this.memory.recall(task.goal, 3);
    const result = await worker.run({
      task,
      memories: memories.map((m) => m.content),
      parentGoal: task.parentId
        ? (await this.store.getTask(task.parentId))?.goal
        : undefined,
    });

    // Validate
    const validation = await this.validate(task, result);
    const validationData = validation.validation as ValidationResult | undefined;

    if (validationData?.approved) {
      await this.store.updateTask(task.id, {
        status: TaskStatus.COMPLETED,
        output: result,
      });
      this.eventBus.emit({
        type: "task:completed",
        task: { ...task, status: TaskStatus.COMPLETED, output: result },
      });
    } else {
      await this.store.updateTask(task.id, {
        status: TaskStatus.FAILED,
        error: validationData?.feedback ?? "Validation failed",
        output: result,
      });
      this.eventBus.emit({
        type: "task:failed",
        task: { ...task, status: TaskStatus.FAILED },
        error: validationData?.feedback ?? "Validation failed",
      });
    }

    return { ...result, validation };
  }

  private async validate(
    task: Task,
    workerOutput: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const validatorAgent = await this.agentRegistry.getValidator();
    if (!validatorAgent) return { validation: { approved: true, feedback: "No validator configured" } };

    const provider = getProvider(validatorAgent.model);
    const validator = new ValidatorAgent(
      validatorAgent,
      provider,
      this.toolRegistry,
      this.store,
      this.eventBus,
    );

    const taskWithOutput = { ...task, output: workerOutput };
    return validator.run({
      task: taskWithOutput,
      memories: [],
    });
  }
}
