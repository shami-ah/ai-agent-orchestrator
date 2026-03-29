// ============================================================
// Provider Factory — Returns cached LLMProvider by model name
// "claude*" → ClaudeProvider, "gpt*" → OpenAIProvider
// ============================================================

import type { LLMProvider } from "../types/index.js";
import { ClaudeProvider } from "./claude.js";
import { OpenAIProvider } from "./openai.js";

const providers = new Map<string, LLMProvider>();

function resolveKey(modelName: string): string {
  if (modelName.startsWith("claude")) return "claude";
  if (modelName.startsWith("gpt")) return "openai";
  throw new Error(`Unsupported model: ${modelName}. Expected "claude*" or "gpt*".`);
}

export function getProvider(modelName: string): LLMProvider {
  const key = resolveKey(modelName);
  const cached = providers.get(key);
  if (cached) return cached;

  const provider = key === "claude" ? new ClaudeProvider() : new OpenAIProvider();
  providers.set(key, provider);
  return provider;
}
