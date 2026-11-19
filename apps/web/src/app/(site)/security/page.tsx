import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { CtaBand, SectionHeader } from "@/components/marketing";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { config, repoFile } from "@/lib/config";

export const metadata: Metadata = {
  title: "Security",
  description: "What the Turnpike contract enforces on-chain, what it does not, and the trust assumptions we disclose. Unaudited.",
};

const ENFORCED: [string, string][] = [
  ["On-chain spending enforcement", "pay checks, in order: not paused, caller is the account's agent, merchant allowed, amount within the per-call cap, daily cap, request unused, balance. State changes before the transfer; the function is non-reentrant."],
  ["Per-call and daily limits", "Both are set by the owner and enforced inside the debiting transaction. Daily limits use fixed UTC days (block time / 86400), so up to 2x the daily limit can pass in a short window across midnight UTC. The per-call cap and balance still bound it."],
  ["Merchant allowlist", "Payments to an address the owner has not allowed revert with MerchantNotAllowed."],
  ["Agent revocation", "revokeAgent clears the agent. The agent address can never call policy, allowlist, pause, revoke or withdraw for someone else's account; those functions only act on the caller's own account."],
  ["Pausing", "setPaused blocks pay for that account. It never blocks withdrawals."],
  ["Replay prevention", "(merchant, requestId) is marked used when paid and can never be unset. The gateway also keeps one row per request ID and a unique transaction hash."],
  ["Owner-controlled withdrawals", "The owner can withdraw unspent balance at any time. The contract has no admin, owner-of-contract, upgrade or token-rescue function."],
];

const LIMITS: [string, string][] = [
  ["Unaudited", "The contract has not been audited. A per-account deposit cap (5 QUSDC) limits exposure. Do not deposit more than you can lose."],
  ["QUSDC issuer powers", "QUSDC's verified source gives a VAULT_ROLE mint and burn. Its bytecode has no pause, blacklist or upgrade selectors and it is not a proxy; we have not checked who holds the roles."],
  ["Centralised gateway", "The gateway is one service. If it is down, paid APIs cannot deliver. It never holds funds and never signs transactions."],
  ["Delivery is not provable on-chain", "The contract cannot verify that a resource was delivered. There is no refund if payment lands and delivery then fails; those rows are listed as paid but undelivered."],
  ["Finality is untested", "No reorg was seen over 94 observed blocks, which does not establish finality. The gateway waits for a configurable number of confirmations (default 2)."],
  ["Failed-call gas", "Reverted calls on QIE were charged exactly half the gas limit in all 5 samples. We treat that as a hypothesis and set gas limits deliberately."],
  ["Scope of the demo", "The playground's scripted agent spends from a demo account whose limits are on-chain. Its key is a gateway secret, not part of this website."],
];

export default function SecurityPage() {
  return (
    <>
      <PageHero eyebrow="Security and trust" title="What is enforced, what is not, and what you must trust."
        lead="Turnpike has not been audited and we do not call it risk-free. This page lists exactly what the contract guarantees and the assumptions underneath." />
      <section className="container py-20">
        <Reveal><SectionHeader eyebrow="Enforced by the contract" title="Seven properties you can verify in the source." lead={<>Read <a className="underline" href={repoFile("contracts/TurnpikeAllowance.sol")} target="_blank" rel="noreferrer">TurnpikeAllowance.sol</a> and the tests in the repository. The deployed contract&apos;s source is verified on the <a className="underline" href={`${config.explorer}/address/${config.allowance}#code`} target="_blank" rel="noreferrer">QIE explorer</a>.</>} /></Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {ENFORCED.map(([t, d], k) => (
            <Reveal key={t} delay={(k % 2) * 0.05}><Card className="h-full p-6"><h3 className="font-semibold tracking-tight">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p></Card></Reveal>
          ))}
        </div>
      </section>
      <section className="border-y bg-muted/40 py-20">
        <div className="container">
          <Reveal><SectionHeader eyebrow="Limitations and trust assumptions" title="Read this before you deposit." /></Reveal>
          <ul className="mt-10 grid gap-4 md:grid-cols-2">
            {LIMITS.map(([t, d], k) => (
              <Reveal key={t} delay={(k % 2) * 0.05}><li className="h-full list-none rounded-2xl border bg-card p-6 shadow-soft"><h3 className="font-semibold tracking-tight">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p></li></Reveal>
            ))}
          </ul>
        </div>
      </section>
      <section className="container py-16">
        <Reveal>
          <h2 className="text-xl font-semibold tracking-tight">Secrets and privacy</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">This website holds no private keys and asks for none. Wallet actions are signed in your wallet. The gateway stores wallet addresses and payment state; it does not collect personal data beyond IP addresses used for rate limiting. Public chain data is public.</p>
        </Reveal>
      </section>
      <CtaBand title="Check it yourself." lead="Every claim here maps to the source, the explorer or a recorded mainnet transaction." />
    </>
  );
}
