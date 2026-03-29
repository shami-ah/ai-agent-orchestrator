// ============================================================
// Planner Agent — Decomposes goals into task DAGs
// ============================================================

import { BaseAgent, type AgentContext } from "./base-agent.js";
import type { Task } from "../types/index.js";

interface PlanStep {
  goal: string;
  priority: number;
  dependsOn: number[];
}

export class PlannerAgent extends BaseAgent {
  protected async think(context: AgentContext): Promise<string> {
    const memories = context.memories.length > 0
      ? `\n\nRelevant past context:\n${context.memories.join("\n")}`
      : "";

    const response = await this.chat([
      {
        role: "user",
        content: `Analyze this goal and identify what subtasks are needed to accomplish it. Think step by step about dependencies between tasks.

Goal: ${context.task.goal}
${memories}

Respond with your analysis of what needs to be done and in what order.`,
      },
    ]);

    return response.content;
  }

  protected async act(
    context: AgentContext,
    thought: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.chat([
      {
        role: "user",
        content: `Based on this analysis, create a concrete execution plan.

Goal: ${context.task.goal}
Analysis: ${thought}

Respond with a JSON array of steps. Each step has:
- "goal": what this step should accomplish
- "priority": 1 (highest) to 5 (lowest)
- "dependsOn": array of step indices (0-based) that must complete first

Example:
[
  {"goal": "Research the topic", "priority": 1, "dependsOn": []},
  {"goal": "Write the outline", "priority": 2, "dependsOn": [0]},
  {"goal": "Write the content", "priority": 3, "dependsOn": [1]}
]

Respond with ONLY the JSON array, no other text.`,
      },
    ]);

    const steps = this.parseSteps(response.content);
    const subtasks = this.stepsToTasks(steps, context.task);

    return {
      plan: thought,
      steps,
      subtaskCount: subtasks.length,
      subtasks,
    };
  }

  private parseSteps(content: string): PlanStep[] {
    // Extract JSON from response (may have markdown code blocks)
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return [{ goal: content.trim(), priority: 1, dependsOn: [] }];
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      return [{ goal: content.trim(), priority: 1, dependsOn: [] }];
    }
  }

  private stepsToTasks(steps: PlanStep[], parentTask: Task): Partial<Task>[] {
    const taskIds = steps.map(() => crypto.randomUUID());

    return steps.map((step, i) => ({
      id: taskIds[i],
      parentId: parentTask.id,
      goal: step.goal,
      status: "planned" as const,
      priority: step.priority,
      assignedAgentId: null,
      input: {},
      output: null,
      error: null,
      retryCount: 0,
      maxRetries: 3,
      dependencies: step.dependsOn.map((depIdx) => taskIds[depIdx]),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  }
}
