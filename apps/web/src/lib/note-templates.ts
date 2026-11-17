import { dailyNote } from "./daily";

export type NoteTemplate = { id: string; label: string; title: (day: string) => string; body: string };

/**
 * Starting points for a new note. They are plain text, and the lecture one is shaped around what the
 * research says helps: putting ideas in your own words and testing yourself, not copying what you hear.
 */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "lecture",
    label: "New lecture note",
    title: (day) => `Lecture ${day}`,
    body: `## Key ideas in my own words\n\n\n## What I did not understand\n\n\n## Cards\n`,
  },
  {
    id: "meeting",
    label: "New meeting note",
    title: (day) => `Meeting ${day}`,
    body: `## Who\n\n\n## Decisions\n\n\n## Next steps\n- [ ] \n`,
  },
  {
    id: "cornell",
    label: "New Cornell note",
    title: (day) => `Cornell ${day}`,
    body: `## Notes\n\n\n## Cue questions\nWrite a question for each part of your notes, then answer it from memory.\n\n\n## Summary in my own words\n\n\n## Cards\n`,
  },
  {
    id: "reading",
    label: "New reading note",
    title: (day) => `Reading ${day}`,
    body: `## Source\n\n\n## The main claim, in my own words\n\n\n## Quotes worth keeping\n\n\n## Cards\n`,
  },
];

export const templateById = (id: string): NoteTemplate | undefined => NOTE_TEMPLATES.find((t) => t.id === id);

/** The id and title for a note from a template on `now`'s day. If that note exists the page just opens it. */
export function fromTemplate(t: NoteTemplate, now: Date = new Date()): { id: string; title: string; body: string } {
  const { id: day } = dailyNote(now);
  const title = t.title(day);
  return { id: title.toLowerCase().replace(/\s+/g, "-"), title, body: t.body };
}
