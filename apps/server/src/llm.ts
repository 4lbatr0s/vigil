import type { AIMessage, AIMessageChunk, BaseMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOllama } from "@langchain/ollama";
import { DEFAULT_URLS, envConnection, resolveConnection, type ResolvedConnection } from "./connections";
import { knownSecrets } from "./secrets";
import { historyChars } from "./history";
import { withRetry } from "./llm-retry";
import { reasoningChatOpenAI } from "./llm-reasoning";

/**
 * All the runtime needs from a model: messages in, one AI message out (tools already bound).
 * `stream` is optional: when present, a chat turn shows the answer as it is written.
 */
export type ChatModel = {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
  stream?(messages: BaseMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<AIMessageChunk>>;
  /** The provider clears old tool results itself (Anthropic context editing), so the runtime does not (todo item 51). */
  clearsOldToolResults?: true;
};

/** Context window asked of Ollama (tokens). */
export const DEFAULT_OLLAMA_CTX = 16384;

export type ModelFactory = (
  tools: StructuredToolInterface[],
  options: {
    model: string | undefined;
    maxTokens: number;
    /** A saved connection id (an agent's), else the default one is used. */
    connection?: string | undefined;
    /** Told before each retry of a failed call (the run log shows it). */
    onRetry?: (retry: number, err: unknown) => void;
    /** Cancelling the run stops the retrying. */
    signal?: AbortSignal | undefined;
  },
) => ChatModel;

/** Builds the chat model for one resolved connection. The key stays inside the library object. */
export function buildChatModel(conn: ResolvedConnection, tools: StructuredToolInterface[], model: string | undefined, maxTokens: number, retry: { onRetry?: (retry: number, err: unknown) => void; signal?: AbortSignal | undefined } = {}, env: NodeJS.ProcessEnv = process.env): ChatModel {
  const built = withRetry(buildPlainChatModel(conn, tools, model, maxTokens, env), retry);
  return conn.kind === "anthropic" && anthropicContextEditing(env) ? { ...built, clearsOldToolResults: true } : built;
}

function buildPlainChatModel(conn: ResolvedConnection, tools: StructuredToolInterface[], model: string | undefined, maxTokens: number, env: NodeJS.ProcessEnv = process.env): ChatModel {
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
  if (conn.kind === "anthropic") return anthropicRunnable(conn, tools, name, maxTokens, env) as unknown as ChatModel;
  return bind(
    // Sends `reasoning_content` back, which DeepSeek's thinking mode needs when tools are on (todo-agent 17).
    reasoningChatOpenAI({
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
 * Sent with every Anthropic call. `cache_control` turns on automatic prompt caching: the system prompt, the tool list
 * and the older turns of a chat are the same on every call, so after the first call the provider reads them from its
 * cache, which is faster and cheaper. (It is a call option in this adapter, not a constructor option.)
 */
export const ANTHROPIC_CALL_OPTIONS = { cache_control: { type: "ephemeral" as const } };

/** An Anthropic chat model with the tools bound and prompt caching on. */
export function anthropicRunnable(conn: ResolvedConnection, tools: StructuredToolInterface[], model: string, maxTokens: number, env: NodeJS.ProcessEnv = process.env) {
  const chat = new ChatAnthropic(anthropicOptions(conn, model, maxTokens, env));
  return tools.length > 0 ? chat.bindTools(tools, ANTHROPIC_CALL_OPTIONS) : chat.withConfig(ANTHROPIC_CALL_OPTIONS);
}

/** Experimental (todo item 51): Anthropic's own clearing of old tool results instead of `clearOldToolResults`. */
const anthropicContextEditing = (env: NodeJS.ProcessEnv): boolean => env.VIGIL_ANTHROPIC_CONTEXT_EDITING === "1";

/**
 * Context editing set to about the size where Vigil clears old results itself (`historyChars`, 4 characters a token),
 * keeping the newest 4 tool uses, so a measurement compares like with like.
 */
const contextEditing = (env: NodeJS.ProcessEnv) => ({
  edits: [{ type: "clear_tool_uses_20250919" as const, trigger: { type: "input_tokens" as const, value: Math.round(historyChars(env) / 4) }, keep: { type: "tool_uses" as const, value: 4 } }],
});

/** Constructor options for an Anthropic model. */
export function anthropicOptions(conn: ResolvedConnection, model: string, maxTokens: number, env: NodeJS.ProcessEnv = process.env) {
  return {
    model,
    apiKey: conn.apiKey ?? "",
    maxTokens,
    ...(conn.baseUrl && conn.baseUrl !== DEFAULT_URLS.anthropic ? { anthropicApiUrl: conn.baseUrl } : {}),
    ...(anthropicContextEditing(env) ? { betas: ["context-management-2025-06-27" as const], contextManagement: contextEditing(env) } : {}),
  };
}

/**
 * The model factory the app runs on: each call resolves the connection (the agent's, else the default, else the
 * VIGIL_LLM_* environment), so a connection added or changed in Settings applies to the next run without a restart.
 */
export function modelFactoryFromConnections(): ModelFactory {
  return (tools, { model, maxTokens, connection, onRetry, signal }) => buildChatModel(resolveConnection(connection), tools, model, maxTokens, { onRetry, signal });
}

/** The environment alone (VIGIL_LLM_*). Kept for tests and for a server that is configured only that way. */
export function modelFactoryFromEnv(env: NodeJS.ProcessEnv = process.env): ModelFactory {
  return (tools, { model, maxTokens, onRetry, signal }) => {
    const conn = envConnection(env) ?? { id: "env", name: "Environment", kind: "openai" as const, baseUrl: DEFAULT_URLS.openai, apiKey: undefined, model: undefined };
    if (!(model ?? conn.model)) throw new Error("No model configured: set VIGIL_LLM_MODEL or the agent's model.");
    return buildChatModel(conn, tools, model, maxTokens, { onRetry, signal });
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
