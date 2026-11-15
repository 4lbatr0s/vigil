/**
 * Where to go after signing in: only a path on this site. Anything else (another host, a scheme,
 * a protocol-relative "//host", a backslash trick, control characters) becomes "/".
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\\\u0000-\u001f]/.test(next)) return "/";
  if (next.startsWith("/login")) return "/";
  return next;
}

/** The login page's message for a failed attempt. */
export function loginMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === "too-many-attempts") return "Too many tries. Wait a minute and try again.";
  if (code === "unauthorized") return "That token isn't right.";
  return "Can't reach the server.";
}
