import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { describe, expect, it } from "vitest";
import { reasoningChatOpenAI, reasoningOf, withReasoning } from "./llm-reasoning";

const reply = { id: "c1", object: "chat.completion", created: 1, model: "m", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done", reasoning_content: "thought 2" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };

/** Returns the request bodies a model sent to a fake endpoint. */
function fakeEndpoint(): { bodies: { messages: { role: string; reasoning_content?: string }[] }[]; fetch: typeof fetch } {
  const bodies: { messages: { role: string; reasoning_content?: string }[] }[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { bodies, fetch: fakeFetch };
}

const conversation = () => [
  new SystemMessage("sys"),
  new HumanMessage("hi"),
  new AIMessage({ content: "", tool_calls: [{ id: "t1", name: "list_notes", args: {} }], additional_kwargs: { reasoning_content: "thought 1" } }),
  new ToolMessage({ content: "ok", tool_call_id: "t1" }),
];

describe("reasoning_content round trip", () => {
  it("plain ChatOpenAI drops it (the bug)", async () => {
    const ep = fakeEndpoint();
    const model = new ChatOpenAI({ model: "m", apiKey: "k", useResponsesApi: false, configuration: { baseURL: "http://x.invalid/v1", fetch: ep.fetch } });
    await model.invoke(conversation());
    expect(ep.bodies[0]?.messages[2]?.reasoning_content).toBeUndefined();
  });

  it("reasoningChatOpenAI sends it back on the matching assistant message", async () => {
    const ep = fakeEndpoint();
    const model = reasoningChatOpenAI({ model: "m", apiKey: "k", useResponsesApi: false, configuration: { baseURL: "http://x.invalid/v1", fetch: ep.fetch } });
    const out = await model.invoke(conversation());
    expect(ep.bodies[0]?.messages[2]?.reasoning_content).toBe("thought 1");
    expect(out.additional_kwargs.reasoning_content).toBe("thought 2");
  });

  it("adds nothing when the provider sent no reasoning", async () => {
    const ep = fakeEndpoint();
    const model = reasoningChatOpenAI({ model: "m", apiKey: "k", useResponsesApi: false, configuration: { baseURL: "http://x.invalid/v1", fetch: ep.fetch } });
    await model.invoke([new HumanMessage("hi"), new AIMessage("hello"), new HumanMessage("more")]);
    expect(ep.bodies[0]?.messages.some((m) => "reasoning_content" in m)).toBe(false);
  });

  it("helpers map the n-th assistant message", () => {
    expect(reasoningOf(conversation())).toEqual(["thought 1"]);
    expect(withReasoning([{ role: "user" }, { role: "assistant" }, { role: "assistant" }], ["a", undefined])).toEqual([{ role: "user" }, { role: "assistant", reasoning_content: "a" }, { role: "assistant" }]);
  });
});
