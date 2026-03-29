// ============================================================
// Validator Agent — Reviews worker output against acceptance criteria
// ============================================================

import { BaseAgent, type AgentContext } from "./base-agent.js";

export interface ValidationResult {
  approved: boolean;
  feedback: string;
  confidence: number;
  suggestHumanReview: boolean;
}

export class ValidatorAgent extends BaseAgent {
  protected async think(context: AgentContext): Promise<string> {
    const response = await this.chat([
      {
        role: "user",
        content: `You are reviewing the output of a task. Think about what criteria should be used to validate this work.

Task goal: ${context.task.goal}
Worker output: ${JSON.stringify(context.task.output)}

What should you check for? What would make this output acceptable or unacceptable?`,
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
        content: `Based on your analysis, validate this work output.

Task goal: ${context.task.goal}
Task input: ${JSON.stringify(context.task.input)}
Worker output: ${JSON.stringify(context.task.output)}
Your criteria: ${thought}

Respond with a JSON object:
{
  "approved": true/false,
  "feedback": "explanation of your decision",
  "confidence": 0.0 to 1.0,
  "suggestHumanReview": true/false (recommend human review for uncertain cases)
}

Respond with ONLY the JSON object.`,
      },
    ]);

    const result = this.parseValidation(response.content);

    return {
      validation: result,
      validatorModel: response.model,
      tokens: response.usage,
    };
  }

  private parseValidation(content: string): ValidationResult {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        approved: false,
        feedback: "Could not parse validation result",
        confidence: 0,
        suggestHumanReview: true,
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        approved: Boolean(parsed.approved),
        feedback: String(parsed.feedback ?? ""),
        confidence: Number(parsed.confidence ?? 0.5),
        suggestHumanReview: Boolean(parsed.suggestHumanReview ?? false),
      };
    } catch {
      return {
        approved: false,
        feedback: content,
        confidence: 0,
        suggestHumanReview: true,
      };
    }
  }
}
