import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOpenAI, ChatOpenAICompletions, type ChatOpenAIFields } from "@langchain/openai";

type Param = { role?: string; reasoning_content?: string };

/** The `reasoning_content` of each AI message, in order (undefined where the provider sent none). */
export function reasoningOf(messages: BaseMessage[]): (string | undefined)[] {
  return messages.filter((m) => AIMessage.isInstance(m)).map((m) => {
    const text = m.additional_kwargs.reasoning_content;
    return typeof text === "string" ? text : undefined;
  });
}

/**
 * Puts each saved `reasoning_content` back on the matching assistant message of a request. DeepSeek (thinking mode with
 * tools) answers 400 when it is missing; `@langchain/openai` reads it from replies but never sends it back.
 * The n-th assistant entry of the request is the n-th AI message of the conversation.
 */
export function withReasoning<T extends Param>(requestMessages: T[], reasoning: (string | undefined)[]): T[] {
  let n = 0;
  return requestMessages.map((param) => {
    if (param.role !== "assistant") return param;
    const text = reasoning[n++];
    return text === undefined ? param : { ...param, reasoning_content: text };
  });
}

/**
 * The completions half of ChatOpenAI. It notes the reasoning of the call in progress; the fetch wrapper below adds it to
 * the request body. Use one instance for one call at a time (the runtime builds a model per call site and awaits each call).
 */
class ReasoningCompletions extends ChatOpenAICompletions {
  /** Reasoning texts of the call in progress; read by the fetch wrapper. */
  readonly pending: { texts: (string | undefined)[] };

  constructor(fields: ChatOpenAIFields, pending: { texts: (string | undefined)[] }) {
    super(fields);
    this.pending = pending;
  }

  override async _generate(...args: Parameters<ChatOpenAICompletions["_generate"]>): ReturnType<ChatOpenAICompletions["_generate"]> {
    this.pending.texts = reasoningOf(args[0]);
    return super._generate(...args);
  }

  override async *_streamResponseChunks(...args: Parameters<ChatOpenAICompletions["_streamResponseChunks"]>): ReturnType<ChatOpenAICompletions["_streamResponseChunks"]> {
    this.pending.texts = reasoningOf(args[0]);
    yield* super._streamResponseChunks(...args);
  }

  override async *_streamChatModelEvents(...args: Parameters<ChatOpenAICompletions["_streamChatModelEvents"]>): ReturnType<ChatOpenAICompletions["_streamChatModelEvents"]> {
    this.pending.texts = reasoningOf(args[0]);
    yield* super._streamChatModelEvents(...args);
  }
}

/** Adds the pending reasoning to a JSON chat request body. Anything that is not such a body goes through unchanged. */
export function patchBody(body: unknown, texts: (string | undefined)[]): unknown {
  if (typeof body !== "string" || texts.every((t) => t === undefined)) return body;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("messages" in parsed) || !Array.isArray(parsed.messages)) return body;
    return JSON.stringify({ ...parsed, messages: withReasoning(parsed.messages as Param[], texts) });
  } catch {
    // Not JSON: send the body as it was.
    return body;
  }
}

/** A ChatOpenAI that sends `reasoning_content` back to providers that return it (DeepSeek thinking mode, some routers). */
export function reasoningChatOpenAI(fields: ChatOpenAIFields): ChatOpenAI {
  const pending = { texts: [] as (string | undefined)[] };
  const inner = fields.configuration?.fetch ?? fetch;
  const wrapped: typeof fetch = (input, init) => inner(input, init ? { ...init, body: patchBody(init.body, pending.texts) as BodyInit } : init);
  const withFetch: ChatOpenAIFields = { ...fields, configuration: { ...fields.configuration, fetch: wrapped } };
  return new ChatOpenAI({ ...withFetch, completions: new ReasoningCompletions(withFetch, pending) });
}
