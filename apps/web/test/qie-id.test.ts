import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupQieName } from "../src/lib/qie-id";

const ADDRESSES = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x3333333333333333333333333333333333333333",
  "0x4444444444444444444444444444444444444444",
  "0x5555555555555555555555555555555555555555",
];
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const reverse = (address: string, ...domains: string[]) => ({ status: "SUCCESS", data: { address, totalDomains: domains.length, domains: domains.map((domainName) => ({ domainName })) } });
const forward = (address: string, domainName = "qie.qie") => ({ status: "SUCCESS", data: { owner: address, domainName, domainType: "public" } });
afterEach(() => vi.unstubAllGlobals());

describe("QIE ID malformed answers", () => {
  it("a second entry that is not a valid name, a larger total, or a non-number total is never a match; non-JSON is explained", async () => {
    const a = (n: string) => "0x" + n.repeat(40);
    const cases: [string, unknown, string][] = [
      [a("6"), { status: "SUCCESS", data: { address: a("6"), totalDomains: 2, domains: [{ domainName: "a.qie" }, { domainName: "!!" }] } }, "Multiple"],
      [a("7"), { status: "SUCCESS", data: { address: a("7"), totalDomains: 2, domains: [{ domainName: "a.qie" }] } }, "Multiple"],
      [a("8"), { status: "SUCCESS", data: { address: a("8"), totalDomains: "2", domains: [{ domainName: "a.qie" }] } }, "unrecognized"],
    ];
    for (const [address, body, text] of cases) {
      vi.stubGlobal("fetch", vi.fn(async () => json(body)));
      expect(await lookupQieName(address)).toMatchObject({ ok: false, message: expect.stringContaining(text) });
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 200 })));
    expect(await lookupQieName(a("9"))).toMatchObject({ ok: false, message: expect.stringContaining("unrecognized") });
  });
});

describe("QIE ID display-only, fail-closed resolution", () => {
  it("accepts one matching forward/reverse name without replacing the address", async () => {
    const address = ADDRESSES[0];
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      calls.push(String(input));
      if (String(input).includes("/resolution/")) return json(reverse(address, "qie.qie"));
      return json(forward(address));
    }));
    const result = await lookupQieName(address);
    expect(result).toEqual({ ok: true, address, name: "qie.qie" });
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("sdk-live.qie.digital/api/v1/domains/public/resolution/");
    expect(calls[1]).toContain("/lookup/qie.qie");
    // Caches confirmed labels to avoid exhausting the public 30/min/IP limit.
    expect(await lookupQieName(address)).toEqual(result);
    expect(calls).toHaveLength(2);
  });

  it("rejects a forward owner mismatch and refuses an identity label", async () => {
    const address = ADDRESSES[1];
    vi.stubGlobal("fetch", vi.fn(async (input: string) =>
      json(String(input).includes("/resolution/") ? reverse(address, "qie.qie") : forward(ADDRESSES[0]))));
    const result = await lookupQieName(address);
    expect(result.ok).toBe(false);
  });

  it("rejects a reverse address mismatch before any forward lookup", async () => {
    const address = ADDRESSES[2];
    const fetcher = vi.fn(async () => json(reverse(ADDRESSES[0], "qie.qie")));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupQieName(address);
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not choose between multiple aliases without canonical metadata", async () => {
    const address = ADDRESSES[3];
    const fetcher = vi.fn(async () => json(reverse(address, "qie.qie", "other.qie")));
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupQieName(address);
    expect(result.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("handles public rate limiting without granting trust", async () => {
    const address = ADDRESSES[4];
    vi.stubGlobal("fetch", vi.fn(async () => json({ status: "FAIL" }, 429)));
    const result = await lookupQieName(address);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/request limit/);
  });

  it("rejects invalid addresses without network access", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await lookupQieName("../qie.qie");
    expect(result.ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
