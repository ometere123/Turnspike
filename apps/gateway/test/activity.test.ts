import { describe, it, expect } from "vitest";
import { rankCounterparties, type PeerFlow } from "../src/activity";

describe("activity counterparty ranking", () => {
  it("ACT-1 orders amounts beyond 2^53 exactly (Number would tie or misorder them)", () => {
    const big = 2n ** 60n;
    const peers = new Map<string, PeerFlow>([
      ["0xA", { in: big, out: 0n, count: 1 }],
      ["0xB", { in: big + 1n, out: 0n, count: 1 }], // equal to 0xA as a Number
      ["0xC", { in: 5n, out: big * 3n, count: 2 }],
      ["0xD", { in: 1n, out: 0n, count: 1 }],
    ]);
    expect(Number(big) === Number(big + 1n)).toBe(true); // the precision loss the bigint comparison avoids
    const r = rankCounterparties(peers);
    expect(r.map((p) => p.address)).toEqual(["0xC", "0xB", "0xA", "0xD"]);
    expect(r[1].inBase).toBe((big + 1n).toString());
  });

  it("ACT-2 limits to the top N and breaks ties by address", () => {
    const peers = new Map<string, PeerFlow>(Array.from({ length: 15 }, (_, i) => [`0x${String(i).padStart(2, "0")}`, { in: 7n, out: 0n, count: 1 }] as [string, PeerFlow]));
    const r = rankCounterparties(peers);
    expect(r).toHaveLength(10);
    expect(r[0].address).toBe("0x00");
    expect(r[9].address).toBe("0x09");
  });
});
