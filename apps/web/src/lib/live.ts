import { writable, type Readable } from "svelte/store";
import { createLive, type LiveEvent, type LiveMode } from "./events";
import { readNdjson } from "./ndjson";
import { visiblePoll } from "./poll";

const modeStore = writable<LiveMode>("connecting");
const eventStore = writable<LiveEvent | null>(null);

/** "stream" while the live connection works, "polling" when it could not connect three times in a row. */
export const liveMode: Readable<LiveMode> = { subscribe: modeStore.subscribe };
/** The latest event; subscribers filter by type. */
export const liveEvents: Readable<LiveEvent | null> = { subscribe: eventStore.subscribe };

let started = false;

/** Called once by the shell. */
export function startLive(): () => void {
  if (started) return () => undefined;
  started = true;
  const live = createLive({
    connect: async (signal) => {
      const res = await fetch("/api/events", { signal });
      if (!res.ok || !res.body) throw new Error(`events stream refused (${res.status})`);
      return readNdjson<LiveEvent>(res.body);
    },
    onEvent: (e) => eventStore.set(e),
    onMode: (m) => modeStore.set(m),
    isVisible: () => document.visibilityState === "visible",
    onVisibility: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  });
  live.start();
  return () => {
    live.stop();
    started = false;
  };
}

/**
 * Runs `refresh` now, again whenever a live event of one of `types` arrives (coalesced), and, only
 * while the stream is not working, on a timer like before. Returns a stop function.
 */
export function refreshOnLive(refresh: () => void | Promise<void>, types: LiveEvent["type"][], pollMs: number): () => void {
  let stopPoll: (() => void) | null = null;
  let pending: ReturnType<typeof setTimeout> | null = null;
  let mode = "connecting" as LiveMode; // set inside the store callback below
  const unsubMode = modeStore.subscribe((m) => {
    mode = m;
    if (m === "polling" && stopPoll === null) stopPoll = visiblePoll(refresh, pollMs);
    if (m !== "polling" && stopPoll !== null) {
      stopPoll();
      stopPoll = null;
    }
  });
  let first = true;
  const unsubEvents = eventStore.subscribe((e) => {
    if (first) {
      first = false; // the store replays its last value on subscribe; that is not news
      return;
    }
    if (!e || !types.includes(e.type)) return;
    if (pending !== null) return;
    pending = setTimeout(() => {
      pending = null;
      void refresh();
    }, 150);
  });
  // Initial load. In "connecting"/"stream" mode nothing else polls, so do it once ourselves.
  if (mode !== "polling") void refresh();
  return () => {
    unsubMode();
    unsubEvents();
    stopPoll?.();
    if (pending !== null) clearTimeout(pending);
  };
}

