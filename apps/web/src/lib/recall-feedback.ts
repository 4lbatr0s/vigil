/**
 * The "Check:" part of the recall checker's reply: bullets of things the learner wrote that disagree with the
 * note. Empty when the section is missing or says None. The reply is free text from a model, so this only reads
 * what is clearly a bullet under a line that starts with "Check".
 */
export function checkItems(feedback: string, max = 5): string[] {
  const lines = feedback.split("\n").map((l) => l.trim());
  const start = lines.findIndex((l) => /^[*_#\s-]*check\b[^a-z]*:?[*_\s]*$/i.test(l) || /^[*_#\s-]*check[*_\s]*:[*_\s]*\S/i.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  const first = lines[start]!.replace(/^[*_#\s-]*check[*_\s]*:[*_\s]*/i, "");
  const rest = [first, ...lines.slice(start + 1)];
  for (const line of rest) {
    if (line === "") {
      if (out.length > 0) break;
      continue;
    }
    if (/^[*_#\s-]*(remembered|missed)\b[^a-z]*:/i.test(line)) break;
    const text = line.replace(/^[-*•]\s+/, "").replace(/^\*\*|\*\*$/g, "").trim();
    if (/^none\.?$/i.test(text)) return [];
    if (text.length >= 3) out.push(text.slice(0, 300));
    if (out.length >= max) break;
  }
  return out;
}
