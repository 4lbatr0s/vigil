import { redirect } from "@sveltejs/kit";

/** The Tools hub is gone (2026-11-26): its learning tools live under Study, Ask has its own place in the navigation. */
export function load(): never {
  redirect(308, "/study");
}
