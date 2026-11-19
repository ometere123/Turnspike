import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { CtaBand } from "@/components/marketing";
import { config } from "@/lib/config";

export const metadata: Metadata = {
  title: "About",
  description: "Why Turnspike exists and how it fits QIE Hackathon 3.0.",
};

const ROWS: [string, string][] = [
  ["The problem", "API sellers cannot cheaply take per-request payments from software callers, and giving an agent a hot key with a full balance means one bug or prompt injection can drain it. This is the motivating scenario, not a measured market figure."],
  ["What Turnspike does", "An owner funds a bounded allowance and authorises one agent. The settlement contract enforces per-call and daily limits, an allowlist, single-use request IDs and owner-only withdrawals. A seller adds middleware and gets paid in QUSDC."],
  ["What it is not", "It does not invent agent spending limits, and it is not x402-compatible. It is unaudited, uses a centralised gateway, and runs on QIE Mainnet with deliberately small amounts."],
];

export default function AboutPage() {
  return (
    <>
      <PageHero eyebrow="About" title="Software agents need to pay. Owners need a ceiling." />
      <section className="container py-14 sm:py-20">
        <div className="max-w-4xl divide-y border-y-2 border-foreground">
          {ROWS.map(([t, d]) => (
            <div key={t} className="grid gap-x-10 gap-y-2 py-6 md:grid-cols-[14rem_1fr]">
              <h2 className="h-card">{t}</h2>
              <p className="max-w-[64ch] leading-relaxed text-muted-foreground">{d}</p>
            </div>
          ))}
        </div>
        <div className="mt-12 max-w-4xl rounded-2xl border bg-card p-6 sm:p-8">
          <h2 className="h-card">QIE Hackathon 3.0</h2>
          <p className="mt-2 max-w-[64ch] leading-relaxed text-muted-foreground">Turnspike is a submission to QIE Hackathon 3.0 (organised by QIE Blockchain). It uses QUSDC and the QIE Mainnet (chain <span className="num">{config.chainId}</span>). The code is open source under the MIT licence: <a className="link break-all" href={config.repoUrl} target="_blank" rel="noreferrer">{config.repoUrl.replace("https://", "")}</a>.</p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
