"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { ArrowRight, Ban, Coins, Gauge, PauseCircle, Repeat2, ShieldCheck, Store, Undo2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

export function SectionHeader({ eyebrow, title, lead, center = false }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-2xl", center && "mx-auto text-center")}>
      {eyebrow && <p className="mb-3 text-sm font-medium text-accent">{eyebrow}</p>}
      <h2 className="h-section">{title}</h2>
      {lead && <p className="lead mt-4">{lead}</p>}
    </div>
  );
}

/* ----------------------------------------------------------------- hero visual */

const FLOW = [
  { n: "1", who: "Agent", what: "GET /v1/block-summary", out: "HTTP 402 payment_required", code: '{ "error": "payment_required",\n  "requestId": "0x…",\n  "priceBase": "1000",\n  "chainId": 1990,\n  "expiresAt": 1795057556 }' },
  { n: "2", who: "Agent", what: "pay(owner, merchant, requestId, amount)", out: "Allowance contract checks limits", code: "checks: not paused, caller is the agent,\nmerchant allowed, amount <= per-call cap,\ndaily cap, requestId unused, balance" },
  { n: "3", who: "Contract", what: "Transfers QUSDC to the merchant", out: "Paid event emitted", code: "Paid(owner, agent, merchant,\n     requestId, amount)" },
  { n: "4", who: "Gateway", what: "Verifies the receipt on QIE", out: "Contract, chain, merchant, amount, confirmations", code: "state: ISSUED → PAID_PENDING\n       → PAID_CONFIRMED → DELIVERED" },
  { n: "5", who: "Gateway", what: "Delivers the resource once", out: "HTTP 200, same proof returns the stored response", code: "X-Payment: base64({ requestId,\n                    txHash })" },
] as const;

