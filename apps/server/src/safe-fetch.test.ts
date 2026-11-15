import { describe, expect, it } from "vitest";
import { SafeFetchError, checkUrl, htmlToText, isPublicAddress, safeFetch, type FetchPolicy, type RawResponse, type RequestInput, type Requester, type Resolver } from "./safe-fetch";

const policy = (over: Partial<FetchPolicy> = {}): FetchPolicy => ({ allowedHosts: ["example.com"], maxBytes: 1_000_000, timeoutMs: 2000, maxRedirects: 3, ...over });

const page = (body: string, type = "text/html; charset=utf-8", status = 200): RawResponse => {
  const bytes = new TextEncoder().encode(body);
  return {
    status,
    headers: { "content-type": type },
    close: () => undefined,
    read: async (max) => ({ bytes: bytes.subarray(0, max), truncated: bytes.length > max }),
  };
};
const redirect = (to: string, status = 302): RawResponse => ({ status, headers: { location: to }, close: () => undefined, read: async () => ({ bytes: new Uint8Array(), truncated: false }) });

const publicIp: Resolver = async () => [{ address: "93.184.216.34", family: 4 }];

/** A requester that records what it was asked and answers from a table keyed by URL. */
function requester(table: Record<string, RawResponse>): { request: Requester; calls: RequestInput[] } {
  const calls: RequestInput[] = [];
  return {
    calls,
    request: async (input) => {
      calls.push(input);
      const hit = table[input.url.toString()];
      if (!hit) throw new Error(`no stub for ${input.url.toString()}`);
      return hit;
    },
  };
}

const refused = async (p: Promise<unknown>): Promise<string> => {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(SafeFetchError);
  return (err as SafeFetchError).message;
};

describe("isPublicAddress", () => {
  it("refuses every blocked range with a representative address", () => {
    for (const a of [
      "0.0.0.1", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1",
      "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
      "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:8.8.8.8",
      "64:ff9b::7f00:1", "2002:7f00:1::1",
    ]) expect(isPublicAddress(a), a).toBe(false);
  });
  it("accepts ordinary public addresses and refuses non-addresses", () => {
    for (const a of ["93.184.216.34", "8.8.8.8", "1.1.1.1", "2606:2800:220:1:248:1893:25c8:1946", "2001:4860:4860::8888", "172.32.0.1", "100.63.255.255"]) expect(isPublicAddress(a), a).toBe(true);
    for (const a of ["", "example.com", "999.1.1.1", "127.1", "0x7f.0.0.1"]) expect(isPublicAddress(a), a).toBe(false);
  });
});

