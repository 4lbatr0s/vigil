export function healthPayload() {
  return { ok: true, app: "vigil-server" } as const;
}
