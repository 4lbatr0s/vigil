/** A line of markdown as the words a reader sees: no list, heading, quote or task markers, and links as their text. */
export function plainSnippet(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*\[[ xX]\]\s+/, "")
    .replace(/^\s*(?:#{1,6}|>)\s*/, "")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|`)/g, "")
    .trim();
}
