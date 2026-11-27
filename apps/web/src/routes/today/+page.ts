import { redirect } from "@sveltejs/kit";

/** Today is the home page now (ADR-0035 redesign, 2026-11-26); old links and bookmarks to /today land there. */
export function load(): never {
  redirect(308, "/");
}
