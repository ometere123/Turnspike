// Child-process agent for the multi-process x402 tests: a real OS process using createX402Fetch with a FileJournal and a
// FileProofStore, against the local Hardhat chain only.
//
// argv[2] is a JSON object: { mode: "buy" | "crash" | "recover", rpc, chainId, contract, token, owner, merchant, phrase,
//   agentIndex, journal, proofs, base, worker, count }
// "buy":     pays `count` distinct resources concurrently through createX402Fetch; prints one JSON line per result.
// "crash":   buys `${base}/v1/report?crash=1` and exits with code 3 the moment the payment is broadcast (before it is
//            confirmed or presented), leaving a `broadcast` journal record.
// "recover": buys the same URL again (same derived purchase key) and prints the result.
import { HDNodeWallet, JsonRpcProvider } from "ethers";
import { TurnspikeClient, FileJournal } from "@turnspike-qie/client";
import { createX402Fetch, FileProofStore } from "../src";

const a = JSON.parse(process.argv[2]);
const provider = new JsonRpcProvider(a.rpc, a.chainId, { staticNetwork: true, cacheTimeout: -1 });
if (process.env.AGENT_DEBUG) provider.on("debug", (d: any) => { if (d.action === "receiveRpcResult" && d.result?.some?.((x: any) => x.error)) process.stderr.write(JSON.stringify(d.result.filter((x: any) => x.error)) + String.fromCharCode(10)); });
const wallet = HDNodeWallet.fromPhrase(a.phrase, undefined, `m/44'/60'/0'/0/${a.agentIndex}`).connect(provider);
const network = { name: "local", chainId: a.chainId, contract: a.contract, token: a.token, decimals: 6, rpcUrls: [a.rpc], explorer: "http://explorer.local" };
const journal = new FileJournal(a.journal);
const client = new TurnspikeClient({
  signer: wallet, owner: a.owner, network, policy: { payees: [{ origin: a.base, merchant: a.merchant }], maxPriceBase: 10_000n },
  journal, confirmations: 1, txTimeoutMs: 60_000,
  onEvent: (e) => { if (a.mode === "crash" && e.evt === "payment_broadcast") { process.stdout.write("BROADCAST\n"); process.exit(3); } },
} as any);
const pay = createX402Fetch({
  client: client as any, journal: journal as any, owner: a.owner, agent: wallet.address, network: { chainId: a.chainId, token: a.token },
  proofStore: new FileProofStore(a.proofs), retry: { attempts: 20, baseDelayMs: 200, maxDelayMs: 1000, totalMs: 60_000 },
});

async function one(url: string) {
  try {
    const r = await pay(url);
    if (r.ok) return { url, ok: true, kind: r.kind, resumed: r.resumed, transaction: r.transaction, body: await r.response.json() };
    return { url, ok: false, error: r.error, message: r.message, paid: r.paid, maybePaid: r.maybePaid };
  } catch (e) {
    return { url, ok: false, error: "exception", message: String((e as Error)?.message ?? e) };
  }
}

async function main() {
  if (a.mode === "buy") {
    const urls = Array.from({ length: a.count }, (_, i) => `${a.base}/v1/report?w=${a.worker}&i=${i}`);
    for (const r of await Promise.all(urls.map(one))) process.stdout.write(JSON.stringify(r) + "\n");
  } else {
    process.stdout.write(JSON.stringify(await one(`${a.base}/v1/report?crash=1`)) + "\n");
  }
  provider.destroy();
  process.exit(0);
}
main().catch((e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });
