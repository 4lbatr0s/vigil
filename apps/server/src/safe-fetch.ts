import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

/** Sent as the user-agent. Bump with releases. */
export const VIGIL_VERSION = "0.1.0";

export type FetchPolicy = { allowedHosts: string[]; maxBytes: number; timeoutMs: number; maxRedirects: number };
export type Resolved = { address: string; family: 4 | 6 };
export type Resolver = (host: string) => Promise<Resolved[]>;

/** What a requester gives back: the status line and headers now, the body when asked (so the caller can cap it). */
export type RawResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  read: (maxBytes: number) => Promise<{ bytes: Uint8Array; truncated: boolean }>;
  close: () => void;
};
export type RequestInput = { url: URL; address: string; family: 4 | 6; headers: Record<string, string>; signal: AbortSignal };
export type Requester = (input: RequestInput) => Promise<RawResponse>;
export type FetchDeps = { resolve?: Resolver; request?: Requester };

export type FetchResult = { status: number; contentType: string; text: string; finalUrl: string; truncated: boolean };

/** A refusal or failure the model can read. The message never contains more than the url and the reason. */
export class SafeFetchError extends Error {}

// ---- Address blocking ----

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
for (const [net, prefix] of [
  ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32],
  // Other ways to carry an IPv4 address inside IPv6: IPv4-compatible (::a.b.c.d), NAT64 and 6to4.
  // (IPv4-mapped ::ffff:a.b.c.d is handled in isPublicAddress: BlockList would treat every IPv4 address as mapped.)
  ["::", 96], ["64:ff9b::", 96], ["2002::", 16],
] as const) blocked.addSubnet(net, prefix, "ipv6");

/** True when the address is a public, routable unicast address. Anything unparseable is not public. */
export function isPublicAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 0) return false;
  if (kind === 6) {
    // Normalise (so ::FFFF:7F00:1 and 0:0:0:0:0:ffff:7f00:1 look alike) and refuse IPv4-mapped addresses
    // outright, public or not: no spelling of a private IPv4 address may get through.
    const normal = new URL(`http://[${address}]/`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (normal.startsWith("::ffff:")) return false;
    return !blocked.check(normal, "ipv6");
  }
  return !blocked.check(address, "ipv4");
}

// ---- URL and allowlist rules ----

function hostOf(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

/** Rules 1 to 3 for one URL. Throws SafeFetchError; returns the host. */
export function checkUrl(url: URL, allowedHosts: string[]): string {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new SafeFetchError(`only http and https addresses are allowed (${url.protocol})`);
  if (url.username !== "" || url.password !== "") throw new SafeFetchError("addresses with a user name or password are not allowed");
  if (url.port !== "" && url.port !== "80" && url.port !== "443") throw new SafeFetchError(`port ${url.port} is not allowed (only 80 and 443)`);
  const host = hostOf(url);
  if (allowedHosts.length === 0) throw new SafeFetchError("this agent may not fetch any host");
  const list = allowedHosts.map((h) => h.trim().toLowerCase());
  if (!list.includes(host)) throw new SafeFetchError(`${host} is not on this agent's allowed host list`);
  if (isIP(host) !== 0 && !isPublicAddress(host)) throw new SafeFetchError(`${host} is not a public address`);
  return host;
}

// ---- HTML to text ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", hellip: "...", copy: "(c)" };

export function htmlToText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, " ");
  text = text.replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, " ");
  text = text.replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)\s*>|<br\s*\/?>/gi, "\n");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith("#x") || name.startsWith("#X")) return safeChar(parseInt(name.slice(2), 16), whole);
    if (name.startsWith("#")) return safeChar(parseInt(name.slice(1), 10), whole);
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n")
    .trim();
}

function safeChar(code: number, fallback: string): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : fallback;
}

// ---- The real network, used unless a test passes its own ----

const defaultResolve: Resolver = async (host) => {
  const found = await dnsLookup(host, { all: true, verbatim: true });
  return found.map((f) => ({ address: f.address, family: f.family === 6 ? 6 : 4 }));
};

