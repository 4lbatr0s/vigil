import { z } from "zod";

/** Who wrote the note last. Drives the amber "agent-written" look (ADR-0005). */
export const AuthorSchema = z.enum(["human", "agent"]);
export type Author = z.infer<typeof AuthorSchema>;

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  tags: z.array(z.string()).default([]),
  author: AuthorSchema.default("human"),
  /** File modification time, so edits made outside the API (Obsidian, agents) still count. */
  updatedAt: z.string(),
});

export type Note = z.infer<typeof NoteSchema>;

/** Lowercase, dash-separated, [a-z0-9-] only, max 80 chars. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
