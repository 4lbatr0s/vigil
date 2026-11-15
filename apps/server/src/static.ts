import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** The directory holding the built web app, or null when the server runs API-only. */
export function staticDir(): string | null {
  const dir = process.env.VIGIL_STATIC_DIR;
  return dir ? path.resolve(dir) : null;
}

const FALLBACK_CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

let cspCache: { file: string; mtime: number; value: string } | null = null;

/**
 * The Content-Security-Policy for static responses. SvelteKit's static build inlines one bootstrap
 * script and allows it by hash in a <meta> policy; a header-only policy without that hash would block
 * the app, so the header is built from the same policy in index.html plus the directives a meta tag
 * cannot carry (frame-ancestors). No 'unsafe-inline' for scripts, ever.
 */
export function contentSecurityPolicy(dir: string): string {
  const file = path.join(dir, "index.html");
  try {
    const mtime = statSync(file).mtimeMs;
    if (cspCache && cspCache.file === file && cspCache.mtime === mtime) return cspCache.value;
    const html = readFileSync(file, "utf8");
    const meta = /<meta[^>]+http-equiv="content-security-policy"[^>]+content="([^"]*)"/i.exec(html);
    let value = FALLBACK_CSP;
    if (meta?.[1]) {
      value = meta[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      if (!/frame-ancestors/.test(value)) value += "; frame-ancestors 'none'";
    }
    cspCache = { file, mtime, value };
    return value;
  } catch {
    return FALLBACK_CSP;
  }
}

function securityHeaders(dir: string): Record<string, string> {
  return {
    "content-security-policy": contentSecurityPolicy(dir),
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  };
}

function plain(res: ServerResponse, status: number, text: string, dir: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...securityHeaders(dir) });
  res.end(text);
}

/**
 * Serve the web app for a GET or HEAD outside /api/. Returns true when the request was handled.
 * The path is decoded once, must stay inside the directory, and never contains a NUL; an unknown path
 * with a file extension is 404, an unknown path without one gets index.html (SPA routing).
 */
export function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  const dir = staticDir();
  if (!dir) return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    plain(res, 400, "Bad request", dir);
    return true;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    plain(res, 404, "Not found", dir);
    return true;
  }

  let file = path.resolve(dir, `.${decoded}`);
  if (file !== dir && !file.startsWith(dir + path.sep)) {
    plain(res, 404, "Not found", dir);
    return true;
  }
  let info = existsSync(file) ? statSync(file) : null;
  if (info?.isDirectory()) {
    file = path.join(file, "index.html");
    info = existsSync(file) ? statSync(file) : null;
  }
  if (!info || !info.isFile()) {
    if (path.extname(decoded) !== "") {
      plain(res, 404, "Not found", dir);
      return true;
    }
    file = path.join(dir, "index.html"); // client-side routes
    info = existsSync(file) ? statSync(file) : null;
    if (!info) {
      plain(res, 404, "Not found", dir);
      return true;
    }
  }

  const ext = path.extname(file).toLowerCase();
  const immutable = decoded.startsWith("/_app/immutable/");
  res.writeHead(200, {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "content-length": info.size,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    ...securityHeaders(dir),
  });
  if (req.method === "HEAD") {
    res.end();
  } else {
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }
  return true;
}
