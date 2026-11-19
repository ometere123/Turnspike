"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const FLOW = [
  { n: "1", who: "Agent", what: "GET /v1/block-summary", out: "HTTP 402 payment_required", code: '{ "protocol": "turnspike/1",\n  "requestId": "0x…",\n  "sig": "e8c1…230d",\n  "priceBase": "1000",\n  "chainId": 1990 }' },
  { n: "2", who: "Agent", what: "pay(owner, merchant, requestId, amount)", out: "Allowance contract checks limits", code: "checks: not paused, caller is the agent,\nmerchant allowed, amount <= per-call cap,\ndaily cap, requestId unused, balance" },
  { n: "3", who: "Contract", what: "Transfers QUSDC to the merchant", out: "Paid event emitted", code: "Paid(owner, agent, merchant,\n     requestId, amount)" },
  { n: "4", who: "Gateway", what: "Verifies the receipt on QIE", out: "Contract, chain, merchant, amount, confirmations", code: "state: ISSUED → PAID_PENDING\n       → PAID_CONFIRMED → DELIVERED" },
  { n: "5", who: "Gateway", what: "Stores the response, then sends it", out: "HTTP 200, same proof returns the stored copy", code: "X-Payment: base64({ requestId,\n  txHash, sig })" },
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

