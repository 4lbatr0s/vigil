import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { buildChatModel, redact } from "./llm";
import type { ResolvedConnection } from "./connections";

export type ToolProbeResult = { ok: boolean; message: string };

/**
 * Asks the model to call a harmless tool once. It costs a few tokens, so it runs only when the owner presses a button.
 * A model that answers in plain text, or a provider that rejects the `tools` field (HTTP 400), cannot run Vigil's agents,
 * and the owner is better told here than by a failed run.
 */
export async function probeTools(conn: ResolvedConnection, model: string, timeoutMs = 30_000): Promise<ToolProbeResult> {
  const ping = tool(async () => "pong", { name: "ping", description: "Replies with pong. Call it when asked.", schema: z.object({}) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const chat = buildChatModel(conn, [ping], model, 256, { signal: controller.signal });
    const reply = await chat.invoke([new HumanMessage("Call the ping tool now. Do not answer in words.")]);
    return (reply.tool_calls ?? []).some((c) => c.name === "ping")
      ? { ok: true, message: `${model} can call tools.` }
      : { ok: false, message: `${model} answered in words and did not call the tool. Agents with tools will not work with it. Choose a model that supports tool calls.` };
  } catch (err) {
    const text = redact(err instanceof Error ? err.message : "the request failed").slice(0, 300);
    return { ok: false, message: controller.signal.aborted ? "No answer within 30 seconds." : `The service rejected the test: ${text}` };
  } finally {
    clearTimeout(timer);
  }
}
