import { randomUUID } from "node:crypto";
import type { Run } from "@vigil/shared";
import { AppError } from "./errors";
import { getCheckpointer } from "./checkpoints";
import { withNoteLock } from "./lock";
import { reindexNote } from "./index-db";
import { effectiveAgent } from "./permissions";
import { picturesFor } from "./note-images";
import { runChatTurn } from "./runs";
import {
  addChatMessage,
  createChatThread,
  createRun,
  deleteChatThread,
  getAgent,
  getChatThread,
  hasRunning,
  hasWaitingApproval,
  listChatMessages,
  pendingForRun,
  setChatTitle,
  type ChatMessage,
  type ChatThread,
} from "./state-db";
import { assertAgentUnderDailyCap, assertUnderHardCap } from "./usage";
import { createNote, slugify, validateId } from "./vault";

export const MAX_CHAT_TEXT = 20_000;

/** One line of the turn stream. No line ever carries a key; errors are already redacted. */
export type ChatLine =
  | { type: "token"; text: string }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "call" | "result" }
  | { type: "approval"; approvalId: string }
  | { type: "done"; run: Run }
  | { type: "error"; message: string };

export function newChat(agentName: string): ChatThread {
  if (!getAgent(agentName)) throw new AppError("agent-not-found", `Agent not found: ${agentName}`, 404);
  return createChatThread(randomUUID(), agentName);
}

export function chatWithMessages(id: string): { thread: ChatThread; messages: ChatMessage[] } {
  const thread = getChatThread(id);
  if (!thread) throw new AppError("chat-not-found", `Chat not found: ${id}`, 404);
  return { thread, messages: listChatMessages(id) };
}

export async function removeChat(id: string): Promise<void> {
  if (!getChatThread(id)) throw new AppError("chat-not-found", `Chat not found: ${id}`, 404);
  await getCheckpointer().deleteThread(id);
  deleteChatThread(id);
}

/**
 * One turn of a chat. Everything that can be refused is checked first and throws before `begin()`
 * (so the HTTP layer can still answer with a normal error); after `begin()` problems arrive as
 * `error` lines. The user's message is stored before the model is called, the reply after.
 */
export async function chatTurn(threadId: string, text: string, begin: () => void, emit: (line: ChatLine) => void, signal: AbortSignal): Promise<void> {
  const thread = getChatThread(threadId);
  if (!thread) throw new AppError("chat-not-found", `Chat not found: ${threadId}`, 404);
  const trimmed = text.trim();
  if (trimmed === "") throw new AppError("invalid-body", "text must not be empty", 400);
  if (trimmed.length > MAX_CHAT_TEXT) throw new AppError("invalid-body", `text is longer than ${MAX_CHAT_TEXT} characters`, 400);
  const stored = getAgent(thread.agent);
  if (!stored) throw new AppError("agent-not-found", `Agent not found: ${thread.agent}`, 404);
  if (hasRunning(thread.agent)) {
    const waiting = hasWaitingApproval(thread.agent);
    throw new AppError("agent-busy", waiting ? `Agent ${thread.agent} is waiting for your approval. Decide its writes on the Approvals page, then send your message again.` : `Agent ${thread.agent} already has a run in progress`, 409);
  }
  assertUnderHardCap();
  assertAgentUnderDailyCap(stored.name, stored.dailyTokenCap);
  const agent = effectiveAgent(stored);

  // First turn means no conversation in the checkpoint yet (a failed first turn leaves none behind).
  const first = (await getCheckpointer().getTuple({ configurable: { thread_id: threadId } })) === undefined;
  const run = createRun(randomUUID(), agent.name, agent.tokenBudget, "chat");
  addChatMessage(threadId, "user", trimmed, run.id);
  if (thread.title === "New chat") setChatTitle(threadId, trimmed.replace(/\s+/g, " ").slice(0, 60));

  // The opening message of a study helper (no tools) may carry the note's own pictures, when the owner allows it.
  const images = first && agent.tools.length === 0 ? await picturesFor(trimmed) : [];

  begin();
  const finished = await runChatTurn({
    agent,
    runId: run.id,
    text: trimmed,
    threadId,
    first,
    ...(images.length > 0 ? { images } : {}),
    signal,
    onEvent: (e) => emit(e),
  });

  if (finished.status === "waiting-approval") {
    for (const a of pendingForRun(finished.id)) emit({ type: "approval", approvalId: a.id });
  } else if (finished.status === "succeeded") {
    emit({ type: "done", run: finished });
  } else {
    emit({ type: "error", message: finished.error ?? `The turn ended: ${finished.status}` });
  }
}

/** Save the conversation as a note `Chat <title>` (a person's save, so author human). Picks a free name. */
export async function saveChatAsNote(threadId: string): Promise<{ id: string; title: string }> {
  const { thread, messages } = chatWithMessages(threadId);
  const speaker = (m: ChatMessage): string => (m.role === "user" ? "You" : m.role === "assistant" ? thread.agent : "Error");
  const body = messages.map((m) => `**${speaker(m)}**\n\n${m.content}`).join("\n\n---\n\n");
  const base = `Chat ${thread.title}`;
  return withNoteLock(async () => {
    for (let n = 1; n <= 50; n++) {
      const title = n === 1 ? base : `${base} (${n})`;
      try {
        validateId(slugify(title));
        const note = await createNote({ title, body });
        reindexNote(note);
        return { id: note.id, title: note.title };
      } catch (err) {
        if (err instanceof AppError && err.code === "note-exists") continue;
        throw err;
      }
    }
    throw new AppError("note-exists", "Could not find a free note name for this chat", 409);
  });
}
