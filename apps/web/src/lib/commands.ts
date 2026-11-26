import { rank } from "./fuzzy";
import { NOTES_PATH, noteHref } from "./links";
import { NOTE_TEMPLATES } from "./note-templates";

export type Action = { type: "goto"; href: string } | { type: "run"; agent: string };
export type Command = { id: string; label: string; group: "Notes" | "Agents" | "Commands"; hint?: string; action: Action };

export type PaletteState = {
  query: string;
  noteHits: { id: string; title: string }[];
  agents: string[];
};

const FIXED: Command[] = [
  { id: "cmd:new-note", label: "New note", group: "Commands", action: { type: "goto", href: `${NOTES_PATH}?new=1` } },
  { id: "cmd:daily", label: "Today's note", group: "Commands", hint: "daily note", action: { type: "goto", href: `${NOTES_PATH}?daily=1` } },
  { id: "cmd:study", label: "Study cards", group: "Commands", action: { type: "goto", href: "/study" } },
  { id: "cmd:today", label: "Open Today", group: "Commands", action: { type: "goto", href: "/" } },
  { id: "cmd:notes", label: "Open Notes", group: "Commands", action: { type: "goto", href: NOTES_PATH } },
  ...NOTE_TEMPLATES.map((t): Command => ({ id: `cmd:template:${t.id}`, label: t.label, group: "Commands", hint: "template", action: { type: "goto", href: `${NOTES_PATH}?template=${t.id}` } })),
  { id: "cmd:ask", label: "Ask your notes", group: "Commands", hint: "answers with sources", action: { type: "goto", href: "/ask" } },
  { id: "cmd:gap", label: "Gap check", group: "Commands", hint: "compare a text with your notes", action: { type: "goto", href: "/gap" } },
  { id: "cmd:canvas", label: "Open Canvas", group: "Commands", hint: "boards", action: { type: "goto", href: "/canvas" } },
  { id: "cmd:chat", label: "New chat", group: "Commands", action: { type: "goto", href: "/chat?new=1" } },
  { id: "cmd:graph", label: "Open Graph", group: "Commands", action: { type: "goto", href: "/graph" } },
  { id: "cmd:agents", label: "Open Helpers", hint: "agents", group: "Commands", action: { type: "goto", href: "/agents" } },
  { id: "cmd:settings", label: "Open Settings", group: "Commands", action: { type: "goto", href: "/settings" } },
  { id: "cmd:approvals", label: "Open Approvals", group: "Commands", action: { type: "goto", href: "/approvals" } },
];

/**
 * Everything the palette can show for the current query, best first inside each group:
 * notes (from the server's search), agents by name, "Run <agent>" commands, and the fixed commands.
 * "Run agent..." is the typed prefix "run": each agent then appears as its own Run command.
 */
export function buildCommands(state: PaletteState): Command[] {
  const q = state.query.trim();
  const notes: Command[] = state.noteHits.map((h) => ({ id: `note:${h.id}`, label: h.title || h.id, group: "Notes", action: { type: "goto", href: noteHref(h.id) } }));
  const agents: Command[] = rank(state.agents, q, (a) => a).map((a) => ({ id: `agent:${a}`, label: a, group: "Agents", hint: "open", action: { type: "goto", href: `/agents/${encodeURIComponent(a)}` } }));
  const runs: Command[] = state.agents.map((a) => ({ id: `run:${a}`, label: `Run ${a}`, group: "Commands", hint: "run now", action: { type: "run", agent: a } }));
  const commands = rank([...FIXED, ...runs], q, (c) => c.label);
  return q === "" ? [...FIXED] : [...notes, ...agents, ...commands];
}
