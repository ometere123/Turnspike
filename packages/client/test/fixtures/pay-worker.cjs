// Child process for the multi-process tests in paychallenge.test.ts. Runs the BUILT client (dist), so it exercises the
// same code a real agent process would, against the local Hardhat chain only.
//
// argv[2] is a JSON object:
//   { mode: "buy" | "hang", dist, rpc, chainId, contract, token, owner, merchant, phrase, agentIndex, journal, base, worker, count }
// "buy":  fetches `count` fresh challenges from the seller and pays them concurrently with payChallenge, one purchase key
//         each, then prints one JSON line per result and exits.
// "hang": pays one challenge with a signer whose send never returns; prints "SENDING" when the transaction is about to
//         be sent, then waits forever (the parent kills it mid-payment).
"use strict";
const a = JSON.parse(process.argv[2]);
const { TurnspikeClient, FileJournal } = require(a.dist);
const { AbstractSigner, HDNodeWallet, JsonRpcProvider } = require("ethers");

const provider = new JsonRpcProvider(a.rpc, a.chainId, { staticNetwork: true, cacheTimeout: -1 });
const wallet = HDNodeWallet.fromPhrase(a.phrase, undefined, `m/44'/60'/0'/0/${a.agentIndex}`).connect(provider);

/** Signs like the agent but never finishes sending: a process that dies between nonce allocation and broadcast. */
class HangSigner extends AbstractSigner {
  constructor(inner) { super(inner.provider); this.inner = inner; }
  getAddress() { return this.inner.getAddress(); }
  connect() { throw new Error("unused"); }
  signTransaction(tx) { return this.inner.signTransaction(tx); }
  signMessage(m) { return this.inner.signMessage(m); }
  signTypedData(d, t, v) { return this.inner.signTypedData(d, t, v); }
  sendTransaction() { process.stdout.write("SENDING\n"); return new Promise(() => {}); }
}

const network = { name: "local", chainId: a.chainId, contract: a.contract, token: a.token, decimals: 6, rpcUrls: [a.rpc], explorer: "http://explorer.local" };
const client = new TurnspikeClient({
  signer: a.mode === "hang" ? new HangSigner(wallet) : wallet, owner: a.owner, network,
  policy: { payees: [{ origin: a.base, merchant: a.merchant }], maxPriceBase: 10000n },
  journal: new FileJournal(a.journal), confirmations: 1, txTimeoutMs: 60000,
});

async function challenge(url) {
  const res = await fetch(url);
  if (res.status !== 402) throw new Error(`expected 402 from ${url}, got ${res.status}`);
  return res.json();
}

async function buyOne(i) {
  const url = `${a.base}/v1/report?w=${a.worker}&i=${i}`;
  const key = `w${a.worker}-${i}`;
  try {
    const r = await client.payChallenge(await challenge(url), { url, method: "GET", purchaseKey: key });
    return r.ok ? { key, ok: true, requestId: r.proof.requestId, txHash: r.proof.txHash } : { key, ok: false, error: r.error, message: r.message, paid: r.paid, maybePaid: !!r.maybePaid };
  } catch (e) {
    return { key, ok: false, error: "exception", message: String((e && e.message) || e) };
  }
}

(async () => {
  if (a.mode === "hang") {
    const url = `${a.base}/v1/report?hang=${a.worker}`;
    await client.payChallenge(await challenge(url), { url, method: "GET", purchaseKey: `hang-${a.worker}` });
    return;
  }
  const results = await Promise.all(Array.from({ length: a.count }, (_, i) => buyOne(i)));
  for (const r of results) process.stdout.write(JSON.stringify(r) + "\n");
  provider.destroy();
})().catch((e) => { process.stderr.write(String((e && e.stack) || e)); process.exit(1); });
