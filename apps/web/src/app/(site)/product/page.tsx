import type { Metadata } from "next";
import { Bot, Database, Landmark, Server, Store, UserRound } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CtaBand, SectionHeader, WorkflowTimeline } from "@/components/marketing";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Product",
  description: "How the agent, allowance contract, QUSDC settlement, API gateway and resource delivery fit together in Turnpike.",
};

const NODES = [
  { icon: UserRound, t: "Owner", d: "Funds the account, sets the agent, caps, merchants. Can pause, revoke and withdraw at any time.", tag: "wallet" },
  { icon: Bot, t: "Agent", d: "Holds a key that can only call pay. No authority over policy or funds.", tag: "key" },
  { icon: Landmark, t: "Allowance contract", d: "Holds owner balances, enforces limits, consumes request IDs, emits Paid. No admin, no upgrade.", tag: "on-chain" },
  { icon: Store, t: "Merchant", d: "The address that receives QUSDC for the API. The owner allowlists it.", tag: "address" },
  { icon: Server, t: "Gateway", d: "Issues signed challenges, verifies receipts, delivers once. Never holds funds, never signs transactions.", tag: "off-chain" },
  { icon: Database, t: "Gateway database", d: "SQLite on a persistent volume. Every payment state transition is recorded and survives restarts.", tag: "off-chain" },
];

export default function ProductPage() {
  return (
    <>
      <PageHero eyebrow="Product" title="One contract holds the rules. One gateway handles delivery."
        lead="Turnpike separates what must be trusted to the chain (limits, settlement, single use) from what a seller needs off-chain (challenges, verification, exactly-once delivery)." />

      <section className="container py-20">
        <Reveal><SectionHeader eyebrow="The system" title="Who does what" /></Reveal>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {NODES.map((n, k) => (
            <Reveal key={n.t} delay={(k % 3) * 0.06}>
              <Card className="h-full p-6">
                <div className="flex items-center justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><n.icon className="h-5 w-5" aria-hidden /></span><span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{n.tag}</span></div>
                <h3 className="mt-5 font-semibold tracking-tight">{n.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{n.d}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-y bg-muted/40 py-20">
        <div className="container">
          <Reveal><SectionHeader eyebrow="Settlement path" title="Where the money and the proof travel" lead="Funds move once, on-chain, from the owner's allowance to the merchant. The gateway only reads the result." /></Reveal>
          <Reveal delay={0.1}>
            <Card className="mt-10 overflow-x-auto p-6">
              <svg viewBox="0 0 880 300" role="img" aria-label="Diagram: the agent calls pay on the allowance contract, which transfers QUSDC to the merchant and emits Paid. The gateway reads the receipt from the QIE RPC and delivers the resource to the agent." className="min-w-[720px]">
                <defs><marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="hsl(var(--muted-foreground))" /></marker></defs>
                {[
                  [20, 110, "Agent", "key only calls pay"],
                  [250, 110, "Allowance contract", "limits · single use"],
                  [490, 30, "Merchant", "receives QUSDC"],
                  [490, 200, "QIE RPC", "receipts and logs"],
                  [700, 110, "Gateway", "verify · deliver once"],
                ].map(([x, y, t, s]) => (
                  <g key={String(t)}>
                    <rect x={x as number} y={y as number} width="170" height="76" rx="14" fill="hsl(var(--card))" stroke="hsl(var(--border))" />
                    <text x={(x as number) + 85} y={(y as number) + 33} textAnchor="middle" fontSize="15" fontWeight="600" fill="hsl(var(--foreground))">{t}</text>
                    <text x={(x as number) + 85} y={(y as number) + 54} textAnchor="middle" fontSize="12" fill="hsl(var(--muted-foreground))">{s}</text>
                  </g>
                ))}
                {["M190 148H250", "M420 135L490 75", "M420 160L490 225", "M660 235L760 190"].map((d) => (
                  <path key={d} d={d} stroke="hsl(var(--muted-foreground))" strokeWidth="1.6" fill="none" markerEnd="url(#ar)" />
                ))}
                <path d="M700 160C560 270 300 270 160 190" stroke="hsl(var(--accent))" strokeWidth="1.6" strokeDasharray="5 5" fill="none" markerEnd="url(#ar)" />
                <text x="440" y="285" textAnchor="middle" fontSize="12" fill="hsl(var(--accent))">HTTP 200 with the resource (after verification)</text>
                <text x="220" y="140" textAnchor="middle" fontSize="11" fill="hsl(var(--muted-foreground))">pay</text>
              </svg>
            </Card>
          </Reveal>
        </div>
      </section>

      <WorkflowTimeline />

      <section className="container pb-8">
        <Reveal><SectionHeader eyebrow="Delivery guarantees" title="Paid once, delivered once." /></Reveal>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            ["Idempotent replay", "Presenting the same proof again returns the stored response for the same resource. A different resource is refused with 403."],
            ["Crash recovery", "If the gateway dies after verifying payment but before responding, the row stays PAID_CONFIRMED. The same proof delivers after restart, with no second charge."],
            ["Pending, not promised", "If the receipt is missing or under-confirmed, the gateway answers 202 pending. Turnpike makes no latency promise."],
            ["Known limit", "There is no refund if payment lands and delivery never succeeds. Such payments are listed as paid but undelivered."],
          ].map(([t, d], k) => (
            <Reveal key={t} delay={(k % 2) * 0.06}><Card className="h-full p-6"><h3 className="font-semibold tracking-tight">{t}</h3><p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p></Card></Reveal>
          ))}
        </div>
      </section>
      <CtaBand />
    </>
  );
}
