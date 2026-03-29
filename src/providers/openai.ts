// ============================================================
// OpenAI Provider — GPT adapter
// Implements LLMProvider using openai SDK.
// ============================================================

import OpenAI from "openai";
import type {
  LLMProvider,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMToolDef,
  LLMToolCall,
} from "../types/index.js";

const DEFAULT_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 4096;

export class OpenAIProvider implements LLMProvider {
  private readonly client: OpenAI;

  constructor() {
    this.client = new OpenAI();
  }

  async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const openaiMessages = this.mapMessages(messages);

    const response = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature,
      messages: openaiMessages,
    });

    return this.mapResponse(response);
  }

  async chatWithTools(
    messages: ChatMessage[],
    tools: LLMToolDef[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const openaiMessages = this.mapMessages(messages);

    const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: options?.model ?? DEFAULT_MODEL,
      max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options?.temperature,
      messages: openaiMessages,
      tools: openaiTools,
    });

    return this.mapResponse(response);
  }

  private mapMessages(
    messages: ChatMessage[],
  ): OpenAI.ChatCompletionMessageParam[] {
    return messages.map((msg): OpenAI.ChatCompletionMessageParam => {
      if (msg.role === "system") {
        return { role: "system", content: msg.content };
      }

      if (msg.role === "tool") {
        return {
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId ?? "",
        };
      }

      if (msg.role === "assistant") {
        const toolCalls = msg.toolCalls?.map(
          (tc): OpenAI.ChatCompletionMessageToolCall => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: tc.arguments,
            },
          }),
        );

        return {
          role: "assistant",
          content: msg.content,
          tool_calls: toolCalls?.length ? toolCalls : undefined,
        };
      }

      return { role: "user", content: msg.content };
    });
  }

  private mapResponse(
    response: OpenAI.ChatCompletion,
  ): ChatResponse {
    const choice = response.choices[0];
    const message = choice?.message;

    const toolCalls: LLMToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      content: message?.content ?? "",
      toolCalls,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      model: response.model,
    };
  }
}
