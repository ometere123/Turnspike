// N1: the S7 deadline check adds clockSkewSeconds when the latest block is stale (far behind local time). No chain needed:
// the provider is a stub that only answers getBlock("latest"), and the private deadline check is called directly.
import { describe, it, expect } from "vitest";
import { Wallet } from "ethers";
import { TurnspikeClient } from "@turnspike-qie/client";

const NOW_MS = 1_900_000_000_000;
const ADDR = "0x" + "11".repeat(20);

function client(blockAgeSec: number, extra: Record<string, unknown> = {}) {
  const provider = { getBlock: async () => ({ timestamp: Math.floor(NOW_MS / 1000) - blockAgeSec }) } as any;
  const signer = Wallet.createRandom().connect(provider);
  return new TurnspikeClient({
    signer, network: { chainId: 31337, contract: ADDR, token: ADDR } as any, owner: ADDR,
    policy: { payees: [{ origin: "http://x", merchant: ADDR }], maxPriceBase: 1n } as any,
    confirmations: 1, expectedBlockTimeMs: 3600, deadlineSafetySeconds: 10, nowMs: () => NOW_MS, ...extra,
  } as any);
}
// margin without skew: 3.6 + 3.6 + 10 = 17.2 s; with the default 15 s skew: 32.2 s. Stale threshold: 2 x 3.6 + 30 = 37.2 s.
const reachable = (c: TurnspikeClient, deadlineInSec: number) =>
  (c as any).deadlineReachable({ paymentDeadline: Math.floor(NOW_MS / 1000) + deadlineInSec }) as Promise<boolean>;

describe("N1 stale latest block adds clockSkewSeconds to the deadline margin", () => {
  it("fresh block (5 s old): 25 s to the deadline is enough (no skew added)", async () => {
    expect(await reachable(client(5), 25)).toBe(true);
  });
  it("block at the threshold (37 s old): no skew added", async () => {
    expect(await reachable(client(37), 25)).toBe(true);
  });
  it("stale block (120 s old): skew added, 25 s is refused, 35 s passes", async () => {
    expect(await reachable(client(120), 25)).toBe(false);
    expect(await reachable(client(120), 35)).toBe(true);
  });
  it("stale block with clockSkewSeconds 0: no extra margin", async () => {
    expect(await reachable(client(120, { clockSkewSeconds: 0 }), 25)).toBe(true);
  });
});
