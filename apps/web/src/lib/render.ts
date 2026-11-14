import DOMPurify from "dompurify";
import { marked } from "marked";

/** Markdown -> sanitized HTML. */
export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false });
  return DOMPurify.sanitize(html);
}
