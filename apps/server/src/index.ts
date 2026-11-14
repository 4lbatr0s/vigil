import { createServer } from "node:http";
import { healthPayload } from "./health";

const port = Number(process.env.PORT ?? 3001);

createServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(healthPayload()));
}).listen(port, () => {
  console.log(`vigil-server listening on http://localhost:${port}`);
});