export function HeroVisual() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((x) => (x + 1) % FLOW.length), 2600);
    return () => clearInterval(t);
  }, [reduce]);
  const cur = FLOW[i];
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl">
      <div className="absolute -inset-x-6 -top-6 bottom-0 -z-10 rounded-[40px] bg-gradient-to-b from-accent/10 via-transparent to-transparent blur-2xl" aria-hidden />
      <Card className="overflow-hidden shadow-lift">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="ml-3 text-xs text-muted-foreground">Request lifecycle · illustrative flow, field names from the real protocol</span>
        </div>
        <div className="grid md:grid-cols-[1.05fr_1fr]">
          <ol className="divide-y" aria-label="Payment steps">
            {FLOW.map((s, k) => (
              <li key={s.n}>
                <button type="button" onClick={() => setI(k)} aria-current={k === i ? "step" : undefined}
                  className={cn("flex w-full items-start gap-3.5 px-5 py-4 text-left transition", k === i ? "bg-accent-soft" : "hover:bg-muted/60")}>
                  <span className={cn("mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", k === i ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground")}>{s.n}</span>
                  <span>
                    <span className="block text-[15px] font-medium">{s.what}</span>
                    <span className="block text-sm text-muted-foreground">{s.who} · {s.out}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <div className="border-t bg-muted/40 p-5 md:border-l md:border-t-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Step {cur.n} · {cur.who}</p>
            <pre className="mt-3 min-h-[9.5rem] overflow-x-auto whitespace-pre-wrap rounded-xl border bg-card p-4 font-mono text-[12.5px] leading-relaxed" aria-live="polite">{cur.code}</pre>
            <p className="mt-3 text-xs text-muted-foreground">Over-cap and replayed payments are refused by the contract with <code className="font-mono">CapExceeded</code> and <code className="font-mono">RequestAlreadyUsed</code>.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ----------------------------------------------------------------- how it works */

export function HowItWorks() {
  const steps = [
    { icon: Wallet, t: "Owner funds an allowance", d: "The owner deposits QUSDC into their own account on the contract and sets limits for one agent key. The agent never holds the funds." },
    { icon: Gauge, t: "Agent pays within limits", d: "On a 402 response the agent calls pay on the contract. The contract itself enforces the per-call cap, daily cap and merchant allowlist." },
    { icon: ShieldCheck, t: "Gateway verifies, then delivers", d: "The gateway checks the on-chain receipt, binds the payment to one resource and price, and delivers exactly once. A retry returns the stored response." },
  ];
  return (
    <section className="container py-24">
      <Reveal><SectionHeader eyebrow="How it works" title="Three parties, one rule: the contract decides." lead="Sellers add middleware. Owners set limits. Agents can only pay, and only inside those limits." /></Reveal>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {steps.map((s, k) => (
          <Reveal key={s.t} delay={k * 0.08}>
            <Card className="h-full p-6">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent"><s.icon className="h-5 w-5" aria-hidden /></span>
              <h3 className="mt-5 text-lg font-semibold tracking-tight">{s.t}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{s.d}</p>
            </Card>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- spending controls */

const CONTROLS = [
  { icon: Coins, t: "Per-call cap", d: "A single payment above the cap reverts with CapExceeded. Set by the owner, enforced on-chain.", span: "md:col-span-2" },
  { icon: Gauge, t: "Daily cap", d: "Spend is tracked per UTC day inside the same transaction that debits. Fixed daily buckets mean up to 2x can pass across midnight UTC; this is documented.", span: "" },
  { icon: Store, t: "Merchant allowlist", d: "pay to an address the owner has not allowed reverts with MerchantNotAllowed.", span: "" },
  { icon: Undo2, t: "Instant revoke", d: "revokeAgent clears the agent. The next pay reverts with NotOwnerAgent.", span: "" },
  { icon: PauseCircle, t: "Owner pause", d: "Pausing blocks pay for that account. Withdrawals keep working.", span: "" },
  { icon: Repeat2, t: "Replay prevention", d: "Each (merchant, requestId) pair can be consumed once, forever. There is no way to un-use it.", span: "md:col-span-2" },
  { icon: Ban, t: "Owner-controlled withdrawals", d: "The owner can withdraw unspent balance at any time. There is no admin key, no upgrade path and no rescue function in the contract.", span: "md:col-span-3" },
];

export function SpendingControls() {
  return (
    <section className="border-y bg-muted/40 py-24">
      <div className="container">
        <Reveal><SectionHeader eyebrow="Spending controls" title="Limits that hold even if the agent is compromised." lead="Policy lives in the settlement contract, not in the agent or the gateway. A compromised agent can only spend what the owner already allowed." /></Reveal>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {CONTROLS.map((c, k) => (
            <Reveal key={c.t} delay={(k % 3) * 0.06} className={c.span}>
              <Card className="h-full p-6">
                <c.icon className="h-5 w-5 text-accent" aria-hidden />
                <h3 className="mt-4 font-semibold tracking-tight">{c.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{c.d}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- workflow timeline */

export function WorkflowTimeline() {
  const rows = [
    ["Request", "Agent asks for a protected resource.", "GET /v1/block-summary"],
    ["402", "Gateway answers with a signed, expiring challenge bound to one resource and price.", "HTTP 402"],
    ["Pay", "Agent calls pay on the contract. Limits are checked on-chain.", "QUSDC transfer + Paid event"],
    ["Verify", "Gateway reads the receipt from QIE and waits for the configured confirmations.", "HTTP 202 while pending"],
    ["Deliver", "Resource is delivered once. The same proof returns the stored response.", "HTTP 200"],
    ["Refuse", "Over-cap or replayed payments revert on-chain; a proof for another resource is refused.", "CapExceeded · RequestAlreadyUsed · 403"],
  ];
  return (
    <section className="container py-24">
      <Reveal><SectionHeader eyebrow="Agent payment workflow" title="From request to resource, with the failure cases included." /></Reveal>
      <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border bg-border md:grid-cols-2 lg:grid-cols-3">
        {rows.map(([t, d, m], k) => (
          <li key={t} className="bg-card p-6">
            <span className="font-mono text-xs text-muted-foreground">0{k + 1}</span>
            <h3 className="mt-2 text-lg font-semibold tracking-tight">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
            <p className="mt-3 inline-block rounded-md bg-muted px-2 py-1 font-mono text-xs">{m}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ----------------------------------------------------------------- CTA */

export function CtaBand({ title = "See it work on mainnet.", lead = "Run the scripted agent against the live gateway, or fund your own allowance." }: { title?: string; lead?: string }) {
  return (
    <section className="container py-12">
      <div className="relative overflow-hidden rounded-3xl border bg-card px-6 py-16 text-center shadow-soft sm:px-12">
        <div className="grid-bg absolute inset-0 -z-0 opacity-70" aria-hidden />
        <div className="relative">
          <h2 className="h-section mx-auto max-w-xl">{title}</h2>
          <p className="lead mx-auto mt-3 max-w-lg">{lead}</p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg"><Link href="/app">Launch app<ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/playground">Explore playground</Link></Button>
          </div>
        </div>
      </div>
    </section>
  );
}
