import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { clearCapsCache, modelCaps, parseOllamaShow } from "./model-caps";
import type { ResolvedConnection } from "./connections";

describe("parseOllamaShow", () => {
  it("reads tools, vision and the context length from Ollama's answer", () => {
    expect(parseOllamaShow({ capabilities: ["completion", "tools", "vision"], model_info: { "general.architecture": "qwen3", "qwen3.context_length": 40960 } })).toEqual({ known: true, tools: true, vision: true, contextTokens: 40960 });
  });

  it("says a model cannot use tools or see pictures when its capabilities leave them out", () => {
    expect(parseOllamaShow({ capabilities: ["completion"], model_info: {} })).toEqual({ known: true, tools: false, vision: false, contextTokens: null });
  });

  it("does not guess when an older Ollama sends no capabilities list", () => {
    expect(parseOllamaShow({ model_info: { "llama.context_length": 8192 } })).toEqual({ known: false, tools: null, vision: null, contextTokens: 8192 });
    expect(parseOllamaShow("nonsense")).toEqual({ known: false, tools: null, vision: null, contextTokens: null });
  });
});

describe("modelCaps", () => {
  let server: Server | null = null;
  afterEach(async () => {
    clearCapsCache();
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = null;
  });

  async function ollama(answer: unknown, status = 200): Promise<{ conn: ResolvedConnection; hits: () => number }> {
    let hits = 0;
    server = createServer((req, res) => {
      hits += 1;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        expect(req.url).toBe("/api/show");
        expect(JSON.parse(body)).toEqual({ model: "tiny" });
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(answer));
      });
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    return { hits: () => hits, conn: { id: "x", name: "X", kind: "ollama", baseUrl: `http://127.0.0.1:${port}`, apiKey: undefined, model: "tiny" } };
  }

  it("asks Ollama once and remembers the answer for a while", async () => {
    const { conn, hits } = await ollama({ capabilities: ["completion", "tools"], model_info: { "x.context_length": 4096 } });
    expect(await modelCaps(conn, "tiny")).toEqual({ known: true, tools: true, vision: false, contextTokens: 4096 });
    await modelCaps(conn, "tiny");
    expect(hits()).toBe(1);
  });

  it("is unknown, not wrong, when Ollama does not know the model", async () => {
    const { conn } = await ollama({ error: "model not found" }, 404);
    expect(await modelCaps(conn, "tiny")).toEqual({ known: false, tools: null, vision: null, contextTokens: null });
  });

  it("is unknown for providers that do not report it", async () => {
    const conn: ResolvedConnection = { id: "o", name: "O", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "k", model: "gpt" };
    expect(await modelCaps(conn, "gpt")).toEqual({ known: false, tools: null, vision: null, contextTokens: null });
  });
});
