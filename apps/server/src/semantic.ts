import { EMBED_BATCH, dropVectors, embedModel, embedTexts, fuse, loadVectors, nearest, noteText, saveVector, textHash, type Vec } from "./embeddings";
import { indexDb, notesForEmbedding, onNoteIndexed, searchNotesAny } from "./index-db";

/**
 * Keeps one vector per note up to date in the background and answers "which notes are closest in meaning". All of it is
 * optional: with no embedding model set, every function here returns nothing and the word search stands alone.
 */

export type SemanticStatus = { model: string | null; notes: number; embedded: number; working: boolean; error: string | null };

let working = false;
let lastError: string | null = null;
let cache: { model: string; vectors: ReturnType<typeof loadVectors> } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

const freshVectors = (model: string): ReturnType<typeof loadVectors> => {
  if (!cache || cache.model !== model) cache = { model, vectors: loadVectors(indexDb(), model) };
  return cache.vectors;
};

/** Embeds every note that has none yet or changed since. One run at a time; a failure is kept for the status line. */
export async function syncVectors(): Promise<void> {
  const model = embedModel();
  if (model === null || working) return;
  working = true;
  try {
    const db = indexDb();
    const notes = notesForEmbedding();
    const have = loadVectors(db, model);
    const todo = notes.filter((n) => have.get(n.id)?.hash !== textHash(model, noteText(n.title, n.body)));
    for (let i = 0; i < todo.length; i += EMBED_BATCH) {
      const batch = todo.slice(i, i + EMBED_BATCH);
      const vecs = await embedTexts(batch.map((n) => noteText(n.title, n.body)), model);
      batch.forEach((n, j) => {
        const v = vecs[j];
        if (v) saveVector(db, n.id, textHash(model, noteText(n.title, n.body)), model, v);
      });
    }
    dropVectors(db, new Set(notes.map((n) => n.id)));
    cache = null;
    lastError = null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Meaning search could not embed your notes.";
  } finally {
    working = false;
  }
}

/** Follows note changes with a short pause, so a burst of saves is embedded once. */
export function startSemanticIndex(): void {
  onNoteIndexed(() => {
    if (embedModel() === null) return;
    clearTimeout(timer);
    timer = setTimeout(() => void syncVectors(), 3000);
  });
  void syncVectors();
}

export function semanticStatus(): SemanticStatus {
  const model = embedModel();
  if (model === null) return { model, notes: 0, embedded: 0, working, error: lastError };
  return { model, notes: notesForEmbedding().length, embedded: freshVectors(model).size, working, error: lastError };
}

async function queryVector(text: string, model: string): Promise<Vec | null> {
  try {
    return (await embedTexts([text], model))[0] ?? null;
  } catch (err) {
    lastError = err instanceof Error ? err.message : "Meaning search could not read the question.";
    return null;
  }
}

/** Ids of the notes closest in meaning to a piece of text. Empty when meaning search is off or has nothing yet. */
export async function semanticIds(text: string, limit: number): Promise<string[]> {
  const model = embedModel();
  if (model === null) return [];
  const vectors = freshVectors(model);
  if (vectors.size === 0) return [];
  const q = await queryVector(text, model);
  return q ? nearest(vectors, q, limit).map((r) => r.id) : [];
}

/** Notes closest in meaning to one note (not itself). Uses its stored vector, so no model call is needed. */
export function relatedIds(noteId: string, limit: number): { id: string; score: number }[] {
  const model = embedModel();
  if (model === null) return [];
  const vectors = freshVectors(model);
  const mine = vectors.get(noteId);
  return mine ? nearest(vectors, mine.vec, limit, noteId, 0.3) : [];
}

/** Word search and meaning search merged, best first. With meaning search off it is the word search. */
export async function hybridIds(question: string, words: string[], limit: number): Promise<string[]> {
  const byWords = searchNotesAny(words, limit);
  const byMeaning = await semanticIds(question, limit);
  return byMeaning.length === 0 ? byWords : fuse([byWords, byMeaning], limit);
}
