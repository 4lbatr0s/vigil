import { z } from "zod";
import { withNoteLock } from "./lock";
import { reindexNote } from "./index-db";
import { createNote, getNote, updateNote } from "./vault";

/** Quick capture: one line added to the end of the note titled "Inbox" (ADR-0024). The learner's own write, as if typed there. */

export const INBOX_ID = "inbox";
export const INBOX_TITLE = "Inbox";
export const CaptureBodySchema = z.object({ text: z.string().trim().min(1).max(2000) });

/** One line: line breaks become spaces, and a leading bullet is not doubled. */
export function captureLine(text: string): string {
  const one = text.replace(/\s*\n+\s*/g, " ").replace(/^[-*]\s+/, "").trim();
  return `- ${one}`;
}

export async function capture(text: string): Promise<{ id: string; line: string }> {
  const line = captureLine(text);
  await withNoteLock(async () => {
    const existing = await getNote(INBOX_ID).catch(() => null);
    const saved = existing
      ? await updateNote(INBOX_ID, { body: `${existing.body.replace(/\s+$/, "")}\n${line}\n` })
      : await createNote({ title: INBOX_TITLE, body: `${line}\n` });
    reindexNote(saved);
  });
  return { id: INBOX_ID, line };
}
