/**
 * "Ask an agent about this note": the text for the chat box, and a hand-off through session storage
 * (so a long selection never travels in a URL). The person still presses Send.
 */

const KEY = (threadId: string): string => `vigil.chatDraft.${threadId}`;
const MAX_SELECTION = 4000;

export function askMessage(input: { noteId: string; title: string; selection: string | null; instruction: string }): string {
  const head = `About my note "${input.title}" (id: ${input.noteId}).`;
  const picked = input.selection?.trim() ?? "";
  const quote =
    picked === ""
      ? ""
      : `\n\nThe part I mean:\n${(picked.length > MAX_SELECTION ? `${picked.slice(0, MAX_SELECTION)}…` : picked)
          .split("\n")
          .map((l) => `> ${l}`)
          .join("\n")}`;
  return `${head}${quote}\n\n${input.instruction.trim()}`;
}

export function stashDraft(threadId: string, text: string): void {
  try {
    sessionStorage.setItem(KEY(threadId), text);
  } catch {
    // Without storage the chat simply opens empty.
  }
}

/** The stashed text for a chat, removed on read so a reload does not bring it back. */
export function takeDraft(threadId: string): string | null {
  try {
    const text = sessionStorage.getItem(KEY(threadId));
    if (text !== null) sessionStorage.removeItem(KEY(threadId));
    return text;
  } catch {
    return null;
  }
}
