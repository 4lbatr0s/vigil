import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { WriteTagsSchema } from "@vigil/shared";
import { AppError } from "./errors";
import { deleteMcpClientRow, insertMcpClient, listMcpClientRows, mcpClientByHash, type McpClientRow } from "./state-db";

/** Named tokens for MCP clients (ADR-0033). The token is shown once; only its SHA-256 hash is stored. */
export type McpClient = McpClientRow;

const hashOf = (token: string): string => createHash("sha256").update(token).digest("hex");

/** The bearer token of a request, or an empty string. */
export function bearerOf(req: IncomingMessage): string {
  const auth = req.headers.authorization ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : "";
}

export function createMcpClient(rawName: string, rawTags: unknown = []): McpClient & { token: string } {
  const name = rawName.trim();
  if (name === "" || name.length > 60) throw new AppError("invalid-body", "The client name must be 1 to 60 characters", 400);
  const tags = WriteTagsSchema.safeParse(rawTags);
  if (!tags.success) throw new AppError("invalid-body", tags.error.issues[0]?.message ?? "Bad write tags", 400);
  const writeTags = [...new Set(tags.data)];
  const token = `vgl_${randomBytes(32).toString("base64url")}`;
  try {
    return { ...insertMcpClient({ id: randomUUID(), name, tokenHash: hashOf(token), writeTags }), token };
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw new AppError("mcp-client-exists", `A client named "${name}" already exists`, 409);
    throw err;
  }
}

export const listMcpClients = (): McpClient[] => listMcpClientRows();

export function revokeMcpClient(id: string): boolean {
  return deleteMcpClientRow(id);
}

/** The client a token belongs to, or null. A hash lookup: the token has 256 bits of randomness, so no timing attack applies. */
export function clientForToken(token: string): McpClient | null {
  return token === "" ? null : mcpClientByHash(hashOf(token));
}
