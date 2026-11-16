import { slugify } from "@vigil/shared";
import { AppError } from "./errors";
import { reindexNote, removeNote } from "./index-db";
import { withNoteLock } from "./lock";
import { rewriteLinks } from "./links";
import { movePin } from "./state-db";
import { getNote, listNotes, moveNote, readNoteFile, replaceBody, restoreNoteFile, validateId } from "./vault";
import { deleteNote } from "./vault";
import type { Note } from "@vigil/shared";

export type RenamePlan = {
  newId: string;
  /** Other notes whose links will change (the renamed note's own self-links are not listed). */
  notesToChange: string[];
  titles: string[];
};

type Edit = { id: string; body: string };

/** What a rename would do, computed from the vault itself (not the index) so a stale index cannot hide a link. */
async function plan(id: string, title: string): Promise<{ result: RenamePlan; edits: Edit[]; self: Note; newId: string }> {
  const trimmed = title.trim();
  if (trimmed === "") throw new AppError("invalid-body", "Title must not be empty", 400);
  const newId = validateId(slugify(trimmed));
  const self = await getNote(id); // 404 if missing
  if (newId !== id) {
    const taken = await readNoteFile(newId);
    if (taken !== null) throw new AppError("note-exists", `A note with the id ${newId} already exists`, 409);
  }
  const edits: Edit[] = [];
  const titles: string[] = [];
  if (newId !== id) {
    for (const note of await listNotes()) {
      if (note.id === id) continue;
      const { body, count } = rewriteLinks(note.body, id, newId, trimmed);
      if (count > 0) {
        edits.push({ id: note.id, body });
        titles.push(note.title);
      }
    }
  }
  return { result: { newId, notesToChange: edits.map((e) => e.id), titles }, edits, self, newId };
}

/** Dry run: nothing is written. */
export async function planRename(id: string, title: string): Promise<RenamePlan> {
  return withNoteLock(async () => (await plan(id, title)).result);
}

/**
 * Rename a note: new id from the new title, file moved, frontmatter id and title updated, and every
 * link to it in other notes rewritten. All inside the note lock. If a write fails, the files already
 * changed are put back from memory and the error is 500 `rename-failed`.
 */
export function renameNote(id: string, title: string): Promise<Note> {
  return withNoteLock(async () => {
    const { edits, self, newId } = await plan(id, title);
    const trimmed = title.trim();

    // Self-links (the note linking to its own old title) are rewritten as part of the move.
    const ownBody = newId === id ? self.body : rewriteLinks(self.body, id, newId, trimmed).body;

    const originals = new Map<string, string>();
    let moved = false;
    try {
      for (const e of edits) {
        const raw = await readNoteFile(e.id);
        if (raw === null) throw new Error(`${e.id} vanished`);
        originals.set(e.id, raw);
        await replaceBody(e.id, e.body);
      }
      const note = await moveNote(id, newId, trimmed, ownBody);
      moved = true;

      // The files are done; now the index.
      for (const e of edits) reindexNote(await getNote(e.id));
      if (newId !== id) removeNote(id);
      reindexNote(note);
      movePin(id, newId);
      return note;
    } catch (err) {
      // Put everything back as it was. Each step is best effort so one failure does not hide the others.
      const problems: string[] = [];
      for (const [noteId, raw] of originals) {
        await restoreNoteFile(noteId, raw).catch((e: unknown) => problems.push(`${noteId}: ${e instanceof Error ? e.message : "restore failed"}`));
      }
      if (moved && newId !== id) {
        // The old file is gone and the new one exists: move it back to the old id.
        const current = await getNote(newId).catch(() => null);
        if (current) await moveNote(newId, id, self.title, self.body).catch((e: unknown) => problems.push(`move back: ${e instanceof Error ? e.message : "failed"}`));
      } else if (newId !== id) {
        await deleteNote(newId).catch(() => undefined); // only exists if moveNote wrote it before failing
      }
      for (const noteId of [...originals.keys(), id]) {
        const back = await getNote(noteId).catch(() => null);
        if (back) reindexNote(back);
      }
      if (newId !== id) removeNote(newId);
      const detail = err instanceof Error ? err.message : "unknown error";
      throw new AppError("rename-failed", `Rename failed and was rolled back: ${detail}${problems.length ? `. Some files could not be restored: ${problems.join("; ")}` : ""}`, 500);
    }
  });
}
