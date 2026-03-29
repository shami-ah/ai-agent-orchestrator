// ============================================================
// Tool Registry — Register and discover tools with schema validation
// ============================================================

import type { ToolDefinition, ToolCall } from "../types/index.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  listNames(): string[] {
    return [...this.tools.keys()];
  }

  toLLMFormat(): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: this.zodToJsonSchema(tool.inputSchema),
    }));
  }

  async execute(name: string, input: unknown): Promise<ToolCall> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);

    // Validate input
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new Error(`Invalid input for tool "${name}": ${parsed.error.message}`);
    }

    const start = Date.now();
    const output = await tool.execute(parsed.data);
    const durationMs = Date.now() - start;

    // Validate output
    const outputParsed = tool.outputSchema.safeParse(output);
    if (!outputParsed.success) {
      throw new Error(`Invalid output from tool "${name}": ${outputParsed.error.message}`);
    }

    return { toolName: name, input: parsed.data, output: outputParsed.data, durationMs };
  }

  private zodToJsonSchema(schema: unknown): Record<string, unknown> {
    // Minimal Zod-to-JSON-Schema conversion for LLM tool definitions
    // In production, use zod-to-json-schema package
    return { type: "object", properties: {} };
  }
}
