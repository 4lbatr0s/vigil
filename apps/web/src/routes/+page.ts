import { redirect } from "@sveltejs/kit";
import { notesRedirect } from "$lib/links";

/** `/` is Today. An old Notes link (`/?note=…`, `/?daily=…`, `/?new=1`, …) goes on to `/notes` with its query. */
export function load({ url }: { url: URL }): void {
  const to = notesRedirect(url);
  if (to) redirect(307, to);
}
