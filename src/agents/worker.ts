// ============================================================
// Worker Agent — Executes individual tasks using tools
// ============================================================

import { BaseAgent, type AgentContext } from "./base-agent.js";

export class WorkerAgent extends BaseAgent {
  protected async think(context: AgentContext): Promise<string> {
    const memories = context.memories.length > 0
      ? `\n\nRelevant context from previous work:\n${context.memories.join("\n")}`
      : "";

    const parentContext = context.parentGoal
      ? `\nThis is part of a larger goal: ${context.parentGoal}`
      : "";

    const response = await this.chat([
      {
        role: "user",
        content: `You need to complete this task. Think about what approach to take and what tools you might need.

Task: ${context.task.goal}
Input: ${JSON.stringify(context.task.input)}${parentContext}${memories}

Available tools: ${this.agent.tools.join(", ") || "none"}

Describe your approach briefly.`,
      },
    ]);

    return response.content;
  }

  protected async act(
    context: AgentContext,
    thought: string,
  ): Promise<Record<string, unknown>> {
    // Execute with tool use loop
    const messages: Array<{ role: "system" | "user" | "assistant" | "tool"; content: string }> = [
      {
        role: "user",
        content: `Complete this task. Use tools when needed.

Task: ${context.task.goal}
Input: ${JSON.stringify(context.task.input)}
Your plan: ${thought}

When done, provide your final answer.`,
      },
    ];

    let response = await this.chatWithTools(messages);
    let iterations = 0;
    const maxIterations = 10;

    // Tool use loop — keep calling tools until LLM stops requesting them
    while (response.toolCalls.length > 0 && iterations < maxIterations) {
      for (const toolCall of response.toolCalls) {
        try {
          const args = JSON.parse(toolCall.arguments);
          const result = await this.executeTool(toolCall.name, args);
          messages.push({
            role: "assistant",
            content: response.content || "",
          });
          messages.push({
            role: "tool",
            content: JSON.stringify(result),
          });
        } catch (error) {
          messages.push({
            role: "tool",
            content: `Error: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }

      response = await this.chatWithTools(messages);
      iterations++;
    }

    return {
      result: response.content,
      toolCallCount: iterations,
      tokens: response.usage,
    };
  }
}
