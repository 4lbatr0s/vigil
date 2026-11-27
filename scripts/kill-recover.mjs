// Kills the bundled server with SIGKILL in the middle of a run, starts it again, and checks that the run
// continues once (ADR-0034) and that the note it appended to holds the text once.
// Usage: node scripts/kill-recover.mjs   (after `pnpm --filter @vigil/server build`)
//
// A fake OpenAI-compatible endpoint plays the model:
//   1st request: asks for append_note (the server appends, then saves a checkpoint after the tools step);
//   2nd request: never answered, so the run is still `running` when the server is killed;
//   after the restart: answers with plain text, so the continued run ends.
// This checks a real process death and the start order. It does not check a call that is cut off inside the
// tools step (apps/server/src/recover.test.ts covers that). Everything lives in a temp folder.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "vigil-kill-"));
const vault = path.join(tmp, "vault");
mkdirSync(vault);
writeFileSync(path.join(vault, "log.md"), "---\ntitle: Log\n---\nstart\n");

let requests = 0;
let afterRestart = false;
const seen = [];
const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    requests += 1;
    seen.push(raw);
    const reply = (message) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `c${requests}`, object: "chat.completion", created: 0, model: "fake", choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }));
    };
    if (requests === 1) {
      reply({ role: "assistant", content: "", tool_calls: [{ id: "ap1", type: "function", function: { name: "append_note", arguments: JSON.stringify({ title: "Log", text: "more" }) } }] });
    } else if (!afterRestart) {
      // Held open: the server is killed while it waits for this answer.
    } else {
      reply({ role: "assistant", content: "done after restart" });
    }
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const fakePort = fake.address().port;

const port = 3000 + Math.floor(Math.random() * 1000) + 100;
const base = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  VAULT_DIR: vault,
  DB_PATH: path.join(tmp, "index.db"),
  STATE_DB_PATH: path.join(tmp, "state.db"),
  CHECKPOINT_DB_PATH: path.join(tmp, "checkpoints.db"),
  SESSION_KEY_PATH: path.join(tmp, "session.key"),
  VIGIL_LLM_PROVIDER: "openai",
  VIGIL_LLM_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
  VIGIL_LLM_MODEL: "fake",
  VIGIL_LLM_API_KEY: "not-a-real-key",
  VIGIL_TOKEN: "",
};
const start = () => spawn(process.execPath, [path.join(root, "apps", "server", "dist", "server.mjs")], { env, stdio: ["ignore", "inherit", "inherit"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, check, tries = 120) {
  let last = "";
  for (let i = 0; i < tries; i++) {
    try {
      if (await check()) return;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e); // the server may not be up yet: try again, report it on timeout
    }
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${last})` : ""}`);
}
const api = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: { "content-type": "application/json", origin: base }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${JSON.stringify(json)}`);
  return json.data;
};

let child = start();
let failed = false;
try {
  await until("the server", async () => (await fetch(`${base}/api/health`)).ok);
  await api("PUT", "/api/agents/logger", { name: "logger", systemPrompt: "Append to the Log note.", tools: ["read_notes", "write_notes"], strict: false, tokenBudget: 5000 });
  const run = await api("POST", "/api/agents/logger/run", { task: "Add more to the log." });
  await until("the second model request", async () => requests >= 2);
  const before = readFileSync(path.join(vault, "log.md"), "utf8");
  if (!before.includes("more")) throw new Error("the append did not happen before the kill");

  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  afterRestart = true;
  child = start();
  await until("the server after the restart", async () => (await fetch(`${base}/api/health`)).ok);
  await until("the run to end", async () => (await api("GET", `/api/runs/${run.id}`)).run.status !== "running");

  const detail = await api("GET", `/api/runs/${run.id}`);
  const status = detail.run.status;
  const events = detail.events.map((e) => e.text);
  const body = readFileSync(path.join(vault, "log.md"), "utf8");
  const times = body.split("more").length - 1;
  const lastMessages = JSON.parse(seen.at(-1) ?? "{}").messages ?? [];
  const toolAnswers = lastMessages.filter((m) => m.role === "tool").map((m) => String(m.content));
  const checks = [
    ["the run succeeded", status === "succeeded", status],
    ["the log says it continued after a restart", events.some((t) => t.startsWith("continued after a server restart")), events.join(" | ")],
    ["the note holds the appended text once", times === 1, `${times} times`],
    ["the model saw the append's own answer after the restart", toolAnswers.length === 1 && toolAnswers[0].startsWith("updated note log"), toolAnswers.join(" | ")],
    ["three model requests in all", requests === 3, `${requests} requests`],
  ];
  for (const [name, ok, got] of checks) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${got})`}`);
    if (!ok) failed = true;
  }
} catch (e) {
  console.error(`FAIL ${e instanceof Error ? e.message : String(e)}`);
  failed = true;
} finally {
  child.kill("SIGKILL");
  fake.close();
  fake.closeAllConnections();
  rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
