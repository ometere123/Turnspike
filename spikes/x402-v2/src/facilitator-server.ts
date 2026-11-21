import express from "express";
import type { Server } from "node:http";
import type { SchemeNetworkFacilitator } from "@x402/core/types";
import { caip2 } from "./common";

export interface Faults {
  /** Commit the settlement, then kill the connection before the response is sent (facilitator crash after commit). */
  dropNextSettleResponse?: boolean;
  settleCalls: number;
}

/** Minimal x402 v2 facilitator HTTP API (spec section 7): GET /supported, POST /verify, POST /settle. */
export async function startFacilitator(f: SchemeNetworkFacilitator, chainId: number): Promise<{ url: string; faults: Faults; close(): void }> {
  const faults: Faults = { settleCalls: 0 };
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.get("/supported", (_q, r) => {
    r.json({ kinds: [{ x402Version: 2, scheme: f.scheme, network: caip2(chainId), extra: f.getExtra(caip2(chainId)) }], extensions: [], signers: { "eip155:*": f.getSigners(caip2(chainId)) } });
  });
  app.post("/verify", async (q, r) => r.json(await f.verify(q.body.paymentPayload, q.body.paymentRequirements)));
  app.post("/settle", async (q, r) => {
    faults.settleCalls++;
    const out = await f.settle(q.body.paymentPayload, q.body.paymentRequirements);
    if (faults.dropNextSettleResponse) { faults.dropNextSettleResponse = false; q.socket.destroy(); return; }
    r.json(out);
  });
  const server: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  return { url: `http://127.0.0.1:${(server.address() as any).port}`, faults, close: () => server.close() };
}
