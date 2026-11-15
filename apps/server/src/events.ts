import type { IncomingMessage, ServerResponse } from "node:http";
import type { Run } from "@vigil/shared";
import { AppError } from "./errors";

/**
 * What the live stream carries (WP4-T9). Ids, counts and statuses only: never a note body, a
 * prompt, a model reply or a key. A client that wants detail asks the API for it.
 */
export type VigilEvent =
  | { type: "run"; run: Run }
  | { type: "run-event"; runId: string; seq: number; kind: string }
  | { type: "note"; id: string; change: "created" | "updated" | "deleted"; author: "human" | "agent" }
  | { type: "approval"; count: number }
  | { type: "ping" };

type Listener = (event: VigilEvent) => void;
const listeners = new Set<Listener>();

/** The only way an event is produced. A failing listener never reaches the publisher. */
export function publish(event: VigilEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (err) {
      console.error("vigil-server event listener failed:", err instanceof Error ? err.message : err);
    }
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const MAX_STREAMS = 20;
export const PING_MS = 20_000;
const streams = new Set<ServerResponse>();

export function openStreamCount(): number {
  return streams.size;
}

/** Turns the response into a never-ending NDJSON stream of events. Throws 429 past the cap. */
export function attachStream(req: IncomingMessage, res: ServerResponse, pingMs = PING_MS): void {
  if (streams.size >= MAX_STREAMS) {
    throw new AppError("too-many-streams", `At most ${MAX_STREAMS} live streams at once`, 429);
  }
  res.writeHead(200, {
    "content-type": "application/x-ndjson",
    "cache-control": "no-store",
    "x-accel-buffering": "no",
  });
  streams.add(res);
  const write = (event: VigilEvent): void => {
    res.write(`${JSON.stringify(event)}\n`);
  };
  const unsubscribe = subscribe(write);
  const ping = setInterval(() => write({ type: "ping" }), pingMs);
  ping.unref();
  write({ type: "ping" }); // opens the stream for the client at once
  const cleanup = (): void => {
    clearInterval(ping);
    unsubscribe();
    streams.delete(res);
  };
  req.on("close", cleanup);
  res.on("close", cleanup);
}

/** For shutdown: end every open stream so the server can close. */
export function closeStreams(): void {
  for (const res of [...streams]) res.end();
}
