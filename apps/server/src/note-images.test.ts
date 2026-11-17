import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { AIMessage } from "@langchain/core/messages";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import type { ModelFactory } from "./llm";
import { MAX_PICTURES, imageSettings, pictureNames, picturesFor } from "./note-images";
import { setRunDeps, waitForRuns } from "./runs";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-pics-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  await waitForRuns();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const j = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(`${base}${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: (await res.json()) as { data?: any; error?: { code: string } } };
};
// A 1x1 PNG.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const upload = async (): Promise<string> => {
  const res = await fetch(`${base}/api/attachments`, { method: "POST", body: new Uint8Array(PNG) });
  return ((await res.json()) as { data: { name: string } }).data.name;
};

describe("pictureNames", () => {
  it("takes only our own attachment links, once each, in order", () => {
    const a = "0123456789abcdef.png";
    const b = "fedcba9876543210.jpg";
    const body = `![](attachments/${a}) text ![alt](attachments/${b}) ![](attachments/${a}) ![](attachments/../../etc/passwd) ![](https://evil.example/x.png) ![](attachments/notahash.png)`;
    expect(pictureNames(body)).toEqual([a, b]);
  });
});

describe("pictures for agents", () => {
  it("are off by default and give nothing", async () => {
    const name = await upload();
    expect(imageSettings()).toEqual({ agentsSeePictures: false });
    expect(await picturesFor(`![](attachments/${name})`)).toEqual([]);
  });

  it("are read as base64 once switched on, skipping a missing file", async () => {
    await j("PUT", "/api/images/settings", { agentsSeePictures: true });
    const name = await upload();
    const pics = await picturesFor(`![](attachments/${name}) ![](attachments/0123456789abcdef.png)`);
    expect(pics).toEqual([{ mime: "image/png", data: PNG.toString("base64") }]);
  });

  it("are capped in number", async () => {
    await j("PUT", "/api/images/settings", { agentsSeePictures: true });
    const name = await upload();
    const names = Array.from({ length: MAX_PICTURES + 3 }, (_, i) => `${i.toString(16).padStart(16, "0")}.png`);
    // Only the first MAX_PICTURES names are even tried; none of these files exist.
    expect(await picturesFor(names.map((n) => `![](attachments/${n})`).join(" "))).toEqual([]);
    expect((await picturesFor(`![](attachments/${name})`)).length).toBe(1);
  });

  it("reach the model with the card maker's task, as image content", async () => {
    await j("PUT", "/api/images/settings", { agentsSeePictures: true });
    const name = await upload();
    await j("PUT", "/api/notes/diagram", { title: "diagram", body: `The cell.\n![](attachments/${name})` });
    const agent = (await j("POST", "/api/agents/from-template/card-maker", {})).body.data;
    await j("PUT", "/api/agents/card-maker", { ...agent, enabled: true });
    const seen: unknown[] = [];
    const factory: ModelFactory = () =>
      ({
        invoke: async (messages: { content: unknown }[]) => {
          seen.push(messages.at(-1)?.content);
          return new AIMessage("What is shown? :: A cell");
        },
      }) as never;
    setRunDeps({ makeModel: factory });
    const r = await j("POST", "/api/notes/diagram/card-proposals", {});
    expect(r.status).toBe(202);
    await waitForRuns();
    expect(JSON.stringify(seen[0])).toContain("data:image/png;base64,");
  });
});
