import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/ui/reveal";
import { CodeBlock } from "@/components/ui/code-block";
import { Address } from "@/components/ui/address";
import { CtaBand, HeroVisual, HowItWorks, SectionHeader, SpendingControls, WorkflowTimeline } from "@/components/marketing";
import { config } from "@/lib/config";
import { INTEGRATION_SNIPPET } from "@/data/snippets";

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="grid-bg absolute inset-x-0 top-0 -z-10 h-[640px]" aria-hidden />
        <div className="container pb-8 pt-16 text-center sm:pt-24">
          <Reveal>
            <span className="eyebrow"><span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />Live on QIE Mainnet · unaudited · small amounts only</span>
          </Reveal>
          <Reveal delay={0.05}>
            <h1 className="h-display mx-auto mt-7 max-w-4xl">
              Let agents pay for APIs.
              <span className="block text-muted-foreground">Within limits you set.</span>
            </h1>
          </Reveal>
          <Reveal delay={0.1}>
            <p className="lead mx-auto mt-6 max-w-2xl">
              Turnpike lets any API charge per request in QUSDC. The payer&apos;s spending limits are enforced by the settlement contract itself, and each paid response is delivered exactly once, even if the gateway crashes.
            </p>
          </Reveal>
          <Reveal delay={0.15}>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg"><Link href="/app">Launch app<ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>
              <Button asChild size="lg" variant="secondary"><Link href="/playground">Explore playground</Link></Button>
            </div>
          </Reveal>
          <Reveal delay={0.2}><HeroVisual /></Reveal>
        </div>
      </section>

      <HowItWorks />
      <SpendingControls />
      <WorkflowTimeline />

      <section className="container py-12">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <SectionHeader eyebrow="QUSDC on QIE" title="Settled on QIE Mainnet, in a 6-decimal stablecoin."
              lead="Payments are QUSDC transfers on chain 1990. One QUSDC is 1,000,000 base units, so a 0.001 QUSDC call is 1,000." />
            <ul className="mt-6 space-y-3 text-[15px]">
              {[
                "Observed block time is about 3.6 s with receipt delays of 3 to 6 s. Turnpike shows a pending state and makes no latency promise.",
                "Gas is paid in QIE. Payment cost is measured, not assumed to be cheap.",
                "QUSDC has a role-controlled mint and burn. No pause or blacklist code was found in its verified source.",
              ].map((t) => (
                <li key={t} className="flex gap-3"><Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden /><span className="text-muted-foreground">{t}</span></li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <Card className="p-6">
              <dl className="space-y-4 text-sm">
                <div><dt className="text-muted-foreground">Network</dt><dd className="mt-1 font-medium">QIE Mainnet, chain ID {config.chainId}</dd></div>
                <div><dt className="text-muted-foreground">Allowance contract (source verified on the explorer)</dt><dd className="mt-1"><Address value={config.allowance} full /></dd></div>
                <div><dt className="text-muted-foreground">QUSDC token</dt><dd className="mt-1"><Address value={config.qusdc} full /></dd></div>
              </dl>
            </Card>
          </Reveal>
        </div>
      </section>

      <section className="container py-24">
        <div className="grid items-center gap-10 lg:grid-cols-[1fr_1.15fr] [&>*]:min-w-0">
          <Reveal>
            <SectionHeader eyebrow="For API sellers" title="Two lines of middleware." lead="Mount the Express middleware on a route and give each path a price. Unpaid requests get a 402 challenge, paid requests are verified against the chain. The package is in the repository; it is not published to npm yet." />
            <Button asChild variant="secondary" className="mt-6"><Link href="/developers">Read the developer guide<ArrowRight className="h-4 w-4" aria-hidden /></Link></Button>
          </Reveal>
          <Reveal delay={0.1}><CodeBlock title="server.ts" code={INTEGRATION_SNIPPET} /></Reveal>
        </div>
      </section>

      <section className="border-y bg-muted/40 py-24">
        <div className="container">
          <Reveal><SectionHeader eyebrow="Security and trust" title="Honest about what is and is not guaranteed." lead="The contract has no admin, upgrade or rescue function, and the owner can always withdraw. It is also unaudited, and the gateway is centralised." /></Reveal>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ["What the contract enforces", "Per-call and daily caps, merchant allowlist, revoke, pause, single-use request IDs, and owner-only withdrawals."],
              ["What it does not", "It cannot prove a resource was delivered. There is no refund for a payment that lands before a failed delivery."],
              ["Disclosed assumptions", "Unaudited contract with a 5 QUSDC deposit cap, a QUSDC issuer with mint and burn, a centralised gateway, and untested chain finality."],
            ].map(([t, d], k) => (
              <Reveal key={t} delay={k * 0.07}><Card className="h-full p-6"><h3 className="font-semibold tracking-tight">{t}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p></Card></Reveal>
            ))}
          </div>
          <Button asChild variant="secondary" className="mt-8"><Link href="/security">Read the security notes</Link></Button>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
