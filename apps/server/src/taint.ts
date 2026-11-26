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

/** Hosts whose `fetch_url` call in an earlier round returned a page (an answer that is not `error: ...`). */
export function fetchedHosts(messages: BaseMessage[]): Set<string> {
  const urlById = new Map<string, unknown>();
  for (const m of messages) {
    if (AIMessage.isInstance(m)) for (const c of m.tool_calls ?? []) if (c.name === "fetch_url" && c.id) urlById.set(c.id, c.args["url"]);
  }
  const hosts = new Set<string>();
  for (const m of messages) {
    if (!ToolMessage.isInstance(m) || !urlById.has(m.tool_call_id)) continue;
    if (String(m.content).startsWith("error:")) continue;
    const host = hostOf(urlById.get(m.tool_call_id));
    if (host) hosts.add(host);
  }
  return hosts;
}

/** Why this fetch is refused after a page is in the run, or null when it may go ahead. */
export function taintProblem(url: unknown, messages: BaseMessage[]): string | null {
  const seen = fetchedHosts(messages);
  if (seen.size === 0) return null;
  const host = hostOf(url);
  if (host === null) return null;
  let query = "";
  try {
    query = new URL(String(url)).search;
  } catch {
    query = "";
  }
  if (!seen.has(host)) return `error: this run already read a web page, so it may fetch only from ${[...seen].join(", ")} now. ${host} is a new host. Finish with what you have, or ask the owner to run you again.`;
  if (query !== "") return "error: this run already read a web page, so a fetch may not carry a query string (?...) now. Use an address without one.";
  return null;
}
