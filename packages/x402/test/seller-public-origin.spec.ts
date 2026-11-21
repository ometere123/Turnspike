// Verifier fix: the example seller rejects a malformed PUBLIC_ORIGIN instead of advertising an invalid resource.url.
import { describe, it, expect } from "vitest";
import { normalizePublicOrigin } from "../../../examples/x402-seller/src/origin.js";

describe("example seller PUBLIC_ORIGIN validation", () => {
  it("accepts an origin and strips trailing slashes", () => {
    expect(normalizePublicOrigin("https://api.example.com/")).toBe("https://api.example.com");
    expect(normalizePublicOrigin("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
  it("treats unset or empty as unset", () => {
    expect(normalizePublicOrigin(undefined)).toBeUndefined();
    expect(normalizePublicOrigin("  ")).toBeUndefined();
  });
  it("rejects values without a scheme, other schemes, paths, queries and credentials", () => {
    for (const v of ["api.example.com", "ftp://api.example.com", "https://api.example.com/v1", "https://api.example.com?x=1", "https://u:p@api.example.com"])
      expect(() => normalizePublicOrigin(v)).toThrow();
  });
});
