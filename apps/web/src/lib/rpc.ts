import { config } from "./config";

/** A read that did not produce an answer. `message` is written for the person looking at the page. */
export class ReadError extends Error {}

export const RPC_TIMEOUT_MS = 12_000;

/** One JSON-RPC read with a hard timeout. Never retries: the caller decides whether to ask again. */
export async function rpcRead(method: string, params: unknown[] = [], signal?: AbortSignal): Promise<unknown> {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, RPC_TIMEOUT_MS);
  const onAbort = () => ctl.abort();
  if (signal?.aborted) ctl.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const r = await fetch(config.rpcUrl, {
      method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: ctl.signal,
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (r.status === 429) throw new ReadError("The QIE RPC is rate limiting this connection. Nothing was verified; try again in a minute.");
    if (!r.ok) throw new ReadError(`The QIE RPC answered HTTP ${r.status}. Nothing was verified.`);
    const body: unknown = await r.json().catch(() => null);
    if (typeof body !== "object" || body === null) throw new ReadError("The QIE RPC returned an unreadable answer. Nothing was verified.");
    if ("error" in body && body.error) throw new ReadError("The QIE RPC refused the request. Nothing was verified.");
    if (!("result" in body)) throw new ReadError("The QIE RPC returned an incomplete answer. Nothing was verified.");
    return body.result;
  } catch (e) {
    if (e instanceof ReadError || signal?.aborted) throw e;
    throw new ReadError(timedOut ? "The QIE RPC did not answer in time. Nothing was verified." : "The QIE RPC could not be reached. Nothing was verified.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}
