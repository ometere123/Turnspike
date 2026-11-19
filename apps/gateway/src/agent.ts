import { Contract, Interface, JsonRpcProvider, Signer, Wallet } from "ethers";

export const VAULT_ABI = [
  "function pay(address owner,address merchant,bytes32 requestId,uint256 amount)",
  "function account(address owner) view returns (tuple(uint256 balance,bool paused,address agent,uint256 perCallCap,uint256 dailyCap,uint256 dayIndex,uint256 spentToday))",
  "function isUsed(address merchant,bytes32 requestId) view returns (bool)",
  "error NotOwnerAgent()", "error Paused()", "error MerchantNotAllowed()", "error CapExceeded(uint256 cap,uint256 attempted)",
  "error DailyCapExceeded(uint256 cap,uint256 attempted)", "error RequestAlreadyUsed(bytes32 requestId)", "error InsufficientBalance()",
  "error DepositCapExceeded()", "error ZeroAmount()", "error ZeroAddress()",
];
const iface = new Interface(VAULT_ABI);

/** Human text for custom errors (doc 07 error mapping). */
export const ERROR_TEXT: Record<string, string> = {
  NotOwnerAgent: "This agent is not authorised for that owner (revoked or wrong key)",
  Paused: "The owner has paused payments",
  MerchantNotAllowed: "Merchant is not on the owner's allowlist",
  CapExceeded: "Over the per-call limit",
  DailyCapExceeded: "Over the daily limit",
  RequestAlreadyUsed: "This request ID was already paid (replay refused)",
  InsufficientBalance: "Owner balance is too low",
};

export interface Step { step: string; ok: boolean; txHash?: string; detail?: unknown }
export interface AgentOpts { baseUrl: string; resourcePath: string; signer: Signer; provider: JsonRpcProvider; vault: string; owner: string; maxPolls?: number; pollMs?: number }

export function decodeRevert(e: any): { name: string; text: string } {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  try {
    const p = iface.parseError(data);
    if (p) return { name: p.name, text: ERROR_TEXT[p.name] ?? p.name };
  } catch { /* fall through */ }
  return { name: "unknown", text: e?.shortMessage ?? String(e?.message ?? e) };
}

const hdr = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64");

/** Scripted agent obeying the Turnspike 402 flow (FR-019, DEC-6: no LLM). */
export class DemoAgent {
  lastProof: { requestId: string; txHash: string; sig?: string } | null = null;
  constructor(private o: AgentOpts) {}

  private vault() { return new Contract(this.o.vault, VAULT_ABI, this.o.signer); }

  async challenge(): Promise<any> {
    const r = await fetch(this.o.baseUrl + this.o.resourcePath);
    if (r.status !== 402) throw new Error(`expected 402, got ${r.status}`);
    return r.json();
  }

  /** 402 -> pay -> proof -> data. Returns the step log. */
  async paidCall(): Promise<{ steps: Step[]; data?: unknown }> {
    const steps: Step[] = [];
    const ch = await this.challenge();
    steps.push({ step: "402 challenge", ok: true, detail: { requestId: ch.requestId, priceBase: ch.priceBase, expiresAt: ch.expiresAt } });
    try {
      const tx = await this.vault().pay(this.o.owner, ch.merchant, ch.requestId, BigInt(ch.priceBase));
      steps.push({ step: "pay submitted", ok: true, txHash: tx.hash });
      await tx.wait();
    } catch (e) {
      const d = decodeRevert(e);
      steps.push({ step: "pay refused", ok: false, detail: d });
      return { steps };
    }
    const proof = { requestId: ch.requestId, txHash: steps[1].txHash!, sig: ch.sig };
    this.lastProof = proof;
    const t0 = Date.now();
    for (let i = 0; i < (this.o.maxPolls ?? 30); i++) {
      const r = await fetch(this.o.baseUrl + this.o.resourcePath, { headers: { "x-payment": hdr(proof) } });
      const body: any = await r.json().catch(() => ({}));
      if (r.status === 202) {
        steps.push({ step: "pending", ok: true, detail: { why: body.why, confirmations: body.confirmations, elapsedSeconds: Math.round((Date.now() - t0) / 1000) } });
        await new Promise((s) => setTimeout(s, (body.retryAfter ?? 4) * 1000 * (this.o.pollMs ? this.o.pollMs / 4000 : 1)));
        continue;
      }
      steps.push({ step: "delivered", ok: r.status === 200, detail: { status: r.status } });
      return { steps, data: body };
    }
    steps.push({ step: "gave up waiting", ok: false });
    return { steps };
  }

  /** Pays more than the per-call cap. The tx is really broadcast (fixed gas limit) so the revert has an explorer link. */
  async overCap(): Promise<{ steps: Step[] }> {
    const ch = await this.challenge();
    const acct = await new Contract(this.o.vault, VAULT_ABI, this.o.provider).account(this.o.owner);
    return { steps: [await this.forcedPay(ch.merchant, ch.requestId, acct.perCallCap + 1n, "over-cap pay")] };
  }

  /** Re-presents the previous proof (idempotent) and tries to pay the same requestId again (on-chain refusal). */
  async replay(): Promise<{ steps: Step[]; data?: unknown }> {
    if (!this.lastProof) return { steps: [{ step: "replay", ok: false, detail: "no earlier proof; run a paid call first" }] };
    const p = this.lastProof;
    const r = await fetch(this.o.baseUrl + this.o.resourcePath, { headers: { "x-payment": hdr(p) } });
    const body = await r.json().catch(() => ({}));
    const steps: Step[] = [{ step: "same proof again", ok: r.status === 200, detail: { status: r.status, note: "stored response returned, no second charge" } }];
    const ch = await this.challenge().catch(() => null);
    steps.push(await this.forcedPay(ch?.merchant ?? "", p.requestId, 1000n, "re-use requestId on-chain"));
    return { steps, data: body };
  }

  /** Asks the contract (eth_call, no transaction, no gas) to pay a merchant the owner never allowlisted. */
  async unauthorizedMerchant(): Promise<{ steps: Step[] }> {
    const stranger = Wallet.createRandom().address;
    try {
      await this.vault().pay.staticCall(this.o.owner, stranger, "0x" + "ab".repeat(32), 1000n);
      return { steps: [{ step: "simulated pay to an unlisted merchant", ok: true, detail: "unexpectedly allowed" }] };
    } catch (e) {
      const d = decodeRevert(e);
      return { steps: [{ step: "simulated pay to an unlisted merchant (eth_call, no transaction)", ok: false, detail: { ...d, simulated: true, merchant: stranger } }] };
    }
  }

  private async forcedPay(merchant: string, requestId: string, amount: bigint, label: string): Promise<Step> {
    const v = this.vault();
    try {
      await v.pay.staticCall(this.o.owner, merchant, requestId, amount);
    } catch (e) {
      const d = decodeRevert(e);
      try {
        const tx = await v.pay(this.o.owner, merchant, requestId, amount, { gasLimit: 300000 });
        const rc = await tx.wait().catch(() => null);
        return { step: label, ok: false, txHash: tx.hash, detail: { ...d, onChainStatus: rc?.status ?? 0 } };
      } catch { return { step: label, ok: false, detail: d }; }
    }
    return { step: label, ok: true, detail: "unexpectedly allowed" };
  }
}
