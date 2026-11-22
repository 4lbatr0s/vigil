import { describe, expect, it } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ANTHROPIC_CALL_OPTIONS, anthropicOptions, anthropicRunnable, buildChatModel } from "./llm";

const conn = { id: "a", name: "A", kind: "anthropic" as const, baseUrl: "https://api.anthropic.com", apiKey: "k", model: "m" };

describe("prompt caching", () => {
  it("the adapter sends cache_control when it is a call option", () => {
    const chat = new ChatAnthropic(anthropicOptions(conn, "claude-test", 1000));
    expect(chat.invocationParams({ cache_control: ANTHROPIC_CALL_OPTIONS.cache_control } as never).cache_control).toEqual({ type: "ephemeral" });
  });

  it("every Anthropic model built for a run carries it, with or without tools", () => {
    const ping = tool(async () => "pong", { name: "ping", description: "ping", schema: z.object({}) });
    for (const tools of [[], [ping]]) {
      const bound = anthropicRunnable(conn, tools, "claude-test", 1000) as unknown as { config?: { cache_control?: unknown } };
      expect(bound.config?.cache_control).toEqual({ type: "ephemeral" });
    }
  });

  it("other providers are left alone", () => {
    const ollama = { ...conn, kind: "ollama" as const, baseUrl: "http://127.0.0.1:11434" };
    const model = buildChatModel(ollama, [], "qwen", 100);
    expect(model.invoke).toBeTypeOf("function");
  });
});

describe("anthropicOptions", () => {
  it("uses the saved address only when it is not the default one", () => {
    expect(anthropicOptions({ ...conn, baseUrl: "https://api.anthropic.com" }, "x", 10).anthropicApiUrl).toBeUndefined();
    expect(anthropicOptions({ ...conn, baseUrl: "https://gateway.example" }, "x", 10).anthropicApiUrl).toBe("https://gateway.example");
  });
});
