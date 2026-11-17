import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { accessFromEnv } from "./access";
import { createHandler } from "./http";
import { closeDb } from "./index-db";
import { closeState } from "./state-db";

let root = "";
let server: Server;
let base = "";
const saved = { ...process.env };

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vigil-anki-"));
  process.env.VAULT_DIR = path.join(root, "vault");
  process.env.DB_PATH = path.join(root, "index.db");
  process.env.STATE_DB_PATH = path.join(root, "state.db");
  server = createServer(createHandler(accessFromEnv()));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  closeDb();
  closeState();
  process.env = { ...saved };
  await rm(root, { recursive: true, force: true });
});

const put = (id: string, body: string) => fetch(`${base}/api/notes/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: id, body }) });

describe("cards export", () => {
  it("writes Anki header lines, Basic rows and Cloze rows with braces rebuilt", async () => {
    await put("bio", "#cells\n\nWhat is the powerhouse? :: The mitochondria\n\nThe {{nucleus}} holds DNA and the {{ribosome}} makes protein.\n");
    const res = await fetch(`${base}/api/study/export`);
    expect(res.headers.get("content-type")).toContain("text/tab-separated-values");
    expect(res.headers.get("content-disposition")).toContain("vigil-cards.txt");
    const lines = (await res.text()).trimEnd().split("\n");
    expect(lines.slice(0, 4)).toEqual(["#separator:tab", "#html:true", "#notetype column:1", "#tags column:4"]);
    const basic = lines.find((l) => l.startsWith("Basic"))!.split("\t");
    expect(basic.slice(1, 3)).toEqual(["What is the powerhouse?", "The mitochondria"]);
    expect(basic[3]).toContain("vigil_bio");
    const cloze = lines.find((l) => l.startsWith("Cloze"))!.split("\t");
    expect(cloze[1]).toBe("The {{c1::nucleus}} holds DNA and the {{c1::ribosome}} makes protein.");
  });
  it("keeps tabs and line breaks out of the fields, and can be limited to one note", async () => {
    await put("a", "Q\tone :: A\tone\n");
    await put("b", "Other? :: Yes\n");
    const text = await (await fetch(`${base}/api/study/export?note=a`)).text();
    const rows = text.trimEnd().split("\n").slice(4);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.split("\t")).toHaveLength(4);
    expect(rows[0]).toContain("Q one");
  });
});
