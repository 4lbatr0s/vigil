// Seeds a demo vault: 30 linked notes of different ages, two agents and two finished runs with their
// read/write touches, so the graph has something to show. Run it with:
//   VAULT_DIR=/tmp/demo/vault DB_PATH=/tmp/demo/index.db STATE_DB_PATH=/tmp/demo/state.db \
//     pnpm --filter @vigil/server exec tsx ../../scripts/seed-demo-vault.mts
// It writes ONLY under the three paths you give it, and refuses to run if any of them is unset.
import { utimes } from "node:fs/promises";
import path from "node:path";
import { AgentSchema } from "../packages/shared/src/index";
import { closeDb, rebuildAll } from "../apps/server/src/index-db";
import { closeState, createRun, finishRun, putAgent, recordTouch } from "../apps/server/src/state-db";
import { createNote, vaultDir } from "../apps/server/src/vault";

for (const name of ["VAULT_DIR", "DB_PATH", "STATE_DB_PATH"]) {
  if (!process.env[name]) {
    console.error(`Refusing to run: ${name} is not set. This script must never touch your real vault or data.`);
    process.exit(1);
  }
}

const topics = ["Launch plan", "Auth design", "Standup", "Roadmap", "Research queue", "Reading list", "Meeting notes", "Ideas", "Budget", "Hiring", "Retro", "Bugs", "Release checklist", "Onboarding", "Glossary"];
const titles = [...topics, ...topics.map((t) => `${t} archive`)];
const DAY = 86_400_000;
const now = Date.now();

for (let i = 0; i < 30; i++) {
  const title = titles[i] as string;
  const links = [titles[(i + 1) % 30], titles[(i * 7 + 3) % 30], i % 5 === 0 ? "Not written yet" : null].filter(Boolean).map((t) => `[[${t}]]`);
  const agent = i % 6 === 0;
  const note = await createNote({ title, body: `# ${title}\n\nSee ${links.join(", ")}.\n` }, agent ? { author: "agent", agentName: "digest" } : {});
  // Spread the ages: a few notes from today, the rest from up to 40 days ago.
  const age = i < 5 ? 0.05 * i : (i * 1.4) % 40;
  const when = new Date(now - age * DAY);
  await utimes(path.join(vaultDir(), `${note.id}.md`), when, when);
}

putAgent(AgentSchema.parse({ name: "digest", systemPrompt: "Write a digest.", tools: ["read_notes", "write_notes"], strict: false }));
putAgent(AgentSchema.parse({ name: "inbox", systemPrompt: "File the inbox.", tools: ["read_notes", "write_notes"], strict: false }));
const runs: Array<[string, string, string[], string[]]> = [
  ["digest", "run-demo-1", ["standup", "roadmap", "auth-design", "launch-plan"], ["launch-plan-archive"]],
  ["inbox", "run-demo-2", ["ideas", "reading-list"], ["ideas"]],
];
for (const [agent, runId, reads, writes] of runs) {
  createRun(runId, agent, 20_000, "manual");
  for (const n of reads) recordTouch(agent, n, "read", runId);
  for (const n of writes) recordTouch(agent, n, "wrote", runId);
  finishRun(runId, "succeeded", 1200, null);
}

await rebuildAll();
closeDb();
closeState();
console.log(`Seeded 30 notes, 2 agents and 2 runs into ${vaultDir()}`);
