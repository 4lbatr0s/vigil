import { createServer, type Server } from "node:http";
import { accessFromEnv, type Access } from "./access";
import { createHandler } from "./http";

export type RunningServer = {
  server: Server;
  close(): Promise<void>;
};

export function start(options: { port?: number; access?: Partial<Access> } = {}): RunningServer {
  const port = options.port ?? 3001;
  const access = accessFromEnv(options.access);
  const server = createServer(createHandler(access));
  server.listen(port, access.host);
  return {
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
