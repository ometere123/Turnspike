import { Contract, Interface, Provider, Signer, getAddress, id as keccakId } from "ethers";
import { ALLOWANCE_ABI, Challenge, Network, PROTOCOL, challengeSchema, encodeProof, formatUnits } from "./protocol";
import { Journal, JournalRecord, MemoryJournal } from "./journal";

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);

/** A destination the agent is allowed to pay: requests to `origin` may be paid only to `merchant`. */
export interface TrustedPayee { origin: string; merchant: string; maxPriceBase?: bigint }

export interface SpendingPolicy {
  /** Explicit allowlist. A 402 from any other origin, or naming any other merchant, is refused. Required. */
  payees: TrustedPayee[];
  /** Hard ceiling per request, in token base units (QUSDC: 6 decimals, 1000 = 0.001). Required. */
  maxPriceBase: bigint;
  /** Ceiling on the gas cost of one payment, in wei of the native coin. Default 0.002 QIE. */
  maxGasCostWei?: bigint;
  /** Refuse to pay when the agent's native balance would drop below this after gas. Default 0. */
  minGasReserveWei?: bigint;
  /** Refuse challenges that expire sooner than this many seconds from now (not enough time to mine). Default 20. */
  minSecondsToExpiry?: number;
}

/** Everything known about a payment before it is made. Passed to `approve` and returned by dry runs. */
export interface Quote {
  url: string;
  origin: string;
  method: string;
  merchant: string;
  resourceId: string;
  requestId: string;
  priceBase: bigint;
  price: string; // formatted, e.g. "0.001"
  symbol: string;
  chainId: number;
  contract: string;
  token: string;
  expiresAt: number;
  owner: string;
  agent: string;
  ownerBalanceBase: bigint;
  remainingTodayBase: bigint;
  perCallCapBase: bigint;
  gasEstimate: bigint;
  gasPriceWei: bigint;
  gasCostWei: bigint;
  agentGasBalanceWei: bigint;
}

export type ErrorCode =
  | "invalid_challenge" | "unsupported_protocol" | "untrusted_destination" | "wrong_network" | "price_above_max" | "challenge_expired"
  | "not_authorized_agent" | "paused" | "merchant_not_allowed" | "over_per_call_cap" | "over_daily_cap" | "insufficient_balance"
  | "insufficient_gas" | "gas_cost_above_max" | "declined" | "already_paid" | "tx_reverted" | "tx_timeout" | "rpc_unavailable"
  | "gateway_unavailable" | "redeem_rejected" | "redeem_timeout" | "request_failed" | "payment_pending";

export interface PaymentInfo { requestId: string; txHash?: string; blockNumber?: number; priceBase: bigint; merchant: string; explorerUrl?: string }

export type PaidFetchResult =
  | { ok: true; kind: "free"; response: Response }
  | { ok: true; kind: "paid"; response: Response; payment: PaymentInfo; replayed: boolean }
  | { ok: true; kind: "dry_run"; quote: Quote }
  /**
   * `paid: true` means QUSDC left the owner's account. A blockchain payment cannot be reversed because a later HTTP step
   * failed; keep the idempotency key and call resume() later to collect the resource.
   */
  | { ok: false; error: ErrorCode; message: string; paid: boolean; payment?: PaymentInfo; quote?: Quote; detail?: unknown };

export interface ClientOptions {
  /** The authorized AGENT signer (never the owner's key). Any ethers Signer: keystore wallet, KMS, HSM, remote signer. */
  signer: Signer;
  /** Owner whose allowance account funds payments. */
  owner: string;
  network: Network;
  policy: SpendingPolicy;
  /** Called with the quote before any transaction. Return false to decline. Default: approve anything inside the policy. */
  approve?: (q: Quote) => boolean | Promise<boolean>;
  /** Persists payment progress. Default in-memory (no restart safety). */
  journal?: Journal;
  confirmations?: number; // default 2
  txTimeoutMs?: number; // default 120 000
  redeemTimeoutMs?: number; // default 120 000
  /** Injected fetch (tests, proxies). Default global fetch. */
  fetch?: typeof fetch;
  /** Structured events for logging. Never receives keys or proof sigs. */
  onEvent?: (e: Record<string, unknown>) => void;
}

