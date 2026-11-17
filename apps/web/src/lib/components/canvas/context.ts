import type { CardData } from "$lib/canvas";

/** What a card on the board may ask of the board. Set with `setContext` by the board, read by each card. */
export type CanvasContext = {
  /** Changes what a card holds (its text, label, link, color). Call `commit` when the edit is finished. */
  update(id: string, patch: Partial<CardData>): void;
  /** The change is done: save it and make it one undo step. */
  commit(): void;
  /** Title and first lines of a note once loaded, else null. `missing` when there is no such note. Reading it starts nothing: call `loadNote`. */
  noteInfo(noteId: string): { title: string; excerpt: string; missing: boolean } | null;
  /** Starts loading a note's card text if that has not happened yet. Call it from an effect, not while rendering. */
  loadNote(noteId: string): void;
  /** The card the board wants to start editing (Enter, the menu, a new card), or null. A card that finds its own id here calls `clearEdit` and begins editing. */
  wantsEdit(): string | null;
  clearEdit(): void;
};

export const CANVAS_KEY = Symbol("vigil-canvas");
