import { rebuildAll, isEmpty } from "./index-db";
import { start } from "./server";
import { startWatcher } from "./watcher";

const port = Number(process.env.PORT ?? 3001);

async function main(): Promise<void> {
  if (isEmpty()) {
    const count = await rebuildAll();
    console.log(`vigil-server indexed ${count} note(s) from the vault`);
  }
  const { server } = start({ port });
  server.on("listening", () => {
    const address = server.address();
    const actual = typeof address === "object" && address ? address.port : port;
    console.log(`vigil-server listening on http://localhost:${actual}`);
  });
  startWatcher();
}

void main();