export interface FetchOptions {
  /** Inspect the challenge and the quote, run every check, broadcast nothing. */
  dryRun?: boolean;
  /** Stable key for this logical purchase. With a persistent journal it makes the call safe to repeat after a crash. */
  idempotencyKey?: string;
  /** Lower ceiling for this call only. */
  maxPriceBase?: bigint;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const lc = (s: string) => s.toLowerCase();

function decodeRevert(e: any): string | null {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data ?? e?.revert?.data;
  if (e?.revert?.name) return e.revert.name;
  try { const p = iface.parseError(data); return p?.name ?? null; } catch { return null; }
}

const REVERT_CODE: Record<string, ErrorCode> = {
  NotOwnerAgent: "not_authorized_agent", Paused: "paused", MerchantNotAllowed: "merchant_not_allowed", CapExceeded: "over_per_call_cap",
  DailyCapExceeded: "over_daily_cap", InsufficientBalance: "insufficient_balance", RequestAlreadyUsed: "already_paid",
};

/**
 * Buyer-side Turnspike client for autonomous agents.
 *
 * Security defaults: it never pays a 402 unless the request origin AND the merchant in the challenge are on the explicit
 * payee allowlist, the chain, contract and token match the trusted network, and the price is within the policy. It checks
 * the owner's on-chain policy, balance and the agent's gas before broadcasting, so a refusal costs nothing.
 */
export class TurnspikeClient {
  private readonly o: Required<Pick<ClientOptions, "confirmations" | "txTimeoutMs" | "redeemTimeoutMs">> & ClientOptions;
  private readonly provider: Provider;
  private readonly journal: Journal;
  private readonly vault: Contract;
  private readonly http: typeof fetch;

  constructor(opts: ClientOptions) {
    if (!opts.signer.provider) throw new Error("signer must be connected to a provider");
    if (!opts.policy?.payees?.length) throw new Error("policy.payees is required: an agent must never pay arbitrary 402 responses");
    if (opts.policy.maxPriceBase === undefined || opts.policy.maxPriceBase <= 0n) throw new Error("policy.maxPriceBase is required");
    this.o = { confirmations: 2, txTimeoutMs: 120_000, redeemTimeoutMs: 120_000, ...opts };
    this.provider = opts.signer.provider;
    this.journal = opts.journal ?? new MemoryJournal();
    this.vault = new Contract(opts.network.contract, ALLOWANCE_ABI as unknown as string[], opts.signer);
    this.http = opts.fetch ?? fetch;
  }

  private emit(e: Record<string, unknown>) { this.o.onEvent?.(e); }
  private explorer(tx?: string) { return tx ? `${this.o.network.explorer}/tx/${tx}` : undefined; }
  private fail(error: ErrorCode, message: string, extra: Partial<Extract<PaidFetchResult, { ok: false }>> = {}): PaidFetchResult {
    this.emit({ evt: "payment_failed", error, message });
    return { ok: false, error, message, paid: false, ...extra };
  }

  /** Fetches a URL; if it answers with a trusted Turnspike 402, pays within policy and returns the paid response. */
  async fetch(url: string, init: RequestInit = {}, fo: FetchOptions = {}): Promise<PaidFetchResult> {
    const method = (init.method ?? "GET").toUpperCase();
    if (fo.idempotencyKey) {
      const prev = await this.journal.get(fo.idempotencyKey);
      if (prev && prev.state !== "failed") return this.resumeRecord(prev, init);
    }
    let res: Response;
    try { res = await this.http(url, init); } catch (e: any) { return this.fail("gateway_unavailable", `request failed: ${e?.message ?? e}`); }
    if (res.status !== 402) return { ok: true, kind: "free", response: res };

    const quoteOrErr = await this.quote(url, method, res, fo.maxPriceBase);
    if ("error" in quoteOrErr) return quoteOrErr.error;
    const { quote, challenge } = quoteOrErr;
    if (fo.dryRun) return { ok: true, kind: "dry_run", quote };
    if (this.o.approve && !(await this.o.approve(quote))) return this.fail("declined", "the approve callback declined this payment", { quote });

    const rec: JournalRecord = {
      key: fo.idempotencyKey ?? `${method} ${url} ${challenge.requestId}`, url, method, state: "challenged", challenge,
      owner: quote.owner, agent: quote.agent, updatedAt: now(),
    };
    await this.journal.put(rec);
    return this.payAndRedeem(rec, init, quote);
  }

  /** Continues a purchase recorded in the journal (after a crash, timeout or gateway outage). Never pays twice. */
  async resume(idempotencyKey: string, init: RequestInit = {}): Promise<PaidFetchResult> {
    const rec = await this.journal.get(idempotencyKey);
    if (!rec) return this.fail("request_failed", "no journal record for that key");
    return this.resumeRecord(rec, init);
  }

  private async quote(url: string, method: string, res: Response, maxOverride?: bigint): Promise<{ quote: Quote; challenge: Challenge } | { error: PaidFetchResult }> {
    const p = this.o.policy, n = this.o.network;
    let raw: unknown;
    try { raw = await res.json(); } catch { return { error: this.fail("invalid_challenge", "402 body is not JSON") }; }
    const parsed = challengeSchema.safeParse(raw);
    if (!parsed.success) return { error: this.fail("invalid_challenge", "402 body is not a Turnspike challenge", { detail: parsed.error.issues.map((i) => i.path.join(".") + ": " + i.message) }) };
    const c = parsed.data;
    if (c.protocol && c.protocol !== PROTOCOL) return { error: this.fail("unsupported_protocol", `challenge protocol ${c.protocol} is not ${PROTOCOL}`) };

    const origin = new URL(url).origin;
    const payee = p.payees.find((t) => new URL(t.origin).origin === origin && lc(t.merchant) === lc(c.merchant));
    if (!payee) return { error: this.fail("untrusted_destination", `refusing to pay ${c.merchant} for ${origin}: not on the payee allowlist`) };
    if (c.chainId !== n.chainId || lc(c.contract) !== lc(n.contract) || lc(c.token) !== lc(n.token)) {
      return { error: this.fail("wrong_network", `challenge names chain ${c.chainId}, contract ${c.contract}, token ${c.token}; trusted is chain ${n.chainId}, ${n.contract}, ${n.token}`) };
    }
    const price = BigInt(c.priceBase);
    const ceiling = [p.maxPriceBase, payee.maxPriceBase, maxOverride].filter((x): x is bigint => x !== undefined).reduce((a, b) => (b < a ? b : a));
    if (price > ceiling) return { error: this.fail("price_above_max", `price ${formatUnits(price, n.decimals)} exceeds the maximum ${formatUnits(ceiling, n.decimals)}`) };
    if (price === 0n) return { error: this.fail("invalid_challenge", "zero price") };
    if (c.expiresAt - now() < (p.minSecondsToExpiry ?? 20)) return { error: this.fail("challenge_expired", "challenge expires too soon to pay safely") };

    try {
      const net = await this.provider.getNetwork();
      if (net.chainId !== BigInt(n.chainId)) return { error: this.fail("wrong_network", `provider is on chain ${net.chainId}, expected ${n.chainId}`) };
      const owner = getAddress(this.o.owner);
      const agent = await this.o.signer.getAddress();
      const [acct, spent, allowed, used, gasBal, fee] = await Promise.all([
        this.vault.account(owner), this.vault.spentToday(owner), this.vault.allowedMerchant(owner, c.merchant), this.vault.isUsed(c.merchant, c.requestId),
        this.provider.getBalance(agent), this.provider.getFeeData(),
      ]);
      const base = { url, origin, method, merchant: getAddress(c.merchant), resourceId: c.resourceId, requestId: c.requestId, priceBase: price, price: formatUnits(price, n.decimals), symbol: "QUSDC", chainId: c.chainId, contract: c.contract, token: c.token, expiresAt: c.expiresAt, owner, agent };
      const remaining = (acct.dailyCap as bigint) > (spent as bigint) ? (acct.dailyCap as bigint) - (spent as bigint) : 0n;
      const partial = { ...base, ownerBalanceBase: acct.balance as bigint, remainingTodayBase: remaining, perCallCapBase: acct.perCallCap as bigint, agentGasBalanceWei: gasBal };
      if (lc(acct.agent) !== lc(agent)) return { error: this.fail("not_authorized_agent", `the owner's authorized agent is ${acct.agent}, this signer is ${agent}`) };
      if (acct.paused) return { error: this.fail("paused", "the owner has paused payments") };
      if (!allowed) return { error: this.fail("merchant_not_allowed", `merchant ${c.merchant} is not on the owner's on-chain allowlist`) };
      if (used) return { error: this.fail("already_paid", "this requestId is already paid on chain") };
      if (price > (acct.perCallCap as bigint)) return { error: this.fail("over_per_call_cap", `price exceeds the owner's per-call cap ${formatUnits(acct.perCallCap, n.decimals)}`) };
      if (price > remaining) return { error: this.fail("over_daily_cap", `price exceeds what is left of today's cap (${formatUnits(remaining, n.decimals)})`) };
      if (price > (acct.balance as bigint)) return { error: this.fail("insufficient_balance", `owner balance ${formatUnits(acct.balance, n.decimals)} is below the price`) };
      const gasPrice = fee.gasPrice ?? fee.maxFeePerGas ?? 0n;
      let gasEstimate: bigint;
      try { gasEstimate = await this.vault.pay.estimateGas(owner, c.merchant, c.requestId, price); } catch (e) {
        const name = decodeRevert(e);
        return { error: this.fail(name && REVERT_CODE[name] ? REVERT_CODE[name] : "tx_reverted", `the payment would revert${name ? `: ${name}` : ""}`) };
      }
      const gasCost = gasEstimate * gasPrice;
      const quote: Quote = { ...partial, gasEstimate, gasPriceWei: gasPrice, gasCostWei: gasCost };
      if (gasCost > (p.maxGasCostWei ?? 2_000_000_000_000_000n)) return { error: this.fail("gas_cost_above_max", `gas cost ${gasCost} wei exceeds the maximum`, { quote }) };
      if (gasBal < gasCost + (p.minGasReserveWei ?? 0n)) return { error: this.fail("insufficient_gas", `agent has ${gasBal} wei, needs ${gasCost} for gas plus the reserve`, { quote }) };
      return { quote, challenge: c };
    } catch (e: any) {
      return { error: this.fail("rpc_unavailable", `chain read failed: ${e?.shortMessage ?? e?.message ?? e}`) };
    }
  }

