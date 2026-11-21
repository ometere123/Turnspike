// O4: fail-closed canonical resource URL, configuration side (no chain needed). The middleware, x402Seller and the scheme
// server refuse to start in production without a trusted public origin, and every origin/base path is normalised by one
// function that rejects anything malformed, ambiguous or unsafe.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { turnspike, type TurnspikeConfig } from "@turnspike-qie/middleware";
import {
  createResourceUrlPolicy, normalizeOrigin, normalizeBasePath, normalizeResourceUrl, pathAndQuery, headerlessView, resetDevWarning, ResourceUrlConfigError,
} from "@turnspike-qie/middleware/origin";
import { x402Seller, TurnspikeAllowanceServer } from "../src";

const A = "0x" + "11".repeat(20);
const mkMw = (over: Partial<TurnspikeConfig> = {}) => turnspike({
  rpcUrls: ["http://127.0.0.1:1"], chainId: 31337, contract: A, token: A, merchant: A, hmacSecrets: ["s".repeat(40)],
  dbPath: join(mkdtempSync(join(tmpdir(), "o4cfg-")), "s.sqlite"), prices: { "/report": 1000 }, onEvent: () => {}, ...over,
});
const fakeReq = (o: Record<string, unknown> = {}) => ({ originalUrl: "/v1/report?a=1", headers: { host: "evil.example" }, get: (n: string) => (n.toLowerCase() === "host" ? "evil.example" : undefined), protocol: "https", ...o }) as any;

let env: string | undefined;
beforeEach(() => { env = process.env.NODE_ENV; });
afterEach(() => { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; });

describe("O4 missing production URL", () => {
  it("turnspike({ x402 }) throws at construction in production (explicit flag) without an origin", () => {
    expect(() => mkMw({ x402: { production: true } })).toThrow(ResourceUrlConfigError);
    expect(() => mkMw({ x402: { production: true } })).toThrow(/without a trusted public origin/);
  });
  it("turnspike({ x402: true }) throws at construction when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    expect(() => mkMw({ x402: true })).toThrow(ResourceUrlConfigError);
  });
  it("x402Seller throws in production when the middleware runs the dev fallback", () => {
    const mw = mkMw({ x402: { production: false } });
    try {
      expect(mw.info.resourceUrlMode).toBe("dev");
      expect(() => x402Seller(mw, { production: true })).toThrow(/trusted public origin/);
      process.env.NODE_ENV = "production";
      expect(() => x402Seller(mw)).toThrow(/trusted public origin/);
    } finally { mw.close(); }
  });
  it("the scheme server throws in production without an origin, and accepts one", () => {
    expect(() => new TurnspikeAllowanceServer({ chainId: 31337, contract: A, token: A, resource: { production: true } })).toThrow(ResourceUrlConfigError);
    const s = new TurnspikeAllowanceServer({ chainId: 31337, contract: A, token: A, resource: { production: true, publicOrigin: "https://api.example.com" } });
    expect(s.resourcePolicy.mode).toBe("origin");
  });
  it("production with a valid origin starts and reports the mode", () => {
    const mw = mkMw({ x402: { production: true, publicOrigin: "https://API.Example.com:443/" } });
    try {
      expect(mw.info.resourceUrlMode).toBe("origin");
      expect(mw.info.production).toBe(true);
      expect(mw.resourcePolicy!.origin).toBe("https://api.example.com");
      expect(() => x402Seller(mw)).not.toThrow();
    } finally { mw.close(); }
  });
  it("production with a resolver starts", () => {
    const mw = mkMw({ x402: { production: true, resourceUrl: (req) => `https://api.example.com${req.originalUrl}` } });
    try { expect(mw.info.resourceUrlMode).toBe("resolver"); } finally { mw.close(); }
  });
});

