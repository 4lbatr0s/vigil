/**
 * Flow rule after a page fetch (todo item 47). A web page is untrusted text that can carry instructions. Once one is in a
 * run, a later fetch could carry note text out in its address, so it is held to what the run already did: the same host,
 * and no query string. This is checked in code, not asked of the model (CaMeL; "Design patterns for securing LLM agents").
 */
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

const hostOf = (url: unknown): string | null => {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null; // not a URL: fetch_url refuses it with its own message
  }
};

/** After a page, the longest path a fetch may have. Each piece is already capped at 80 characters (`addressProblem`). */
export const TAINTED_MAX_PATH = 100;

/**
 * Whether untrusted web text is in the run, and the hosts the run read pages from. A page counts when a `fetch_url` call
 * returned one (an answer that is not `error: ...`). Every answer from another agent (`call_agent`) counts too, with no
 * host: the child may have read a page and passed its text on, and its text may even look like an error.
 */
export function fetchedHosts(messages: BaseMessage[]): { tainted: boolean; hosts: Set<string> } {
  const callById = new Map<string, { name: string; url: unknown }>();
  for (const m of messages) {
    if (AIMessage.isInstance(m)) for (const c of m.tool_calls ?? []) if (c.id && (c.name === "fetch_url" || c.name === "call_agent")) callById.set(c.id, { name: c.name, url: c.args["url"] });
  }
  const hosts = new Set<string>();
  let tainted = false;
  for (const m of messages) {
    const call = ToolMessage.isInstance(m) ? callById.get(m.tool_call_id) : undefined;
    if (!call) continue;
    // A fetch_url answer that starts with "error:" comes from Vigil (a page always starts with its address). A call_agent
    // answer is the child's own text, which a page can shape to look like an error, so every one counts.
    if (call.name === "fetch_url" && String(m.content).startsWith("error:")) continue;
    tainted = true;
    const host = call.name === "fetch_url" ? hostOf(call.url) : null;
    if (host) hosts.add(host);
  }
  return { tainted, hosts };
}

/** Why this fetch is refused after a page is in the run, or null when it may go ahead. */
export function taintProblem(url: unknown, messages: BaseMessage[]): string | null {
  const { tainted, hosts: seen } = fetchedHosts(messages);
  if (!tainted) return null;
  const host = hostOf(url);
  if (host === null) return null;
  let query = "";
  let pathLength = 0;
  try {
    const parsed = new URL(String(url));
    query = parsed.search;
    pathLength = parsed.pathname.length;
  } catch {
    query = ""; // not a URL: fetch_url refuses it with its own message
  }
  if (!seen.has(host)) {
    const allowed = seen.size > 0 ? `it may fetch only from ${[...seen].join(", ")} now` : "it may not fetch from a new host now";
    return `error: this run already read web text (a page or another agent's answer), so ${allowed}. ${host} is a new host. Finish with what you have, or ask the owner to run you again.`;
  }
  if (query !== "") return "error: this run already read a web page, so a fetch may not carry a query string (?...) now. Use an address without one.";
  if (pathLength > TAINTED_MAX_PATH) return `error: this run already read a web page, so a fetch address may have a path of at most ${TAINTED_MAX_PATH} characters now.`;
  return null;
}