  private async payAndRedeem(rec: JournalRecord, init: RequestInit, quote?: Quote): Promise<PaidFetchResult> {
    const c = rec.challenge;
    try {
      // Record the nonce and head BEFORE broadcasting, so a crash after broadcast can be recovered without paying again.
      rec.nonce = await this.provider.getTransactionCount(rec.agent, "pending");
      rec.fromBlock = await this.provider.getBlockNumber();
      rec.state = "paying"; rec.updatedAt = now();
      await this.journal.put(rec);
    } catch (e: any) {
      return this.fail("rpc_unavailable", `could not prepare the payment: ${e?.shortMessage ?? e?.message ?? e}`, { quote });
    }
    let txHash: string;
    try {
      const tx = await this.vault.pay(rec.owner, c.merchant, c.requestId, BigInt(c.priceBase), { nonce: rec.nonce, ...(quote ? { gasLimit: (quote.gasEstimate * 12n) / 10n } : {}) });
      txHash = tx.hash;
    } catch (e: any) {
      // Refused before entering the chain (estimate or node rejected it). Nothing was broadcast at this nonce.
      const name = decodeRevert(e);
      rec.state = "failed"; rec.error = name ?? String(e?.shortMessage ?? e?.message ?? e); rec.updatedAt = now();
      await this.journal.put(rec);
      return this.fail(name && REVERT_CODE[name] ? REVERT_CODE[name] : "tx_reverted", `pay was refused: ${rec.error}`, { quote });
    }
    // Broadcast succeeded. If recording the hash fails, let it throw: the record stays "paying" and resume() recovers
    // the payment from the chain. Marking it failed here would invite a second payment.
    rec.txHash = txHash; rec.state = "broadcast"; rec.updatedAt = now();
    await this.journal.put(rec);
    this.emit({ evt: "payment_broadcast", requestId: c.requestId, txHash });
    return this.confirmAndRedeem(rec, init);
  }

  private async confirmAndRedeem(rec: JournalRecord, init: RequestInit): Promise<PaidFetchResult> {
    const c = rec.challenge;
    const info = (): PaymentInfo => ({ requestId: c.requestId, txHash: rec.txHash, blockNumber: rec.blockNumber, priceBase: BigInt(c.priceBase), merchant: c.merchant, explorerUrl: this.explorer(rec.txHash) });
    if (rec.state === "broadcast") {
      let receipt;
      try { receipt = await this.provider.waitForTransaction(rec.txHash!, this.o.confirmations, this.o.txTimeoutMs); } catch (e: any) {
        if (String(e?.code) === "TIMEOUT") return { ok: false, error: "tx_timeout", message: "payment not confirmed in time; call resume() later", paid: false, payment: info() };
        if (e?.receipt?.status === 0) receipt = e.receipt; else return { ok: false, error: "rpc_unavailable", message: String(e?.shortMessage ?? e?.message ?? e), paid: false, payment: info() };
      }
      if (!receipt) return { ok: false, error: "tx_timeout", message: "payment not confirmed in time; call resume() later", paid: false, payment: info() };
      if (receipt.status !== 1) {
        rec.state = "failed"; rec.error = "reverted"; rec.updatedAt = now(); await this.journal.put(rec);
        return { ok: false, error: "tx_reverted", message: "the pay transaction reverted on chain (gas was spent, no QUSDC moved)", paid: false, payment: info() };
      }
      rec.state = "confirmed"; rec.blockNumber = receipt.blockNumber; rec.updatedAt = now();
      await this.journal.put(rec);
      this.emit({ evt: "payment_confirmed", requestId: c.requestId, txHash: rec.txHash, blockNumber: receipt.blockNumber });
    }
    return this.redeem(rec, init, info);
  }

  private async redeem(rec: JournalRecord, init: RequestInit, info: () => PaymentInfo): Promise<PaidFetchResult> {
    const header = encodeProof({ requestId: rec.challenge.requestId, txHash: rec.txHash!, sig: rec.challenge.sig });
    const deadline = Date.now() + this.o.redeemTimeoutMs;
    let delay = 1000;
    let last = "";
    while (Date.now() < deadline) {
      let res: Response;
      try {
        res = await this.http(rec.url, { ...init, method: rec.method, headers: { ...(init.headers as Record<string, string> | undefined), "x-payment": header } });
      } catch (e: any) {
        last = `gateway unreachable: ${e?.message ?? e}`;
        await sleep(delay); delay = Math.min(delay * 2, 15_000); continue;
      }
      if (res.status >= 200 && res.status < 300 && res.status !== 202) {
        rec.state = "delivered"; rec.updatedAt = now(); await this.journal.put(rec);
        this.emit({ evt: "delivered", requestId: rec.challenge.requestId, status: res.status });
        return { ok: true, kind: "paid", response: res, payment: info(), replayed: res.headers.get("x-turnspike-replay") === "1" };
      }
      if (res.status === 202 || res.status === 503 || res.status === 429 || res.status >= 500) {
        const body: any = await res.json().catch(() => ({}));
        last = `${res.status} ${body.why ?? body.error ?? ""}`.trim();
        const hinted = Number(body.retryAfter ?? res.headers.get("retry-after") ?? 0) * 1000;
        await sleep(Math.max(hinted, delay)); delay = Math.min(delay * 2, 15_000); continue;
      }
      const body: any = await res.json().catch(() => ({}));
      return { ok: false, error: "redeem_rejected", message: `the gateway refused the proof: ${res.status} ${body.reason ?? body.error ?? ""}`.trim(), paid: true, payment: info(), detail: body };
    }
    return { ok: false, error: last.startsWith("gateway unreachable") ? "gateway_unavailable" : "redeem_timeout", message: `paid but not yet delivered (${last}); call resume() with the same key`, paid: true, payment: info() };
  }

