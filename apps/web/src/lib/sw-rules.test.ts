import { describe, expect, it } from "vitest";
import { isNetworkOnly, shouldCache } from "./sw-rules";

const origin = "https://notes.example.com";
const u = (p: string) => new URL(p, origin);

describe("service worker rules", () => {
  it("never caches the API, whatever the path or query", () => {
    for (const p of ["/api/notes", "/api/notes/a", "/api/events", "/api/login", "/api/session", "/api/chats/1/messages", "/api/health?x=1"]) {
      expect(shouldCache(u(p), origin), p).toBe(false);
    }
  });
  it("caches the app's own build assets and pages", () => {
    for (const p of ["/_app/immutable/chunks/abc.js", "/_app/immutable/assets/x.css", "/", "/agents", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      expect(shouldCache(u(p), origin), p).toBe(true);
    }
  });
  it("never caches another origin", () => {
    expect(shouldCache(new URL("https://cdn.example.net/_app/x.js"), origin)).toBe(false);
  });
  it("sends non-GET requests and API calls straight to the network", () => {
    expect(isNetworkOnly(u("/agents"), "POST", origin)).toBe(true);
    expect(isNetworkOnly(u("/api/notes"), "GET", origin)).toBe(true);
    expect(isNetworkOnly(u("/_app/immutable/a.js"), "GET", origin)).toBe(false);
  });
});
