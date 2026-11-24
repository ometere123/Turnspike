import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { LiveStats } from "@/components/evidence-live";
import { SectionHeader } from "@/components/marketing";
import { Address } from "@/components/ui/address";
import { FileLink } from "@/components/content/board";
import { ReceiptRoll } from "@/components/content/receipt";
import { config, deploymentEvidence, repoFile } from "@/lib/config";
import { DEMO_RUN, DEPLOY_TX, OWNER_CYCLE, PLAYGROUND_RUN, LIVE_DEMO, LIVE_DEMO_V2, NOT_YET, SDK_RUN, SMOKE, TESTS } from "@/data/evidence";

export const metadata: Metadata = {
  title: "Evidence",
  description: "The deployed contract, verified source and every recorded mainnet transaction, with the tests that were actually run.",
};

export default function EvidencePage() {
  return (
    <>
      <PageHero eyebrow="Mainnet evidence" title="Everything here can be checked on the explorer."
        lead="Hashes below come from files saved in the repository's evidence folder. Refused transactions are real reverted transactions, shown because the refusal is the point." />
      <div className="container space-y-16 py-14 sm:py-16">
        <section>
          <SectionHeader title="Deployed contract" />
          <div className="mt-6 rounded-2xl border border-t-2 border-t-foreground bg-card">
            <dl className="grid text-sm md:grid-cols-2">
              {[
                [<>TurnpikeAllowance, QIE Mainnet (chain <span className="num">{config.chainId}</span>)</>, <Address key="a" value={config.allowance} full />],
                ["Verified source on the explorer", <a key="v" className="link" href={`${config.explorer}/address/${config.allowance}#code`} target="_blank" rel="noreferrer">Open contract code</a>],
                ["Deployment block", <span key="b" className="num font-mono">{deploymentEvidence.block.toLocaleString("en-US")}</span>],
                ["Deposit cap per account", <span key="c" className="num">5 QUSDC ({deploymentEvidence.depositCapBaseUnits.toLocaleString("en-US")} base units)</span>],
                ["QUSDC token", <Address key="q" value={config.qusdc} full />],
                ["Demo merchant", <Address key="m" value={config.merchant} full />],
              ].map(([t, v], i) => (
                <div key={i} className={`min-w-0 border-b px-5 py-4 sm:px-6 ${i % 2 === 0 ? "md:border-r" : ""}`}>
                  <dt className="text-muted-foreground">{t}</dt>
                  <dd className="mt-1 min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="px-5 py-4 text-[13px] text-muted-foreground sm:px-6">The deployed runtime is a coverage-instrumented, unoptimized build (9,610 bytes), not the clean optimized compile (3,570 bytes). The exact deployed runtime was reproduced from verified source in evidence M9; this is not an independent security audit or proof of exhaustive equivalence.</p>
          </div>
        </section>

        <section className="space-y-5">
          <SectionHeader title="Deployment and smoke test" lead="Seven transactions run immediately after deployment: the happy path plus the two refusals." />
          <ReceiptRoll label="Deployment and smoke test transactions" rows={[DEPLOY_TX, ...SMOKE]} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Full demo sequence on mainnet" lead="Allowed, over-cap, replay, revoke, restore and withdraw, driven through the real gateway and middleware." />
          <ReceiptRoll label="Full demo sequence transactions" rows={DEMO_RUN} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Hosted gateway runs" lead="Run through the public gateway after it was deployed, including a purchase made with the agent SDK." />
          <ReceiptRoll label="Hosted gateway transactions" rows={[...PLAYGROUND_RUN, ...SDK_RUN, ...LIVE_DEMO_V2, ...LIVE_DEMO]} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="A full owner cycle, 24 November 2026" lead="Every owner step signed in a browser wallet. Project-operated." />
          <ReceiptRoll label="Owner cycle transactions" rows={OWNER_CYCLE} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Tests that were actually run" lead="Outputs are saved in the repository." />
          <ul className="divide-y rounded-2xl border border-t-2 border-t-foreground bg-card">
            {TESTS.map((t) => (
              <li key={t.name} className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:px-6 md:grid-cols-[minmax(0,1fr)_16rem]">
                <div className="min-w-0"><p className="font-semibold">{t.name}</p><p className="mt-0.5 text-muted-foreground">{t.result}</p></div>
                <div className="min-w-0 md:text-right"><FileLink href={repoFile(t.file)}>{t.file.replace("evidence/", "")}</FileLink></div>
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-5">
          <SectionHeader title="Usage" lead="Live from the gateway database. No external adoption is claimed beyond what these counters show." />
          <LiveStats />
        </section>

        <section className="space-y-4">
          <SectionHeader title="Not yet verified" />
          <ul className="max-w-[72ch] space-y-3 border-l-2 border-foreground pl-5 text-[15px] leading-relaxed text-muted-foreground">{NOT_YET.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      </div>
    </>
  );
}
