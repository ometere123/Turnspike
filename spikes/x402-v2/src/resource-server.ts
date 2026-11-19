import express from "express";
import type { Server } from "node:http";
import { paymentMiddleware } from "@x402/express";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { Store } from "../../../packages/middleware/src/store";
import { SCHEME, caip2, unb64 } from "./common";
import { TurnspikeAllowanceServer, type ServerCfg } from "./server-scheme";

export interface RouteSpec { path: string; amount: string; asset?: string; payTo: string }

/**
 * Durable once-only delivery behind a settled upfront payment. Reuses the Turnspike store's fenced delivery lease:
 * the handler may run again only after a crash/lease lapse; a stored response is replayed byte-exact. The x402 middleware
 * has already settled (bound the proof) before this runs.
 */
export async function deliverOnce(store: Store, req: express.Request, res: express.Response, fn: () => Promise<unknown>, leaseSeconds = 30) {
  const hdr = req.header("payment-signature");
  const requestId = String(unb64(hdr!).payload.requestId).toLowerCase();
  const row = store.get(requestId)!;
  const replay = () => {
    const s = store.storedResponse(store.get(requestId)!);
    res.status(s.status).setHeader("content-type", s.type).setHeader("x-turnspike-replay", "1").end(s.body);
  };
  if (row.state === "DELIVERED") return replay();
  const lease = store.claimDelivery(requestId, leaseSeconds);
  if (!lease) return void res.status(202).json({ status: "pending", why: "delivering" });
  const body = Buffer.from(JSON.stringify(await fn()));
  if (!store.completeDelivery(requestId, lease, { status: 200, type: "application/json", body, headers: {} })) return replay();
  res.status(200).setHeader("content-type", "application/json").end(body);
}

export async function startResourceServer(opts: {
  facilitatorUrl: string; scheme: ServerCfg; store: Store; routes: RouteSpec[]; handlerCalls: { n: number };
  extraNetworks?: string[];
}) {
  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: opts.facilitatorUrl }));
  server.register(caip2(opts.scheme.chainId), new TurnspikeAllowanceServer(opts.scheme));
  const routes: Record<string, any> = {};
  for (const r of opts.routes) {
    routes[`GET ${r.path}`] = {
      accepts: { scheme: SCHEME, network: caip2(opts.scheme.chainId), payTo: r.payTo, price: { amount: r.amount, asset: r.asset ?? opts.scheme.token }, maxTimeoutSeconds: 300 },
      description: `turnspike-allowance paid route ${r.path}`, mimeType: "application/json",
    };
  }
  const app = express();
  app.use(paymentMiddleware(routes, server));
  for (const r of opts.routes) {
    app.get(r.path, (req, res) => deliverOnce(opts.store, req, res, async () => ({ route: r.path, query: req.query, n: ++opts.handlerCalls.n })));
  }
  const http: Server = await new Promise((res) => { const s = app.listen(0, "127.0.0.1", () => res(s)); });
  return { base: `http://127.0.0.1:${(http.address() as any).port}`, close: () => http.close() };
}
