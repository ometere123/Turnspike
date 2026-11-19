import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { LiveStats } from "@/components/evidence-live";
import { SectionHeader } from "@/components/marketing";
import { Address } from "@/components/ui/address";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { config, deploymentEvidence, repoFile } from "@/lib/config";
import { DEMO_RUN, DEPLOY_TX, LIVE_DEMO, LIVE_DEMO_V2, NOT_YET, SDK_RUN, SMOKE, TESTS, type EvidenceTx } from "@/data/evidence";

export const metadata: Metadata = {
  title: "Evidence",
  description: "The deployed contract, verified source and every recorded mainnet transaction, with the tests that were actually run.",
};

function TxTable({ rows }: { rows: EvidenceTx[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border bg-card shadow-soft">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Step</th><th className="p-3">Outcome</th><th className="p-3">Transaction</th><th className="p-3">Source file</th></tr></thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.hash + r.label}>
              <td className="p-3"><span className="font-medium">{r.label}</span>{r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}</td>
              <td className="p-3"><Badge tone={r.outcome === "success" ? "success" : "danger"}>{r.outcome === "success" ? "Succeeded" : "Refused (reverted)"}</Badge></td>
              <td className="p-3"><Address value={r.hash} kind="tx" /></td>
              <td className="p-3"><a className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={repoFile(r.source)} target="_blank" rel="noreferrer">{r.source.replace("evidence/", "")}<ExternalLink className="h-3 w-3" aria-hidden /></a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EvidencePage() {
  return (
    <>
      <PageHero eyebrow="Mainnet evidence" title="Everything here can be checked on the explorer."
        lead="Hashes below come from files saved in the repository's evidence folder. Refused transactions are real reverted transactions, shown because the refusal is the point." />
      <div className="container space-y-16 py-16">
        <section>
          <SectionHeader title="Deployed contract" />
          <Card className="mt-6 p-6">
            <dl className="grid gap-5 text-sm md:grid-cols-2">
              <div><dt className="text-muted-foreground">TurnpikeAllowance, QIE Mainnet (chain {config.chainId})</dt><dd className="mt-1"><Address value={config.allowance} full /></dd></div>
              <div><dt className="text-muted-foreground">Verified source on the explorer</dt><dd className="mt-1"><a className="inline-flex items-center gap-1.5 text-accent hover:underline" href={`${config.explorer}/address/${config.allowance}#code`} target="_blank" rel="noreferrer">Open contract code<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a></dd></div>
              <div><dt className="text-muted-foreground">Deployment block</dt><dd className="mt-1 font-mono">{deploymentEvidence.block.toLocaleString("en-US")}</dd></div>
              <div><dt className="text-muted-foreground">Deposit cap per account</dt><dd className="mt-1">5 QUSDC ({deploymentEvidence.depositCapBaseUnits.toLocaleString("en-US")} base units)</dd></div>
              <div><dt className="text-muted-foreground">QUSDC token</dt><dd className="mt-1"><Address value={config.qusdc} full /></dd></div>
              <div><dt className="text-muted-foreground">Demo merchant</dt><dd className="mt-1"><Address value={config.merchant} full /></dd></div>
            </dl>
            <p className="mt-5 text-xs text-muted-foreground">The explorer reports the source as verified. Its optimizer field reads &quot;false&quot; although the project compiled with the optimizer on; verification passed regardless and the difference is unexplained.</p>
          </Card>
        </section>

        <section className="space-y-5">
          <SectionHeader title="Deployment and smoke test" lead="Seven transactions run immediately after deployment: the happy path plus the two refusals." />
          <TxTable rows={[DEPLOY_TX, ...SMOKE]} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Full demo sequence on mainnet" lead="Allowed, over-cap, replay, revoke, restore and withdraw, driven through the real gateway and middleware." />
          <TxTable rows={DEMO_RUN} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Hosted gateway runs" lead="Run through the public gateway after it was deployed, including a purchase made with the agent SDK." />
          <TxTable rows={[...SDK_RUN, ...LIVE_DEMO_V2, ...LIVE_DEMO]} />
        </section>

        <section className="space-y-5">
          <SectionHeader title="Tests that were actually run" lead="Outputs are saved in the repository." />
          <ul className="divide-y rounded-2xl border bg-card shadow-soft">
            {TESTS.map((t) => (
              <li key={t.name} className="flex flex-wrap items-start justify-between gap-3 p-4 text-sm">
                <div><p className="font-medium">{t.name}</p><p className="text-muted-foreground">{t.result}</p></div>
                <a className="inline-flex items-center gap-1 font-mono text-xs text-accent hover:underline" href={repoFile(t.file)} target="_blank" rel="noreferrer">{t.file.replace("evidence/", "")}<ExternalLink className="h-3 w-3" aria-hidden /></a>
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
          <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">{NOT_YET.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      </div>
    </>
  );
}
