import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";
import { statePath } from "./state-db";

/** LangGraph checkpoints live in their own file next to state.db (ADR-0011). Thread id = run id. */
export function checkpointsPath(): string {
  return path.join(path.dirname(statePath()), "checkpoints.db");
}

let current: { key: string; db: Database.Database; saver: SqliteSaver } | null = null;

export function getCheckpointer(): SqliteSaver {
  const key = checkpointsPath();
  if (current && current.key === key) return current.saver;
  closeCheckpoints();
  mkdirSync(path.dirname(key), { recursive: true });
  const db = new Database(key);
  db.pragma("journal_mode = WAL");
  const saver = new SqliteSaver(db);
  current = { key, db, saver };
  return saver;
}

export function closeCheckpoints(): void {
  if (current) {
    current.db.close();
    current = null;
  }
}
