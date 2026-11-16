import { SystemMessage, type BaseMessage } from "@langchain/core/messages";

/** About 12k tokens of recent conversation (characters / 4). Older turns stay in the checkpoint, not in the prompt. */
export const DEFAULT_HISTORY_CHARS = 48_000;

const size = (m: BaseMessage): number => (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length) + JSON.stringify((m as { tool_calls?: unknown }).tool_calls ?? []).length;

/**
 * The messages to send to the model. Every chat turn used to re-send the whole conversation, so a long
 * chat got slower and dearer with each message. This keeps the system message plus the newest messages
 * that fit `maxChars`, and:
 * - starts the kept part at a user message, so a tool result is never separated from the assistant message
 *   that asked for it (providers reject that);
 * - never drops the current turn (from the last user message on), however large it is.
 * It returns the same array when nothing needs to go.
 */
export function trimHistory(messages: BaseMessage[], maxChars: number = DEFAULT_HISTORY_CHARS): BaseMessage[] {
  const system = messages[0] instanceof SystemMessage ? messages[0] : null;
  const body = system ? messages.slice(1) : messages;
  const total = body.reduce((n, m) => n + size(m), 0);
  if (total <= maxChars) return messages;

  let lastHuman = -1;
  for (let i = body.length - 1; i >= 0; i--) {
    if (body[i]?._getType() === "human") {
      lastHuman = i;
      break;
    }
  }
  if (lastHuman <= 0) return messages;

  // Walk back over whole turns (each starts at a user message) while they still fit.
  let start = lastHuman;
  let used = body.slice(lastHuman).reduce((n, m) => n + size(m), 0);
  for (let i = lastHuman - 1; i >= 0; i--) {
    const m = body[i];
    if (!m) continue;
    used += size(m);
    if (used > maxChars) break;
    if (m._getType() === "human") start = i;
  }
  const kept = body.slice(start);
  return system ? [system, ...kept] : kept;
}
