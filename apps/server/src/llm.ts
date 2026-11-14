import type { BaseMessage, AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";

/** All the runtime needs from a model: messages in, one AI message out (tools already bound). */
export type ChatModel = { invoke(messages: BaseMessage[]): Promise<AIMessage> };

export type ModelFactory = (
  tools: StructuredToolInterface[],
  options: { model: string | undefined; maxTokens: number },
) => ChatModel;

/**
 * Provider settings come from the environment only (ADR-0003): VIGIL_LLM_PROVIDER (openai|ollama),
 * VIGIL_LLM_BASE_URL, VIGIL_LLM_API_KEY, VIGIL_LLM_MODEL. Nothing here is logged or stored.
 */
export function modelFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): ModelFactory {
  const provider = env.VIGIL_LLM_PROVIDER ?? "openai";
  return (tools, { model, maxTokens }) => {
    const name = model ?? env.VIGIL_LLM_MODEL;
    if (!name) throw new Error("No model configured: set VIGIL_LLM_MODEL or the agent's model.");
    if (provider === "ollama") {
      const chat = new ChatOllama({
        model: name,
        baseUrl: env.VIGIL_LLM_BASE_URL ?? "http://127.0.0.1:11434",
        numPredict: maxTokens,
      });
      return tools.length > 0 ? (chat.bindTools(tools) as unknown as ChatModel) : (chat as unknown as ChatModel);
    }
    if (provider !== "openai") throw new Error(`Unknown VIGIL_LLM_PROVIDER: ${provider}`);
    const chat = new ChatOpenAI({
      model: name,
      apiKey: env.VIGIL_LLM_API_KEY ?? "not-needed",
      configuration: { baseURL: env.VIGIL_LLM_BASE_URL ?? "https://api.openai.com/v1" },
      maxTokens,
      // Routers and LM Studio speak chat completions only, never the Responses API.
      useResponsesApi: false,
    });
    return tools.length > 0 ? (chat.bindTools(tools) as unknown as ChatModel) : (chat as unknown as ChatModel);
  };
}

/** Strip anything key-shaped, and the configured key itself, before text reaches a log or a row. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text.replace(/\b(sk|gsk|ghp|gho|ghu|ghs|ghr|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
  const key = env.VIGIL_LLM_API_KEY;
  if (key && key.length >= 6) out = out.split(key).join("[redacted]");
  return out;
}
