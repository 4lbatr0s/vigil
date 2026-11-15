import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { llmStatus } from "./llm-status";

let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

function stub(handler: (url: string, auth: string | undefined) => number): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      res.statusCode = handler(req.url ?? "", req.headers.authorization);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server?.address();
      resolve(`http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`);
    });
  });
}

describe("llmStatus", () => {
  it("reports config without probing and never contains the key", async () => {
    const env = { VIGIL_LLM_PROVIDER: "openai", VIGIL_LLM_BASE_URL: "http://127.0.0.1:1", VIGIL_LLM_API_KEY: "sk-secret-value-123456", VIGIL_LLM_MODEL: "m" };
    const status = await llmStatus(false, env);
    expect(status).toEqual({ provider: "openai", baseUrl: "http://127.0.0.1:1", model: "m", hasKey: true, reachable: null });
    expect(JSON.stringify(status)).not.toContain("sk-secret-value-123456");
  });

  it("probes ollama at /api/tags", async () => {
    const seen: string[] = [];
    const base = await stub((url) => (seen.push(url), 200));
    expect((await llmStatus(true, { VIGIL_LLM_PROVIDER: "ollama", VIGIL_LLM_BASE_URL: base })).reachable).toBe(true);
    expect(seen).toEqual(["/api/tags"]);
  });

  it("probes openai at /models with the key and reports false on a 401", async () => {
    let auth: string | undefined;
    const base = await stub((_url, a) => ((auth = a), 401));
    const status = await llmStatus(true, { VIGIL_LLM_PROVIDER: "openai", VIGIL_LLM_BASE_URL: base, VIGIL_LLM_API_KEY: "sk-abcdef123456789" });
    expect(auth).toBe("Bearer sk-abcdef123456789");
    expect(status.reachable).toBe(false);
    expect(JSON.stringify(status)).not.toContain("sk-abcdef123456789");
  });

  it("gives false, not an error, when nothing listens", async () => {
    expect((await llmStatus(true, { VIGIL_LLM_PROVIDER: "ollama", VIGIL_LLM_BASE_URL: "http://127.0.0.1:1" })).reachable).toBe(false);
  });
});
