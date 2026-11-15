import { mkdirSync } from "node:fs";
import path from "node:path";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import Database from "better-sqlite3";
import { statePath } from "./state-db";

/** LangGraph checkpoints live in their own file (ADR-0011): CHECKPOINT_DB_PATH, else next to state.db. Thread id = run id. */
export function checkpointsPath(): string {
  const configured = process.env.CHECKPOINT_DB_PATH;
  return configured ? path.resolve(configured) : path.join(path.dirname(statePath()), "checkpoints.db");
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
