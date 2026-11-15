/**
 * What the service worker may cache. Only the app's own files: the shell and the hashed build assets.
 * Nothing under /api/ is ever cached (notes, runs and the login all live there), and neither is
 * anything from another origin.
 */
export function shouldCache(url: URL, origin: string): boolean {
  if (url.origin !== origin) return false;
  if (url.pathname.startsWith("/api/")) return false;
  return true;
}

/** True for a request the worker must send straight to the network and never touch. */
export function isNetworkOnly(url: URL, method: string, origin: string): boolean {
  return method !== "GET" || !shouldCache(url, origin);
}
