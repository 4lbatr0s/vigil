import { z } from "zod";

export const NoteSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
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