  private async resumeRecord(rec: JournalRecord, init: RequestInit): Promise<PaidFetchResult> {
    const c = rec.challenge;
    const info = (): PaymentInfo => ({ requestId: c.requestId, txHash: rec.txHash, blockNumber: rec.blockNumber, priceBase: BigInt(c.priceBase), merchant: c.merchant, explorerUrl: this.explorer(rec.txHash) });
    this.emit({ evt: "resume", key: rec.key, state: rec.state });
    if (rec.state === "delivered" || rec.state === "confirmed") return this.redeem(rec, init, info);
    if (rec.state === "broadcast") return this.confirmAndRedeem(rec, init);
    if (rec.state === "challenged") return this.payAndRedeem(rec, init); // nothing was broadcast
    if (rec.state === "paying") {
      // A crash happened between recording the nonce and recording the transaction hash. Find out what happened on chain.
      try {
        const used: boolean = await this.vault.isUsed(c.merchant, c.requestId);
        if (used) {
          const tx = await this.findPaidTx(rec);
          if (!tx) return { ok: false, error: "payment_pending", message: "requestId is paid on chain but the transaction was not found yet; retry resume()", paid: true, payment: info() };
          rec.txHash = tx; rec.state = "broadcast"; await this.journal.put(rec);
          return this.confirmAndRedeem(rec, init);
        }
        const mined = await this.provider.getTransactionCount(rec.agent, "latest");
        const pending = await this.provider.getTransactionCount(rec.agent, "pending");
        if (rec.nonce !== undefined && pending > rec.nonce && mined <= rec.nonce) {
          return { ok: false, error: "payment_pending", message: "a transaction from the recorded nonce is still pending; retry resume() later", paid: false, payment: info() };
        }
        // Not paid and nothing pending at that nonce: the broadcast never happened, or that nonce was used by another tx.
        if (c.expiresAt - now() < (this.o.policy.minSecondsToExpiry ?? 20)) {
          rec.state = "failed"; rec.error = "expired_before_payment"; await this.journal.put(rec);
          return this.fail("challenge_expired", "the challenge expired before a payment was made; nothing was paid");
        }
        return this.payAndRedeem(rec, init);
      } catch (e: any) {
        return this.fail("rpc_unavailable", `chain read failed: ${e?.shortMessage ?? e?.message ?? e}`);
      }
    }
    return this.fail("request_failed", `journal record is in state ${rec.state}`);
  }

  private async findPaidTx(rec: JournalRecord): Promise<string | null> {
    const ev = iface.getEvent("Paid")!;
    const pad = (a: string) => "0x" + lc(a).replace(/^0x/, "").padStart(64, "0");
    const logs = await this.provider.getLogs({ address: this.o.network.contract, topics: [ev.topicHash, pad(rec.owner), pad(rec.agent), pad(rec.challenge.merchant)], fromBlock: rec.fromBlock ?? 0, toBlock: "latest" });
    for (const l of logs) {
      const p = iface.parseLog({ topics: [...l.topics], data: l.data });
      if (p && lc(String(p.args.requestId)) === lc(rec.challenge.requestId)) return l.transactionHash;
    }
    return null;
  }
}

/** Stable idempotency key helper for a logical purchase (method, URL and an optional body). */
export const idempotencyKey = (method: string, url: string, body?: string) => keccakId(`${method.toUpperCase()} ${url} ${body ?? ""}`);
