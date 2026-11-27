/**
 * Two cheap guards for text an agent reads from the web. Neither is complete (nothing is): they remove the commonest tricks
 * and make the rest easy to see. The real protection stays what it was: a short list of allowed sites, approvals before
 * writes, and no tool that sends data anywhere but a GET to one of those sites.
 */

const INSTRUCTION = [
  /ignore (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier) (instructions|prompts?|rules)/i,
  /(you are|you're) now\b/i,
  /\bnew instructions?\s*:/i,
  /\b(system|developer) (prompt|message)\b/i,
  /\bas an ai (assistant|model)\b.*\b(must|should|now)\b/i,
  /\b(send|post|upload|email|forward|exfiltrate)\b.{0,60}\b(notes?|vault|api key|password|secret)s?\b/i,
  /<\s*\/?\s*(system|assistant|tool)\s*>/i,
];

export type Scrubbed = { text: string; removed: number };

/** Lines that look like orders to an AI are replaced by a marker, and the count is returned so the agent can be told. */
export function scrubUntrusted(text: string): Scrubbed {
  let removed = 0;
  const out = text.split("\n").map((line) => {
    if (INSTRUCTION.some((re) => re.test(line))) {
      removed += 1;
      return "[a line that looked like an instruction to an AI was removed]";
    }
    return line;
  });
  return { text: out.join("\n"), removed };
}

const MAX_QUERY = 120;

/**
 * A request can carry a note to a site in its address (`?q=...the whole note...`). Addresses with a long query or a long
 * unreadable path piece are refused, so a fetch stays a way to read a page, not to send text.
 */
export function addressProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null; // not an address: the fetch itself will say so
  }
  if (url.search.length > MAX_QUERY) return `That address is too long to be a normal page link (its query is over ${MAX_QUERY} characters). Page text must not be sent in an address.`;
  if (url.username !== "" || url.password !== "") return "Addresses with a user name or password are not allowed.";
  if (url.pathname.split("/").some((seg) => seg.length > 80)) return "That address has a very long path piece. Page text must not be sent in an address.";
  return null;
}

/**
 * A state note is written by an agent that has read notes and web pages, so it can carry what an attacker planted there.
 * Clean it when it is saved and again when it is loaded: instruction-like lines go, and the words that frame the note
 * are removed so the text cannot close the frame early.
 */
export function cleanStateNote(text: string): string {
  return scrubUntrusted(text).text.replace(/STATE NOTE (START|END)/gi, "[marker removed]");
}
