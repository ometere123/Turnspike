import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { CtaBand, SectionHeader, WorkflowTimeline } from "@/components/marketing";
import { Tariff } from "@/components/content/board";

export const metadata: Metadata = {
  title: "Product",
  description: "How the agent, allowance contract, QUSDC settlement, API gateway and resource delivery fit together in Turnspike.",
};

const NODES: [string, string, string][] = [
  ["Owner", "Wallet", "Funds the account, sets the agent, caps, merchants. Can pause, revoke and withdraw at any time."],
  ["Agent", "Key", "Holds a key that can only call pay. No authority over policy or funds."],
  ["Allowance contract", "On-chain", "Holds owner balances, enforces limits, consumes request IDs, emits Paid. No admin, no upgrade."],
  ["Merchant", "Address", "The address that receives QUSDC for the API. The owner allowlists it."],
  ["Gateway", "Off-chain", "Issues signed challenges, verifies receipts, persists responses for replay. Never holds funds or signs settlement transactions."],
  ["Gateway database", "Off-chain", "SQLite on a persistent volume. Every payment state transition is recorded and survives restarts."],
];

const GUARANTEES: [string, string][] = [
  ["Idempotent replay", "Presenting the same proof again returns the stored response for the same resource. A different resource is refused with 403."],
  ["Crash recovery", "A failed handler can execute again after its delivery lease expires. The same payment proof can recover a completed response. There is no automatic refund if delivery cannot be recovered."],
  ["Pending, not promised", "If the receipt is missing or under-confirmed, the gateway answers 202 pending. Turnspike makes no latency promise."],
  ["Known limit", "There is no refund if payment lands and delivery never succeeds. Such payments are listed as paid but undelivered."],
];

const BOXES: [number, number, string, string][] = [
  [20, 110, "Agent", "key only calls pay"],
  [250, 110, "Allowance contract", "limits, single use"],
  [490, 30, "Merchant", "receives QUSDC"],
  [490, 200, "QIE RPC", "receipts and logs"],
  [700, 110, "Gateway", "verify, store, deliver"],
];

export default function ProductPage() {
  return (
    <>
      <PageHero eyebrow="Product" title="One contract holds the rules. One gateway handles delivery."
        lead="Turnspike separates what must be trusted to the chain (limits, settlement, single use) from what a seller needs off-chain (challenges, verification, durable delivery)." />

      <section className="container py-14 sm:py-20">
        <SectionHeader eyebrow="The system" title="Who does what" />
        <div className="mt-8">
          <Tariff caption="Parties in the Turnspike system" head={["Party", "Lives in", "Role"]}
            colClass={["w-48 font-semibold", "w-32 whitespace-nowrap", ""]}
            rows={NODES.map(([t, w, d]) => [t, w, d])} />
        </div>
      </section>

      <section className="border-y bg-muted py-14 sm:py-20">
        <div className="container">
          <SectionHeader eyebrow="Settlement path" title="Where the money and the proof travel" lead="Funds move once, on-chain, from the owner's allowance to the merchant. The gateway only reads the result." />
          <div tabIndex={0} role="region" aria-label="Settlement path diagram" className="mt-8 overflow-x-auto rounded-2xl border bg-card p-4 sm:p-6">
            <svg viewBox="0 0 880 300" role="img" aria-label="Diagram: the agent calls pay on the allowance contract, which transfers QUSDC to the merchant and emits Paid. The gateway reads the receipt from the QIE RPC and delivers the resource to the agent." className="min-w-[720px]">
              <defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="hsl(var(--foreground))" /></marker></defs>
              {BOXES.map(([x, y, t, s]) => (
                <g key={t}>
                  <rect x={x} y={y} width="170" height="76" rx="6" fill="hsl(var(--card))" stroke="hsl(var(--foreground))" strokeWidth="1.5" />
                  <text x={x + 85} y={y + 33} textAnchor="middle" fontSize="15" fontWeight="650" fill="hsl(var(--foreground))">{t}</text>
                  <text x={x + 85} y={y + 54} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">{s}</text>
                </g>
              ))}
              {["M190 148H250", "M420 135L490 75", "M420 160L490 225", "M660 235L760 190"].map((d) => (
                <path key={d} d={d} stroke="hsl(var(--foreground))" strokeWidth="1.6" fill="none" markerEnd="url(#ar)" />
              ))}
              <path d="M700 160C560 270 300 270 160 190" stroke="hsl(var(--route))" strokeWidth="2" strokeDasharray="10 7" fill="none" markerEnd="url(#ar)" />
              <text x="440" y="285" textAnchor="middle" fontSize="12" fill="hsl(var(--route))">HTTP 200 with the resource (after verification)</text>
              <text x="220" y="140" textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">pay</text>
            </svg>
          </div>
        </div>
      </section>

      <WorkflowTimeline />

      <section className="container pb-14 sm:pb-20">
        <SectionHeader eyebrow="Delivery guarantees" title="One payment, repeatable retrieval." />
        <dl className="mt-8 grid border-t-2 border-foreground md:grid-cols-2">
          {GUARANTEES.map(([t, d], k) => (
            <div key={t} className={`border-b py-5 md:px-6 ${k % 2 === 0 ? "md:border-r md:pl-0" : "md:pr-0"}`}>
              <dt className="h-card">{t}</dt>
              <dd className="mt-1.5 max-w-[60ch] text-[15px] leading-relaxed text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
      <CtaBand />
    </>
  );
}
