import { accessFromEnv, accessWarnings } from "./access";
import { rebuildAll, isEmpty } from "./index-db";
import { startSemanticIndex } from "./semantic";
import { resumeDecidedRuns, startRun } from "./runs";
import { startHousekeeping } from "./housekeeping";
import { createScheduler } from "./scheduler";
import { hasRunning, hasWaitingApproval, listAgents, markInterruptedRuns } from "./state-db";
import { shutdown } from "./shutdown";
import { start } from "./server";
import { startWatcher } from "./watcher";

const port = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  // Fail fast on bad access settings (a non-local bind without a token) before touching any data.
  for (const line of accessWarnings(accessFromEnv())) console.warn(line);
  const interrupted = markInterruptedRuns();
  if (interrupted > 0) console.log(`vigil-server marked ${interrupted} unfinished run(s) as interrupted`);
  // Runs paused for approval stay paused; one whose writes were all decided just before a crash continues.
  const resumed = resumeDecidedRuns();
  if (resumed > 0) console.log(`vigil-server resumed ${resumed} run(s) whose approvals were already decided`);
  if (isEmpty()) {
    const count = await rebuildAll();
    console.log(`vigil-server indexed ${count} note(s) from the vault`);
  }
  startSemanticIndex();
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
    waitingApproval: hasWaitingApproval,
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

main().catch((err: unknown) => {
  // One readable line instead of a stack trace: the usual cause is a missing VIGIL_TOKEN on a non-local bind.
  console.error(`vigil-server could not start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
