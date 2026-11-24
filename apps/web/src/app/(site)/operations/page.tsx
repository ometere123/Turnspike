import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { OperationsCenter } from "@/components/operations/operations-center";

export const metadata: Metadata = {
  title: "Operations",
  description: "Inspect a real QIE Turnspike payment, check the public gateway's delivery record, and diagnose service status without connecting a wallet.",
};

export default function OperationsPage() {
  return (
    <>
      <PageHero eyebrow="Operations center" title="Follow a payment from chain to delivery."
        lead="Check any Turnspike payment. No wallet needed." />
      <div className="container space-y-12 py-12 sm:py-16">
        <OperationsCenter />
        <p className="text-sm text-muted-foreground">Unaudited, with a centralised gateway. <Link href="/security" className="link">Security notes</Link> · <Link href="/developers" className="link">Integration guide</Link></p>
      </div>
    </>
  );
}
