import { extractCards, withoutCards } from "@vigil/shared";

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

export type StudyMode = "socratic-tutor" | "explain-it-back" | "quiz-master";

export const STUDY_MODES: { id: StudyMode; title: string; blurb: string; opener: string }[] = [
  { id: "socratic-tutor", title: "Tutor me", blurb: "Asks one question at a time and gives hints before answers.", opener: "Please tutor me on this note." },
  { id: "explain-it-back", title: "Explain it back", blurb: "You explain the note in your own words; it shows the gaps.", opener: "Please coach me to explain this note back." },
  { id: "quiz-master", title: "Quiz me", blurb: "Five mixed questions, one at a time, then what to review.", opener: "Please quiz me on this note." },
];

/** Chat messages are capped at 20,000 characters (server); leave room for the wrapper and the opener. */
export const STUDY_NOTE_MAX = 15_000;


/** The first message of a study chat: the note between markers (so the agent needs no tool), then what to do. */
export function studyMessage(input: { noteId: string; title: string; body: string; mode: StudyMode }): string {
  const opener = STUDY_MODES.find((m) => m.id === input.mode)?.opener ?? "";
  const text = withoutCards(input.body);
  const body = text.length > STUDY_NOTE_MAX ? `${text.slice(0, STUDY_NOTE_MAX)}\n[the note continues; only the first part is shown]` : text;
  return `${opener}\n\nNote "${input.title}" (id: ${input.noteId})\nNOTE START\n${body}\nNOTE END`;
}