describe("checkUrl: scheme, user info, port, allowlist", () => {
  const ok = ["example.com"];
  it("allows an exact host on http or https, default or 80/443 ports", () => {
    for (const u of ["https://example.com/", "http://example.com/x?y=1", "https://example.com:443/", "http://example.com:80/", "https://EXAMPLE.com/"]) expect(checkUrl(new URL(u), ok)).toBe("example.com");
  });
  it("refuses other schemes", () => {
    for (const u of ["ftp://example.com/", "file:///etc/passwd", "javascript:alert(1)", "data:text/html,hi", "gopher://example.com/"]) expect(() => checkUrl(new URL(u), ok), u).toThrow(SafeFetchError);
  });
  it("refuses user info and other ports", () => {
    expect(() => checkUrl(new URL("https://user:pw@example.com/"), ok)).toThrow(/user name or password/);
    expect(() => checkUrl(new URL("https://user@example.com/"), ok)).toThrow(/user name or password/);
    expect(() => checkUrl(new URL("https://example.com:8443/"), ok)).toThrow(/port 8443/);
    expect(() => checkUrl(new URL("http://example.com:3001/"), ok)).toThrow(/port 3001/);
  });
  it("an empty list refuses everything; subdomains, parents and look-alikes are not the same host", () => {
    expect(() => checkUrl(new URL("https://example.com/"), [])).toThrow("this agent may not fetch any host");
    for (const u of ["https://www.example.com/", "https://sub.example.com/", "https://example.com.evil.io/", "https://notexample.com/", "https://example.org/", "https://example.com./"]) expect(() => checkUrl(new URL(u), ok), u).toThrow(/not on this agent's allowed host list/);
  });
  it("lists are compared lower-cased and trimmed, with no wildcards", () => {
    expect(checkUrl(new URL("https://example.com/"), [" Example.COM "])).toBe("example.com");
    expect(() => checkUrl(new URL("https://a.example.com/"), ["*.example.com"])).toThrow();
    expect(() => checkUrl(new URL("https://a.example.com/"), ["example.com", "*"])).toThrow();
  });
  it("an IP literal needs to be allowlisted and public", () => {
    expect(() => checkUrl(new URL("http://127.0.0.1:80/"), ["example.com"])).toThrow(/not on this agent's/);
    expect(() => checkUrl(new URL("http://127.0.0.1/"), ["127.0.0.1"])).toThrow(/not a public address/);
    expect(() => checkUrl(new URL("http://[::1]/"), ["::1"])).toThrow(/not a public address/);
    expect(() => checkUrl(new URL("http://169.254.169.254/latest/meta-data/"), ["169.254.169.254"])).toThrow(/not a public address/);
    expect(() => checkUrl(new URL("http://[::ffff:10.0.0.1]/"), ["::ffff:a00:1"])).toThrow(/not a public address/);
    expect(checkUrl(new URL("http://93.184.216.34/"), ["93.184.216.34"])).toBe("93.184.216.34");
  });
  it("odd spellings of loopback are parsed to the real address and refused", () => {
    for (const u of ["http://2130706433/", "http://0x7f000001/", "http://127.1/", "http://0177.0.0.1/"]) {
      const host = new URL(u).hostname;
      expect(() => checkUrl(new URL(u), [host]), u).toThrow(/not a public address/);
    }
  });
});

describe("safeFetch", () => {
  const url = "https://example.com/a";

  it("fetches an allowed page and strips HTML", async () => {
    const r = requester({ [url]: page("<html><body><h1>Hi</h1><script>evil()</script><p>Text &amp; more</p></body></html>") });
    const out = await safeFetch(url, policy(), { resolve: publicIp, request: r.request });
    expect(out).toMatchObject({ status: 200, contentType: "text/html", finalUrl: url, truncated: false });
    expect(htmlToText(out.text)).toBe("Hi\nText & more");
  });

  it("sends only the fixed headers: no cookies, no model-chosen headers, identity encoding", async () => {
    const r = requester({ [url]: page("ok", "text/plain") });
    await safeFetch(url, policy(), { resolve: publicIp, request: r.request });
    const headers = r.calls[0]!.headers;
    expect(Object.keys(headers).sort()).toEqual(["accept", "accept-encoding", "connection", "user-agent"]);
    expect(headers["user-agent"]).toMatch(/^Vigil\/\d+\.\d+\.\d+ \(\+self-hosted\)$/);
    expect(headers["cookie"]).toBeUndefined();
  });

  it("refuses when any resolved address is private (one public, one private)", async () => {
    const mixed: Resolver = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    const r = requester({ [url]: page("never", "text/plain") });
    expect(await refused(safeFetch(url, policy(), { resolve: mixed, request: r.request }))).toMatch(/non-public address/);
    expect(r.calls).toHaveLength(0);
  });

  it("refuses names that resolve to loopback, metadata, link-local or IPv4-mapped addresses", async () => {
    for (const bad of ["127.0.0.1", "169.254.169.254", "::1", "fe80::1", "::ffff:10.0.0.1"]) {
      const resolve: Resolver = async () => [{ address: bad, family: bad.includes(":") ? 6 : 4 }];
      const r = requester({ [url]: page("never", "text/plain") });
      expect(await refused(safeFetch(url, policy(), { resolve, request: r.request })), bad).toMatch(/non-public/);
      expect(r.calls).toHaveLength(0);
    }
  });

  it("pins the checked address: a resolver that changes its answer is asked once and the connection uses the first answer", async () => {
    let calls = 0;
    const rebinding: Resolver = async () => {
      calls += 1;
      return calls === 1 ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    };
    const r = requester({ [url]: page("fine", "text/plain") });
    await safeFetch(url, policy(), { resolve: rebinding, request: r.request });
    expect(calls).toBe(1);
    expect(r.calls[0]).toMatchObject({ address: "93.184.216.34", family: 4 });
  });

  it("a failed lookup is a refusal, not a crash", async () => {
    const boom: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    expect(await refused(safeFetch(url, policy(), { resolve: boom, request: requester({}).request }))).toBe("could not look up example.com");
  });

  it("redirect to an allowed host works and re-checks the new hop; the final url is reported", async () => {
    const r = requester({
      "https://example.com/a": redirect("/b"),
      "https://example.com/b": redirect("https://docs.example.com/c"),
      "https://docs.example.com/c": page("landed", "text/plain"),
    });
    const out = await safeFetch(url, policy({ allowedHosts: ["example.com", "docs.example.com"] }), { resolve: publicIp, request: r.request });
    expect(out.text).toBe("landed");
    expect(out.finalUrl).toBe("https://docs.example.com/c");
    expect(r.calls.map((c) => c.url.toString())).toEqual(["https://example.com/a", "https://example.com/b", "https://docs.example.com/c"]);
  });

  it("redirect to a host that is not allowed is refused, naming the host", async () => {
    const r = requester({ [url]: redirect("https://evil.example.net/steal?d=1") });
    const msg = await refused(safeFetch(url, policy(), { resolve: publicIp, request: r.request }));
    expect(msg).toMatch(/redirect to evil\.example\.net refused/);
    expect(r.calls).toHaveLength(1);
  });

  it("redirects to loopback, other schemes, other ports and user info are refused", async () => {
    for (const to of ["http://127.0.0.1/admin", "ftp://example.com/x", "https://example.com:8443/x", "https://u:p@example.com/x", "http://localhost/"]) {
      const r = requester({ [url]: redirect(to) });
      // localhost resolves to loopback, like the real resolver says; everything else is public.
      const resolve: Resolver = async (h) => [{ address: h === "localhost" ? "127.0.0.1" : "93.184.216.34", family: 4 }];
      await refused(safeFetch(url, policy({ allowedHosts: ["example.com", "127.0.0.1", "localhost"] }), { resolve, request: r.request }));
      expect(r.calls).toHaveLength(1);
    }
  });

  it("a redirect to a host that resolves privately is refused at that hop", async () => {
    const resolve: Resolver = async (h) => (h === "internal.example.com" ? [{ address: "192.168.1.10", family: 4 }] : [{ address: "93.184.216.34", family: 4 }]);
    const r = requester({ [url]: redirect("https://internal.example.com/"), "https://internal.example.com/": page("secret", "text/plain") });
    expect(await refused(safeFetch(url, policy({ allowedHosts: ["example.com", "internal.example.com"] }), { resolve, request: r.request }))).toMatch(/non-public/);
    expect(r.calls).toHaveLength(1);
  });

  it("allows up to 3 redirects and refuses a fourth", async () => {
    const chain = (n: number) => `https://example.com/r${n}`;
    const ok = requester({ [url]: redirect(chain(1)), [chain(1)]: redirect(chain(2)), [chain(2)]: redirect(chain(3)), [chain(3)]: page("done", "text/plain") });
    expect((await safeFetch(url, policy(), { resolve: publicIp, request: ok.request })).text).toBe("done");
    const loop = requester({ [url]: redirect(chain(1)), [chain(1)]: redirect(chain(2)), [chain(2)]: redirect(chain(3)), [chain(3)]: redirect(chain(4)), [chain(4)]: page("never", "text/plain") });
    expect(await refused(safeFetch(url, policy(), { resolve: publicIp, request: loop.request }))).toMatch(/too many redirects/);
  });

  it("truncates an oversize body and says so", async () => {
    const big = "x".repeat(5000);
    const r = requester({ [url]: page(big, "text/plain") });
    const out = await safeFetch(url, policy({ maxBytes: 1000 }), { resolve: publicIp, request: r.request });
    expect(out.text).toHaveLength(1000);
    expect(out.truncated).toBe(true);
  });

  it("times out a slow response (the whole fetch, not per hop)", async () => {
    const slow: Requester = ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const started = Date.now();
    expect(await refused(safeFetch(url, policy({ timeoutMs: 80 }), { resolve: publicIp, request: slow }))).toMatch(/timed out/);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("times out a hanging DNS lookup", async () => {
    const hang: Resolver = () => new Promise(() => undefined);
    expect(await refused(safeFetch(url, policy({ timeoutMs: 80 }), { resolve: hang, request: requester({}).request }))).toMatch(/timed out/);
  });

  it("times out a body that never finishes", async () => {
    const stalled: Requester = async () => ({ status: 200, headers: { "content-type": "text/plain" }, close: () => undefined, read: () => new Promise(() => undefined) });
    expect(await refused(safeFetch(url, policy({ timeoutMs: 80 }), { resolve: publicIp, request: stalled }))).toMatch(/timed out/);
  });

  it("refuses content types that are not text, json or xml", async () => {
    for (const type of ["application/pdf", "image/png", "application/octet-stream", "video/mp4", ""]) {
      const r = requester({ [url]: page("binary", type) });
      expect(await refused(safeFetch(url, policy(), { resolve: publicIp, request: r.request })), type).toMatch(/unsupported content type/);
    }
    for (const type of ["text/plain", "text/html; charset=utf-8", "application/json", "application/xml", "application/xhtml+xml", "TEXT/CSV"]) {
      const r = requester({ [url]: page("fine", type) });
      expect((await safeFetch(url, policy(), { resolve: publicIp, request: r.request })).text).toBe("fine");
    }
  });

  it("refuses an invalid address and an empty allowlist before any network use", async () => {
    const r = requester({});
    expect(await refused(safeFetch("not a url", policy(), { resolve: publicIp, request: r.request }))).toMatch(/valid address/);
    expect(await refused(safeFetch(url, policy({ allowedHosts: [] }), { resolve: publicIp, request: r.request }))).toBe("this agent may not fetch any host");
    expect(r.calls).toHaveLength(0);
  });

  it("an IP-literal host that is allowlisted and public is fetched without a name lookup", async () => {
    const resolve: Resolver = async () => {
      throw new Error("must not resolve");
    };
    const r = requester({ "http://93.184.216.34/": page("ip ok", "text/plain") });
    expect((await safeFetch("http://93.184.216.34/", policy({ allowedHosts: ["93.184.216.34"] }), { resolve, request: r.request })).text).toBe("ip ok");
  });
});

describe("htmlToText", () => {
  it("drops script, style, noscript, svg, comments and tags, decodes entities, collapses whitespace", () => {
    const html = `<html><head><title>T</title><style>p{color:red}</style><script>var a="<b>";</script></head>
      <body><!-- hidden --><h1>Head&nbsp;line</h1><noscript>no js</noscript><svg><text>vector</text></svg>
      <p>One   two &lt;b&gt; &quot;q&quot; &#65; &#x42; &unknown; &amp;amp;</p><ul><li>a</li><li>b</li></ul></body></html>`;
    const text = htmlToText(html);
    expect(text).not.toMatch(/color:red|var a|hidden|no js|vector/);
    expect(text).toContain("Head line");
    expect(text).toContain('One two <b> "q" A B &unknown; &amp;');
    expect(text.split("\n")).toEqual(expect.arrayContaining(["a", "b"]));
    expect(text).not.toMatch(/ {2}/);
  });
  it("handles odd input without throwing", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("plain text")).toBe("plain text");
    expect(htmlToText("<p>unclosed <b>tags")).toBe("unclosed tags");
    expect(htmlToText("&#99999999999; &#0; &#xD800;")).toBe("&#99999999999; &#0; &#xD800;");
  });
});