const defaultRequest: Requester = ({ url, address, family, headers, signal }) =>
  new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        method: "GET",
        host: hostOf(url),
        port: url.port === "" ? undefined : Number(url.port),
        path: `${url.pathname}${url.search}`,
        headers: { ...headers, host: url.host },
        agent: false, // no connection reuse, no shared cookies or state
        // Connect to the address we already checked. TLS still verifies the certificate for the host name (SNI).
        lookup: (_host, options, cb) => {
          if (options && (options as { all?: boolean }).all) (cb as unknown as (e: null, a: Resolved[]) => void)(null, [{ address, family }]);
          else (cb as (e: null, a: string, f: number) => void)(null, address, family);
        },
        signal,
      },
      (res) => {
        const out: Record<string, string | undefined> = {};
        for (const [k, v] of Object.entries(res.headers)) out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        resolve({
          status: res.statusCode ?? 0,
          headers: out,
          close: () => res.destroy(),
          read: (maxBytes) =>
            new Promise((done, fail) => {
              const chunks: Buffer[] = [];
              let size = 0;
              let truncated = false;
              res.on("data", (chunk: Buffer) => {
                if (truncated) return;
                if (size + chunk.length > maxBytes) {
                  chunks.push(chunk.subarray(0, maxBytes - size));
                  size = maxBytes;
                  truncated = true;
                  res.destroy(); // stop downloading
                  done({ bytes: Buffer.concat(chunks), truncated });
                  return;
                }
                chunks.push(chunk);
                size += chunk.length;
              });
              res.on("end", () => done({ bytes: Buffer.concat(chunks), truncated }));
              res.on("error", (err) => (truncated ? done({ bytes: Buffer.concat(chunks), truncated }) : fail(err)));
              res.on("close", () => done({ bytes: Buffer.concat(chunks), truncated }));
            }),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

let testDeps: FetchDeps = {};
/** Tests swap in a resolver and a requester (a stub server on loopback is blocked by design). Never read from the environment. */
export function setSafeFetchDeps(deps: FetchDeps): void {
  testDeps = deps;
}

const OK_TYPES = [/^text\//, /^application\/json\b/, /^application\/xml\b/, /^application\/xhtml\+xml\b/];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * GET a page the agent's owner allowed, and nothing else (ADR-0006). Every rule is checked again on
 * every redirect hop: scheme, user info, port, exact host on the allowlist, and that every address the
 * name resolves to is public. The connection then goes to the address that was checked, so DNS cannot
 * change its answer in between. Size, time, content type and redirect count are capped.
 */
export async function safeFetch(rawUrl: string, policy: FetchPolicy, deps: FetchDeps = {}): Promise<FetchResult> {
  const resolve = deps.resolve ?? testDeps.resolve ?? defaultResolve;
  const request = deps.request ?? testDeps.request ?? defaultRequest;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), policy.timeoutMs);
  try {
    let current: URL;
    try {
      current = new URL(rawUrl);
    } catch {
      throw new SafeFetchError("that is not a valid address");
    }
    for (let hop = 0; ; hop++) {
      const host = checkUrl(current, policy.allowedHosts);
      // Resolve once, validate every answer, then connect to the first one: no second lookup to rebind.
      let addresses: Resolved[];
      if (isIP(host) !== 0) addresses = [{ address: host, family: isIP(host) === 6 ? 6 : 4 }];
      else {
        try {
          addresses = await withAbort(resolve(host), abort.signal);
        } catch (err) {
          if (abort.signal.aborted) throw err;
          throw new SafeFetchError(`could not look up ${host}`);
        }
      }
      if (addresses.length === 0) throw new SafeFetchError(`could not look up ${host}`);
      for (const a of addresses) {
        if (!isPublicAddress(a.address)) throw new SafeFetchError(`${host} resolves to a non-public address, which is not allowed`);
      }
      const pinned = addresses[0] as Resolved;

      const res = await withAbort(
        request({
          url: current,
          address: pinned.address,
          family: pinned.family,
          headers: { "user-agent": `Vigil/${VIGIL_VERSION} (+self-hosted)`, accept: "text/html,text/plain,application/json;q=0.9", "accept-encoding": "identity", connection: "close" },
          signal: abort.signal,
        }),
        abort.signal,
      );

      if (REDIRECTS.has(res.status) && res.headers["location"]) {
        res.close();
        if (hop >= policy.maxRedirects) throw new SafeFetchError(`too many redirects (more than ${policy.maxRedirects})`);
        let next: URL;
        try {
          next = new URL(res.headers["location"] as string, current);
        } catch {
          throw new SafeFetchError("the site sent a redirect to an invalid address");
        }
        try {
          checkUrl(next, policy.allowedHosts);
        } catch (err) {
          const why = err instanceof SafeFetchError ? err.message : "not allowed";
          throw new SafeFetchError(`redirect to ${hostOf(next)} refused: ${why}`);
        }
        current = next;
        continue;
      }

      const contentType = (res.headers["content-type"] ?? "").toLowerCase();
      if (!OK_TYPES.some((re) => re.test(contentType))) {
        res.close();
        throw new SafeFetchError(`unsupported content type${contentType ? ` (${contentType.split(";")[0]})` : ""}`);
      }
      const body = await withAbort(res.read(policy.maxBytes), abort.signal);
      return {
        status: res.status,
        contentType: contentType.split(";")[0] ?? "",
        text: new TextDecoder("utf-8").decode(body.bytes),
        finalUrl: current.toString(),
        truncated: body.truncated,
      };
    }
  } catch (err) {
    if (abort.signal.aborted) throw new SafeFetchError(`the request timed out after ${Math.round(policy.timeoutMs / 1000)} s`);
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError(`the request failed (${err instanceof Error ? err.message : "unknown error"})`);
  } finally {
    clearTimeout(timer);
  }
}

/** Rejects as soon as `signal` aborts, whatever the wrapped promise is doing. */
function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const onAbort = (): void => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}