describe("O4 malformed, ambiguous and unsafe origins are refused at construction", () => {
  const bad: [string, unknown][] = [
    ["empty", ""], ["not a string", 42], ["no scheme", "api.example.com"], ["ftp", "ftp://api.example.com"], ["javascript", "javascript:alert(1)"],
    ["userinfo", "https://user:pass@api.example.com"], ["user only", "https://user@api.example.com"], ["query", "https://api.example.com?x=1"], ["empty query", "https://api.example.com?"],
    ["fragment", "https://api.example.com#f"], ["empty host", "https://"], ["empty host with path", "https:///x"], ["wildcard", "https://*.example.com"],
    ["two origins (comma)", "https://a.example.com,https://b.example.com"], ["two origins (space)", "https://a.example.com https://b.example.com"],
    ["path", "https://api.example.com/v1"], ["double trailing slash", "https://api.example.com//"], ["trailing dot", "https://api.example.com."],
    ["backslash", "https://api.example.com\\x"], ["whitespace", " https://api.example.com"],
  ];
  for (const [name, v] of bad) {
    it(`refuses ${name}`, () => {
      expect(() => normalizeOrigin(v, { production: true })).toThrow(ResourceUrlConfigError);
      expect(() => mkMw({ x402: { production: true, publicOrigin: v as string } })).toThrow(ResourceUrlConfigError);
      // malformed is refused in development too: there is no silent fallback for a bad value
      expect(() => mkMw({ x402: { production: false, publicOrigin: v as string } })).toThrow(ResourceUrlConfigError);
    });
  }
  it("refuses http outside localhost in production, allows it on localhost and in development", () => {
    expect(() => normalizeOrigin("http://api.example.com", { production: true })).toThrow(/https/);
    for (const o of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "http://app.localhost"]) expect(normalizeOrigin(o, { production: true })).toBe(o);
    expect(normalizeOrigin("http://api.example.com", { production: false })).toBe("http://api.example.com");
  });
  it("normalises scheme and host case, default ports and IDN consistently", () => {
    expect(normalizeOrigin("HTTPS://API.EXAMPLE.COM")).toBe("https://api.example.com");
    expect(normalizeOrigin("https://api.example.com:443")).toBe("https://api.example.com");
    expect(normalizeOrigin("http://localhost:80")).toBe("http://localhost");
    expect(normalizeOrigin("https://api.example.com:8443")).toBe("https://api.example.com:8443");
    expect(normalizeOrigin("https://bücher.example")).toBe("https://xn--bcher-kva.example");
    expect(normalizeOrigin("https://xn--bcher-kva.example")).toBe("https://xn--bcher-kva.example");
    // a presented resource.url in either form names the same canonical URL
    expect(normalizeResourceUrl("https://BÜCHER.example:443/r?q=1")!.url).toBe("https://xn--bcher-kva.example/r?q=1");
  });
  it("refuses ambiguous combinations: publicOrigin and resourceUrl, basePath with a resolver", () => {
    expect(() => createResourceUrlPolicy({ publicOrigin: "https://a.example", resourceUrl: "https://a.example" })).toThrow(/not both/);
    expect(() => createResourceUrlPolicy({ resourceUrl: () => "https://a.example/x", basePath: "/api" })).toThrow(/basePath/);
    expect(() => createResourceUrlPolicy({ resourceUrl: 5 as any })).toThrow(ResourceUrlConfigError);
  });
  it("base paths: normalised form only (no trailing slash, dot segments, query, wildcard)", () => {
    expect(normalizeBasePath(undefined)).toBe("");
    expect(normalizeBasePath("/")).toBe("");
    expect(normalizeBasePath("/api/v2")).toBe("/api/v2");
    for (const b of ["api", "//api", "/api/", "/api//x", "/api/../x", "/./api", "/api?x", "/api#x", "/a*", "/a b", "/a\\b", "/%zz", "/a%2Fb"]) expect(() => normalizeBasePath(b), b).toThrow(ResourceUrlConfigError);
  });
});

describe("O4 canonical request target", () => {
  it("accepts plain origin-form targets and refuses ambiguous ones", () => {
    expect(pathAndQuery("/v1/report")).toBe("/v1/report");
    expect(pathAndQuery("/v1/report?b=2&a=1")).toBe("/v1/report?b=2&a=1");
    expect(pathAndQuery("/v1/report?")).toBe("/v1/report");
    for (const t of ["//evil.example/v1/report", "http://evil.example/v1/report", "/v1/../admin", "/v1/./report", "/v1\\report", "/v1/report#x", "v1/report", "/v1/re port", "/v1/r%zz", "/v1%2F..%2Fadmin", "/v1/%2e%2e/admin"]) expect(pathAndQuery(t), t).toBeNull();
  });
  it("the canonical URL is the configured origin + base path + path and query, whatever Host says", () => {
    const p = createResourceUrlPolicy({ production: true, publicOrigin: "https://api.example.com", basePath: "/shop" });
    const c = p.canonical(fakeReq());
    expect(c).toEqual({ ok: true, url: "https://api.example.com/shop/v1/report?a=1", trusted: true, pathAndQuery: "/shop/v1/report?a=1" });
    expect(p.canonical(fakeReq({ originalUrl: "//evil.example/x" }))).toMatchObject({ ok: false, status: 400 });
  });
});

