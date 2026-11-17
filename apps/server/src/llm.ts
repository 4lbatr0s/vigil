import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import { DEFAULT_URLS, envConnection, resolveConnection, type ResolvedConnection } from "./connections";
import { knownSecrets } from "./secrets";

/**
 * All the runtime needs from a model: messages in, one AI message out (tools already bound).
 * `stream` is optional: when present, a chat turn shows the answer as it is written.
 */
export type ChatModel = {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
  stream?(messages: BaseMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<AIMessageChunk>>;
};

/** Context window asked of Ollama (tokens). */
export const DEFAULT_OLLAMA_CTX = 16384;

export type ModelFactory = (
  tools: StructuredToolInterface[],
  options: { model: string | undefined; maxTokens: number; /** A saved connection id (an agent's), else the default one is used. */ connection?: string | undefined },
) => ChatModel;

/** Builds the chat model for one resolved connection. The key stays inside the library object. */
export function buildChatModel(conn: ResolvedConnection, tools: StructuredToolInterface[], model: string | undefined, maxTokens: number): ChatModel {
  const name = model ?? conn.model;
  if (!name) throw new Error("No model configured: choose a model for the connection, or set the agent's model.");
  const bind = (chat: { bindTools(t: StructuredToolInterface[]): unknown }): ChatModel => (tools.length > 0 ? (chat.bindTools(tools) as unknown as ChatModel) : (chat as unknown as ChatModel));
  if (conn.kind === "ollama") {
    return bind(
      new ChatOllama({
        model: name,
        baseUrl: conn.baseUrl || DEFAULT_URLS.ollama,
        numPredict: maxTokens,
        // Ollama's default window is 4096 tokens, shared by the prompt, a thinking model's reasoning and the answer;
        // a note or a picture plus reasoning can fill it and leave an empty reply. VIGIL_LLM_NUM_CTX overrides.
        numCtx: Number(process.env.VIGIL_LLM_NUM_CTX) > 0 ? Number(process.env.VIGIL_LLM_NUM_CTX) : DEFAULT_OLLAMA_CTX,
      }),
    );
  }
  if (conn.kind === "anthropic") {
    return bind(new ChatAnthropic({ model: name, apiKey: conn.apiKey ?? "", ...(conn.baseUrl && conn.baseUrl !== DEFAULT_URLS.anthropic ? { anthropicApiUrl: conn.baseUrl } : {}), maxTokens }));
  }
  return bind(
    new ChatOpenAI({
      model: name,
      apiKey: conn.apiKey ?? "not-needed",
      configuration: { baseURL: conn.baseUrl || DEFAULT_URLS.openai },
      maxTokens,
      // Routers and LM Studio speak chat completions only, never the Responses API.
      useResponsesApi: false,
    }),
  );
}

/**
 * The model factory the app runs on: each call resolves the connection (the agent's, else the default, else the
 * VIGIL_LLM_* environment), so a connection added or changed in Settings applies to the next run without a restart.
 */
export function modelFactoryFromConnections(): ModelFactory {
  return (tools, { model, maxTokens, connection }) => buildChatModel(resolveConnection(connection), tools, model, maxTokens);
}

/** The environment alone (VIGIL_LLM_*). Kept for tests and for a server that is configured only that way. */
export function modelFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): ModelFactory {
  return (tools, { model, maxTokens }) => {
    const conn = envConnection(env) ?? { id: "env", name: "Environment", kind: "openai" as const, baseUrl: DEFAULT_URLS.openai, apiKey: undefined, model: undefined };
    if (!(model ?? conn.model)) throw new Error("No model configured: set VIGIL_LLM_MODEL or the agent's model.");
    return buildChatModel(conn, tools, model, maxTokens);
  };
}

/** Strip anything key-shaped, and the configured key itself, before text reaches a log or a row. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text.replace(/\b(sk|gsk|ghp|gho|ghu|ghs|ghr|AIza)[-_A-Za-z0-9]{12,}/g, "[redacted]").replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [redacted]");
  const key = env.VIGIL_LLM_API_KEY;
  if (key && key.length >= 6) out = out.split(key).join("[redacted]");
  // Keys the owner saved in Settings or probed this run.
  for (const secret of knownSecrets()) out = out.split(secret).join("[redacted]");
  return out;
}
