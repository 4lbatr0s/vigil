import { createServer, type Server } from "node:http";
import { createHandler } from "./http";

export type RunningServer = {
  server: Server;
  close(): Promise<void>;
};

export function start(options: { port?: number } = {}): RunningServer {
  const port = options.port ?? 3001;
  const server = createServer(createHandler());
  server.listen(port);
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
