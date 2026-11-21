// O4 independent review fixes: (1) an unset NODE_ENV is production (no accidental dev fallback on a server); (2) the
// resolver header guard cannot be bypassed via getOwnPropertyDescriptor or req.res/req.socket; (3) the resolver query
// comparison splits at the first "?" only.
import { describe, it, expect, afterEach } from "vitest";
import { createResourceUrlPolicy, defaultProduction, headerlessView, resetDevWarning, ResourceUrlConfigError } from "@turnspike-qie/middleware/origin";

const fakeReq = (o: Record<string, unknown> = {}) => {
  const r: any = { originalUrl: "/v1/report?a=1", headers: { host: "evil.example", accept: "x" }, get: (n: string) => (n.toLowerCase() === "host" ? "evil.example" : undefined), ...o };
  r.res = { req: r }; r.socket = { parser: { incoming: r } }; r.connection = r.socket;
  return r;
};

describe("O4 review: production default", () => {
  const saved = process.env.NODE_ENV;
  afterEach(() => { if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved; resetDevWarning(); });

  it("only development and test are non-production; unset, empty and anything else are production", () => {
    delete process.env.NODE_ENV;
    expect(defaultProduction()).toBe(true); // unset
    expect(defaultProduction("")).toBe(true);
    expect(defaultProduction("production")).toBe(true);
    expect(defaultProduction("staging")).toBe(true);
    expect(defaultProduction("prod")).toBe(true);
    expect(defaultProduction("development")).toBe(false);
    expect(defaultProduction(" Test ")).toBe(false);
  });

  it("with NODE_ENV unset, x402 without a public origin refuses to start (no silent dev fallback)", () => {
    delete process.env.NODE_ENV;
    expect(() => createResourceUrlPolicy({}, () => {})).toThrow(ResourceUrlConfigError);
    expect(createResourceUrlPolicy({ publicOrigin: "https://api.example.com" }).mode).toBe("origin");
    expect(createResourceUrlPolicy({ production: false }, () => {}).mode).toBe("dev"); // explicit opt-in only
  });
});

describe("O4 review: resolver header guard", () => {
  it("getOwnPropertyDescriptor on the headers does not reveal Host", () => {
    const v = headerlessView(fakeReq());
    expect(Object.getOwnPropertyDescriptor(v.headers, "host")).toBeUndefined();
    expect(Object.getOwnPropertyDescriptors(v.headers)).not.toHaveProperty("host");
    expect(Object.getOwnPropertyDescriptor(v.headers, "accept")?.value).toBe("x");
  });

  for (const [name, read] of [
    ["req.res.req.headers.host", (r: any) => r.res.req.headers.host],
    ["req.socket.parser.incoming.headers.host", (r: any) => r.socket.parser.incoming.headers.host],
    ["req.connection", (r: any) => r.connection.parser.incoming.headers.host],
    ["getOwnPropertyDescriptor(headers, host)", (r: any) => Object.getOwnPropertyDescriptor(r.headers, "host")!.value],
  ] as const) {
    it(`a resolver reading ${name} fails closed`, () => {
      const p = createResourceUrlPolicy({ resourceUrl: (req) => `https://${read(req)}${req.originalUrl}`, production: true });
      expect(p.canonical(fakeReq())).toEqual({ ok: false, status: 500, reason: "resource_url_resolver_failed" });
    });
  }
});

describe("O4 review: resolver query comparison", () => {
  it("a query containing '?' must match exactly, not only up to the second '?'", () => {
    const req = fakeReq({ originalUrl: "/v1/report?a=1?b=2" });
    const good = createResourceUrlPolicy({ resourceUrl: (r) => `https://api.example.com${r.originalUrl}`, production: true });
    expect(good.canonical(req)).toMatchObject({ ok: true, url: "https://api.example.com/v1/report?a=1?b=2" });
    const bad = createResourceUrlPolicy({ resourceUrl: () => "https://api.example.com/v1/report?a=1?b=3", production: true });
    expect(bad.canonical(req)).toEqual({ ok: false, status: 500, reason: "resource_url_resolver_failed" });
  });
});

describe("O4 review: origin edge cases", () => {
  it("rejects port 0 and look-alike or unsafe hosts; normalises case and default ports", () => {
    expect(() => createResourceUrlPolicy({ publicOrigin: "https://api.example.com:0", production: true })).toThrow(ResourceUrlConfigError);
    expect(createResourceUrlPolicy({ publicOrigin: "https://API.Example.com:443", production: true }).origin).toBe("https://api.example.com");
    for (const bad of ["http://localhost.evil.com", "http://0.0.0.0", "http://localhost.", "https://a.com./", "http://localhost@evil.com"]) {
      expect(() => createResourceUrlPolicy({ publicOrigin: bad, production: true }), bad).toThrow(ResourceUrlConfigError);
    }
  });
});
