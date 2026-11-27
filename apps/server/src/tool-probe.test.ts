import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { probeTools } from "./tool-probe";
import type { ResolvedConnection } from "./connections";

let server: Server | null = null;
afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

/** A fake OpenAI-compatible endpoint that answers every chat request with `reply` (status 200 unless given). */
async function endpoint(message: Record<string, unknown>, status = 200): Promise<ResolvedConnection> {
  server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200
        ? JSON.stringify({ id: "c", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
        : JSON.stringify({ error: { message: "tools are not supported by this model" } }));
    });
  });
  await new Promise<void>((r) => server?.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { id: "t", name: "t", kind: "openai", baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: "k", model: undefined };
}

describe("probeTools", () => {
  it("passes a model that calls the tool", async () => {
    const conn = await endpoint({ role: "assistant", content: null, tool_calls: [{ id: "x", type: "function", function: { name: "ping", arguments: "{}" } }] });
    expect(await probeTools(conn, "m")).toEqual({ ok: true, message: "m can call tools." });
  });

  it("fails a model that answers in words, and says what to do", async () => {
    const conn = await endpoint({ role: "assistant", content: "pong!" });
    const r = await probeTools(conn, "m");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/answered in words/);
  });

  it("fails a provider that rejects tools, with the provider's reason and no key", async () => {
    const conn = await endpoint({}, 400);
    const r = await probeTools(conn, "m");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/rejected the test/);
    expect(r.message).not.toContain("Bearer");
  });
});
