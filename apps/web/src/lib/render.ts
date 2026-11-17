import DOMPurify from "dompurify";
import { marked } from "marked";

/** Vault images are linked as `attachments/<name>`; the app serves them from the API (ADR-0021). */
const VAULT_IMAGE = /(<img\b[^>]*?\ssrc=")attachments\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))"/g;

/** Markdown -> sanitized HTML. */
export function renderMarkdown(body: string): string {
  const html = marked.parse(body, { async: false }).replace(VAULT_IMAGE, "$1/api/attachments/$2\"");
  return DOMPurify.sanitize(html);
}
