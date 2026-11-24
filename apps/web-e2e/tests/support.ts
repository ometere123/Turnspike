import type { Page, Route } from "@playwright/test";

export const env = {
  rpc: process.env.E2E_RPC!, gw: process.env.E2E_GW!, token: process.env.E2E_TOKEN!, vault: process.env.E2E_VAULT!, merchant: process.env.E2E_MERCHANT!,
  paidTx: process.env.E2E_PAID_TX!, paidId: process.env.E2E_PAID_ID!, plainTx: process.env.E2E_PLAIN_TX!, revertTx: process.env.E2E_REVERT_TX!,
};
export const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };

export async function rpc(method: string, params: unknown[] = []): Promise<any> {
  const r = await fetch(env.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** Rewrites chosen JSON-RPC answers; everything else reaches the real local node. A function receives the real answer. */
export async function patchRpc(page: Page, replies: Record<string, unknown>) {
  await page.route(`${env.rpc}/**`, async (route: Route) => {
    const raw = route.request().postData();
    const body = raw ? JSON.parse(raw) : null;
    if (!body || Array.isArray(body) || !(body.method in replies)) return route.continue();
    const rep = replies[body.method];
    const result = typeof rep === "function" ? await rep(await rpc(body.method, body.params), body.params) : rep;
    await route.fulfill({ status: 200, headers: CORS, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) });
  });
}
export async function gatewayStatus(page: Page, reply: { status?: number; json?: unknown; abort?: boolean; delayMs?: number }) {
  await page.route(`${env.gw}/v1/payments/**`, async (route) => {
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    if (reply.abort) return route.abort("connectionfailed");
    await route.fulfill({ status: reply.status ?? 200, headers: CORS, contentType: "application/json", body: JSON.stringify(reply.json ?? {}) }).catch(() => {});
  });
}

/** A test double for a wallet: an EIP-1193 provider backed by the local node's unlocked accounts. Not QIE Wallet or MetaMask. */
export async function injectWallet(page: Page, init: Record<string, unknown> = {}) {
  await page.addInitScript(({ rpcUrl, init }) => {
    const st: any = { chain: "0x7c6", acct: 0, reject: [], connected: false, drop: false, sent: [], calls: [], ...init };
    const handlers: Record<string, ((v: any) => void)[]> = {};
    const rpc = async (method: string, params: any[] = []) => {
      const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      const j = await r.json();
      if (j.error) { const e: any = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data?.data ?? j.error.data; throw e; }
      return j.result;
    };
    (window as any).__wallet = st;
    (window as any).__emit = (e: string, v: any) => (handlers[e] ?? []).forEach((h) => h(v));
    (window as any).ethereum = {
      on: (e: string, h: any) => { (handlers[e] ??= []).push(h); },
      removeListener: () => {},
      request: async ({ method, params }: any) => {
        st.calls.push(method);
        if (st.reject.includes(method)) { const e: any = new Error("User rejected the request."); e.code = 4001; throw e; }
        if (method === "eth_requestAccounts") st.connected = true;
        if (method === "eth_requestAccounts" || method === "eth_accounts") return st.connected ? [(await rpc("eth_accounts"))[st.acct]] : [];
        if (method === "eth_chainId") return st.chain;
        if (method === "wallet_switchEthereumChain") { st.chain = params[0].chainId; (window as any).__emit("chainChanged", st.chain); return null; }
        if (method === "eth_sendTransaction") {
          st.sent.push(params[0]);
          const h = await rpc(method, params);
          if (st.drop) st.blind = true; // from now on this wallet cannot read the chain
          return h;
        }
        if (st.blind && /Receipt|getTransactionByHash|blockNumber/i.test(method)) throw new Error("network connection lost");
        return rpc(method, params);
      },
    };
  }, { rpcUrl: env.rpc, init });
}
/** Runs a statement in the page with `st` (the mock wallet's state) and `emit` (its event emitter) in scope. */
export const wallet = (page: Page, f: string) => page.evaluate(`(() => { const st = window.__wallet, emit = window.__emit; ${f} })()`);