describe("O4 resolver must not read Host or X-Forwarded-*", () => {
  const forbidden: [string, (r: any) => string][] = [
    ["req.get('host')", (r) => `https://${r.get("host")}${r.originalUrl}`],
    ["req.header('x-forwarded-host')", (r) => `https://${r.header("x-forwarded-host")}${r.originalUrl}`],
    ["req.headers.host", (r) => `https://${r.headers.host}${r.originalUrl}`],
    ["req.headers['x-forwarded-proto']", (r) => `${r.headers["x-forwarded-proto"]}://a.example${r.originalUrl}`],
    ["req.headers.forwarded", (r) => `https://${r.headers.forwarded}${r.originalUrl}`],
    ["req.hostname", (r) => `https://${r.hostname}${r.originalUrl}`],
    ["req.protocol", (r) => `${r.protocol}://a.example${r.originalUrl}`],
    ["req.secure", (r) => `${r.secure ? "https" : "http"}://a.example${r.originalUrl}`],
  ];
  for (const [name, fn] of forbidden) {
    it(`a resolver reading ${name} fails closed (500), never advertises a header-derived origin`, () => {
      const p = createResourceUrlPolicy({ production: true, resourceUrl: fn });
      expect(p.canonical(fakeReq({ hostname: "evil.example", secure: true }))).toEqual({ ok: false, status: 500, reason: "resource_url_resolver_failed" });
    });
  }
  it("a resolver may read other headers and the URL", () => {
    const p = createResourceUrlPolicy({ production: true, resourceUrl: (r) => `https://${r.get("x-tenant") === "b" ? "b" : "a"}.example.com${r.originalUrl}` });
    const req = fakeReq({ get: (n: string) => (n === "x-tenant" ? "b" : "evil.example") });
    expect(p.canonical(req)).toMatchObject({ ok: true, url: "https://b.example.com/v1/report?a=1" });
    expect(Object.keys(headerlessView(fakeReq({ headers: { host: "h", "x-forwarded-host": "f", accept: "x" } })).headers)).toEqual(["accept"]);
  });
  it("a resolver result that is unsafe or names another path or query fails closed", () => {
    for (const out of ["http://api.example.com/v1/report?a=1", "https://api.example.com/v1/other?a=1", "https://api.example.com/v1/report?a=2", "https://u@api.example.com/v1/report?a=1", "https://api.example.com/v1/report?a=1#f", "/v1/report?a=1", "https://*.example.com/v1/report?a=1"]) {
      const p = createResourceUrlPolicy({ production: true, resourceUrl: () => out });
      expect(p.canonical(fakeReq()), out).toMatchObject({ ok: false, status: 500 });
    }
    const p = createResourceUrlPolicy({ production: true, resourceUrl: (r) => `https://api.example.com/shop${r.originalUrl}` });
    expect(p.canonical(fakeReq())).toMatchObject({ ok: true, url: "https://api.example.com/shop/v1/report?a=1" });
  });
});

describe("O4 development fallback", () => {
  it("warns loudly once, and never trusts the origin it advertises", () => {
    resetDevWarning();
    const warn = vi.fn();
    const p = createResourceUrlPolicy({ production: false }, warn);
    createResourceUrlPolicy({ production: false }, warn);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/WARNING.*DEVELOPMENT FALLBACK/);
    const c = p.canonical(fakeReq());
    expect(c).toMatchObject({ ok: true, trusted: false, pathAndQuery: "/v1/report?a=1" });
    // path and query only
    expect(p.matches("https://anything.example/v1/report?a=1", c as any)).toBe(true);
    expect(p.matches("https://anything.example/v1/report?a=2", c as any)).toBe(false);
    expect(p.matches("https://anything.example/v1/other?a=1", c as any)).toBe(false);
  });
});

describe("O4 turnspike/1-only deployments are unaffected", () => {
  it("x402 off: no policy, no throw in production, no warning", () => {
    process.env.NODE_ENV = "production";
    resetDevWarning();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mw = mkMw();
    try {
      expect(mw.info.x402).toBe(false);
      expect(mw.resourcePolicy).toBeNull();
      expect(mw.info.resourceUrlMode).toBeNull();
      expect(spy).not.toHaveBeenCalled();
      const mw2 = mkMw({ x402: { enabled: false, production: true } });
      expect(mw2.resourcePolicy).toBeNull();
      mw2.close();
    } finally { spy.mockRestore(); mw.close(); }
  });
});
