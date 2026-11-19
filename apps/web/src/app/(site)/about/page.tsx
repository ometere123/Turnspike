import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { CtaBand } from "@/components/marketing";
import { Card } from "@/components/ui/card";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "About",
  description: "Why Turnspike exists and how it fits QIE Hackathon 3.0.",
};

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About" title="Software agents need to pay. Owners need a ceiling." />
      <section className="container grid gap-4 py-16 md:grid-cols-3">
        {[
          ["The problem", "API sellers cannot cheaply take per-request payments from software callers, and giving an agent a hot key with a full balance means one bug or prompt injection can drain it. This is the motivating scenario, not a measured market figure."],
          ["What Turnspike does", "An owner funds a bounded allowance and authorises one agent. The settlement contract enforces per-call and daily limits, an allowlist, single-use request IDs and owner-only withdrawals. A seller adds middleware and gets paid in QUSDC."],
          ["What it is not", "It does not invent agent spending limits, and it is not x402-compatible. It is unaudited, uses a centralised gateway, and runs on QIE Mainnet with deliberately small amounts."],
        ].map(([t, d]) => <Card key={t} className="p-6"><h2 className="font-semibold tracking-tight">{t}</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{d}</p></Card>)}
      </section>
      <section className="container pb-12">
        <Card className="p-6 text-sm leading-relaxed text-muted-foreground">
          <h2 className="font-semibold tracking-tight text-foreground">QIE Hackathon 3.0</h2>
          <p className="mt-2">Turnspike is a submission to QIE Hackathon 3.0 (organised by QIE Blockchain). It uses QUSDC and the QIE Mainnet (chain {config.chainId}). The code is open source under the MIT licence: <a className="text-accent underline" href={config.repoUrl} target="_blank" rel="noreferrer">{config.repoUrl.replace("https://", "")}</a>.</p>
        </Card>
      </section>
      <CtaBand />
    </>
  );
}
