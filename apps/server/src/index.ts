import { rebuildAll, isEmpty } from "./index-db";
import { startRun } from "./runs";
import { startHousekeeping } from "./housekeeping";
import { createScheduler } from "./scheduler";
import { hasRunning, listAgents, markInterruptedRuns } from "./state-db";
import { shutdown } from "./shutdown";
import { start } from "./server";
import { startWatcher } from "./watcher";

const port = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  const interrupted = markInterruptedRuns();
  if (interrupted > 0) console.log(`vigil-server marked ${interrupted} unfinished run(s) as interrupted`);
  if (isEmpty()) {
    const count = await rebuildAll();
    console.log(`vigil-server indexed ${count} note(s) from the vault`);
  }
  const running = start({ port });
  const { server } = running;
  server.on("listening", () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    console.log(`vigil-server listening on http://localhost:${actual}`);
  });
  const watcher = startWatcher();
  const catchUpHours = Number(process.env.VIGIL_CATCHUP_HOURS ?? 24);
  const scheduler = createScheduler({
    now: () => new Date(),
    listAgents,
    startRun,
    hasRunning,
    catchUpWindowMs: (Number.isFinite(catchUpHours) && catchUpHours > 0 ? catchUpHours : 24) * 3_600_000,
  });
  scheduler.start();
  const housekeeping = startHousekeeping();

  // First signal: stop cleanly (close, watcher, runs up to 10 s, databases, exit 0).
  // Second signal while that is in flight: leave now with code 1.
  let stopping = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (stopping) {
      console.log(`vigil-server received a second ${signal}, exiting now`);
      process.exit(1);
    }
    stopping = true;
    console.log(`vigil-server received ${signal}, shutting down`);
    void shutdown({ server: running, watcher, scheduler, housekeeping, timeoutMs: 10_000 }).then(() => process.exit(0));
  };
  process.on("SIGTERM", onSignal);
  process.on("SIGINT", onSignal);
}

void main();
