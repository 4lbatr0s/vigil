import { writable } from "svelte/store";

/**
 * Focus mode (2026-11-26): only the note is on screen. The sidebar, the top bar, the note list and the note's
 * toolbar are hidden. Turned on and off with ⌘⇧F (Ctrl Shift F), the palette or the note's menu; Escape leaves it.
 */
export const focusMode = writable(false);

export function isFocusShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): boolean {
  return (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f";
}
