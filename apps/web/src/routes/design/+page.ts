import { dev } from "$app/environment";
import { redirect } from "@sveltejs/kit";

/** The style guide is a development tool: it is not reachable in a production build. */
export function load() {
  if (!dev) redirect(307, "/");
}
