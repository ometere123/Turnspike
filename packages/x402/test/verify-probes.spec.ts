import { describe, it, expect } from "vitest";
import { PaymentRequiredV2Schema, PaymentPayloadV2Schema } from "@x402/core/schemas";
import { x402Requirement, x402PaymentRequired } from "@turnspike-qie/middleware";
import { paymentPayloadSchema, purchaseKeyOf, normaliseUrl, bodyHashOf } from "../src";

const A = "0x" + "11".repeat(20), B = "0x" + "22".repeat(20), C = "0x" + "33".repeat(20);
const req = x402Requirement(
  { chainId: 1983, contract: C, token: A, merchant: B, priceBase: "1000", resourceId: "/r", maxTimeoutSeconds: 120 },
  { requestId: "0x" + "ab".repeat(32), sig: "cd".repeat(32), expiresAt: 2_000_000_000, paymentDeadline: 2_000_000_060 },
);

describe("verify probes", () => {
  it("PAYMENT-REQUIRED conforms to core PaymentRequiredV2Schema", () => {
    const pr = x402PaymentRequired({ url: "https://s.test/r" }, [req]);
    const r = PaymentRequiredV2Schema.safeParse(pr);
    expect(r.success, JSON.stringify((r as any).error?.issues)).toBe(true);
  });
  it("PAYMENT-SIGNATURE conforms to core and to the package schema", () => {
    const p = { x402Version: 2, resource: { url: "https://s.test/r" }, accepted: req, payload: { requestId: req.extra.requestId, txHash: "0x" + "ef".repeat(32), sig: req.extra.sig } };
    const r1 = PaymentPayloadV2Schema.safeParse(p); console.log("core ok", r1.success);
    const r2 = paymentPayloadSchema.safeParse(p); console.log("pkg issues", JSON.stringify((r2 as any).error?.issues)); expect(r2.success).toBe(true);
  });
  it("resource:null (core-valid) vs package schema", () => {
    const p = { x402Version: 2, resource: null, accepted: req, payload: { requestId: req.extra.requestId, txHash: "0x" + "ef".repeat(32), sig: req.extra.sig } };
    console.log("core accepts resource:null =", PaymentPayloadV2Schema.safeParse(p).success, "; package accepts =", paymentPayloadSchema.safeParse(p).success);
  });
  it("purchase-key normalisation collisions", () => {
    const k = (u: string, b = "") => purchaseKeyOf("POST", u, b, A, B);
    console.log("repeated-param order collides:", k("https://s.test/r?a=1&a=2") === k("https://s.test/r?a=2&a=1"));
    console.log("plus vs %20 collides:", k("https://s.test/r?q=a+b") === k("https://s.test/r?q=a%20b"));
    console.log("path case collides:", k("https://s.test/R") === k("https://s.test/r"));
    console.log("json whitespace distinct:", bodyHashOf('{"a":1}') !== bodyHashOf('{ "a": 1 }'));
    console.log("Uint16Array hashable:", bodyHashOf(new Uint16Array([1])) !== null, "Blob:", bodyHashOf(new Blob(["x"])));
    console.log(normaliseUrl("HTTPS://S.test:443/r?b=2&a=1#f"));
  });
});
