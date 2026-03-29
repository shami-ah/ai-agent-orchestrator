// ============================================================
// Base Agent — Abstract agent with think/act/reflect lifecycle
// All agent types (planner, worker, validator) extend this.
// ============================================================

import type {
  Agent,
  Task,
  ChatMessage,
  ChatResponse,
  LLMProvider,
  LLMToolDef,
  Store,
} from "../types/index.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { EventBus } from "../core/event-bus.js";

export interface AgentContext {
  task: Task;
  memories: string[];
  parentGoal?: string;
}

export abstract class BaseAgent {
  constructor(
    protected readonly agent: Agent,
    protected readonly provider: LLMProvider,
    protected readonly toolRegistry: ToolRegistry,
    protected readonly store: Store,
    protected readonly eventBus: EventBus,
  ) {}

  get id(): string {
    return this.agent.id;
  }

  get name(): string {
    return this.agent.name;
  }

  get role(): string {
    return this.agent.role;
  }

  async run(context: AgentContext): Promise<Record<string, unknown>> {
    // Think → Act → Reflect lifecycle
    const thought = await this.think(context);
    this.eventBus.emit({ type: "agent:thinking", agentId: this.id, thought });

    const result = await this.act(context, thought);

    await this.reflect(context, result);

    return result;
  }

  /** Analyze the task and form a plan of action */
  protected abstract think(context: AgentContext): Promise<string>;

  /** Execute the plan — call LLM, use tools, produce output */
  protected abstract act(
    context: AgentContext,
    thought: string,
  ): Promise<Record<string, unknown>>;

  /** Learn from the result — store memories, update understanding */
  protected async reflect(
    context: AgentContext,
    result: Record<string, unknown>,
  ): Promise<void> {
    // Default: store a memory of what was done
    await this.store.storeMemory({
      id: crypto.randomUUID(),
      agentId: this.id,
      taskId: context.task.id,
      content: `Task "${context.task.goal}" completed. Result: ${JSON.stringify(result).slice(0, 500)}`,
      memoryType: "observation",
      metadata: {},
      createdAt: new Date().toISOString(),
    });
  }

  /** Call the LLM with the agent's system prompt + messages */
  protected async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const systemMessage: ChatMessage = {
      role: "system",
      content: this.agent.systemPrompt,
    };
    return this.provider.chat([systemMessage, ...messages]);
  }

  /** Call the LLM with tools available */
  protected async chatWithTools(
    messages: ChatMessage[],
    toolNames?: string[],
  ): Promise<ChatResponse> {
    const systemMessage: ChatMessage = {
      role: "system",
      content: this.agent.systemPrompt,
    };

    const availableTools = toolNames
      ? this.toolRegistry.list().filter((t) => toolNames.includes(t.name))
      : this.toolRegistry.list().filter((t) => this.agent.tools.includes(t.name));

    const llmTools: LLMToolDef[] = availableTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {},
    }));

    return this.provider.chatWithTools([systemMessage, ...messages], llmTools);
  }

  /** Execute a tool call and emit event */
  protected async executeTool(toolName: string, input: unknown): Promise<unknown> {
    const result = await this.toolRegistry.execute(toolName, input);
    this.eventBus.emit({ type: "tool:called", agentId: this.id, toolCall: result });
    return result.output;
  }
}
