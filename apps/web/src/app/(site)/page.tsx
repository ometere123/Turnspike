import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CodeBlock } from "@/components/ui/code-block";
import { Address } from "@/components/ui/address";
import { HeroVisual } from "@/components/hero-visual";
import { CtaBand, HowItWorks, SectionHeader, SpendingControls, WorkflowTimeline } from "@/components/marketing";
import { config } from "@/lib/config";
import { CLIENT_SNIPPET, INTEGRATION_SNIPPET } from "@/data/snippets";

export default function Home() {
  return (
    <>
      {/* Hero: the claim on the left, the live gate on the right. */}
      <section className="border-b">
        <div className="container grid gap-14 pb-16 pt-12 sm:pt-16 lg:grid-cols-[1.1fr_1fr] lg:items-end lg:gap-16 lg:pb-20 lg:pt-20 [&>*]:min-w-0">
          <div>
            <p className="kicker flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-success" aria-hidden />Running on QIE Mainnet. Unaudited, small amounts only.</p>
            <h1 className="h-display mt-6">Agents pay at the gate. Owners set the toll.</h1>
            <p className="lead mt-6">
              Turnspike lets any API charge per request in QUSDC. The payer&apos;s spending limits are enforced by the settlement contract itself, and each paid response is stored before it is sent, so a crash or outage never loses a payment.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg"><Link href="/playground">Run the live demo</Link></Button>
              <Button asChild size="lg" variant="secondary"><Link href="/developers">Read the developer guide</Link></Button>
            </div>
          </div>
          <HeroVisual />
        </div>
      </section>

      <WorkflowTimeline />
      <SpendingControls />
      <HowItWorks />

      {/* Two builder lanes. */}
      <section className="border-t">
        <div className="container grid gap-16 py-24 lg:grid-cols-2 [&>*]:min-w-0">
          <div id="sellers">
            <p className="kicker">For API providers</p>
            <h2 className="h-section mt-3">Put a price on a route.</h2>
            <p className="lead mt-4">Mount the middleware and name a price per path. Unpaid requests get a 402 quote; paid ones are checked against the chain, stored, then served. Invalid input is refused before any price is quoted.</p>
            <div className="mt-8"><CodeBlock title="server.ts" code={INTEGRATION_SNIPPET} /></div>
            <Link className="link mt-5 inline-block text-[15px]" href="/developers#integrate">Provider guide</Link>
          </div>
          <div id="agents">
            <p className="kicker">For agent builders</p>
            <h2 className="h-section mt-3">Pay only who you trust.</h2>
            <p className="lead mt-4">The client SDK pays a 402 only when the origin and merchant are on your list, the price is under your ceiling, and the owner&apos;s on-chain limits allow it. It checks gas first, journals every step, and never pays twice after a crash.</p>
            <div className="mt-8"><CodeBlock title="agent.ts" code={CLIENT_SNIPPET} /></div>
            <Link className="link mt-5 inline-block text-[15px]" href="/developers#agents">Agent builder guide</Link>
          </div>
        </div>
      </section>

      {/* Settlement plate and the honest limits. */}
      <section className="border-t bg-card">
        <div className="container grid gap-14 py-24 lg:grid-cols-[1fr_1.2fr] [&>*]:min-w-0">
          <div>
            <SectionHeader title="Settled on QIE Mainnet, in QUSDC." lead="One QUSDC is 1,000,000 base units, so a 0.001 QUSDC call is 1,000. Gas is paid in QIE: one payment measured 92,159 gas, about 0.0001 QIE." />
            <dl className="mt-8 divide-y border-y text-[15px]">
              <div className="grid gap-1 py-4 sm:grid-cols-[160px_1fr]"><dt className="text-muted-foreground">Network</dt><dd className="num">QIE Mainnet, chain {config.chainId}</dd></div>
              <div className="grid gap-1 py-4 sm:grid-cols-[160px_1fr]"><dt className="text-muted-foreground">Settlement contract</dt><dd className="min-w-0"><Address value={config.allowance} full /></dd></div>
              <div className="grid gap-1 py-4 sm:grid-cols-[160px_1fr]"><dt className="text-muted-foreground">QUSDC token</dt><dd className="min-w-0"><Address value={config.qusdc} full /></dd></div>
            </dl>
          </div>
          <div>
            <SectionHeader title="What it does not promise." />
            <ul className="mt-8 space-y-6 text-[15px] leading-relaxed">
              {[
                ["No proof of delivery on chain.", "The contract cannot see whether the API answered. A payment that lands before a failed delivery is not refunded; the SDK and the gateway recover it instead."],
                ["Not audited.", "The contract has a 5 QUSDC deposit cap, the QUSDC issuer has mint and burn roles, and the gateway is run by the project."],
                ["Finality is measured, not proven.", "Blocks arrive about every 3.6 s and the gateway waits for 2 confirmations. No reorg was seen in the blocks observed; that is not a guarantee."],
              ].map(([t, d]) => (
                <li key={t} className="border-l-[3px] border-primary pl-5"><p className="font-semibold">{t}</p><p className="mt-1 text-muted-foreground">{d}</p></li>
              ))}
            </ul>
            <Link className="link mt-8 inline-block text-[15px]" href="/security">Read the security notes</Link>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
