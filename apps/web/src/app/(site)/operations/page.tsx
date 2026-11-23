import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { OperationsCenter } from "@/components/operations/operations-center";

export const metadata: Metadata = {
  title: "Operations | Turnspike",
  description: "Inspect a real QIE Turnspike payment, check the public gateway's delivery record, and diagnose service status without connecting a wallet.",
};

export default function OperationsPage() {
  return (
    <>
      <PageHero eyebrow="Operations center" title="Follow a payment from chain to delivery."
        lead="Inspect on-chain settlement and the gateway's delivery record as separate facts. No wallet connection, private key, payment, or demo scenario is required." />
      <div className="container space-y-12 py-12 sm:py-16">
        <OperationsCenter />
        <section className="grid gap-5 border-t pt-10 md:grid-cols-3">
          <div><h2 className="h-card">Settlement</h2><p className="mt-2 text-sm text-muted-foreground">A matching Paid event from the deployed vault is evidence that the contract emitted a payment event. It does not say whether an API response was delivered.</p></div>
          <div><h2 className="h-card">Delivery</h2><p className="mt-2 text-sm text-muted-foreground">The gateway reports its own SQLite delivery state. An offline or unknown gateway cannot prove a paid resource was or was not delivered.</p></div>
          <div><h2 className="h-card">Recovery</h2><p className="mt-2 text-sm text-muted-foreground">If the payment settled but delivery is pending, retry with the original payment proof or resume through the client SDK. Never create a second purchase to recover a known payment.</p></div>
        </section>
        <p className="text-sm text-muted-foreground">Turnspike is unaudited and uses a centralized gateway. Read the <Link href="/security" className="link">security limitations</Link> and <Link href="/developers" className="link">integration guide</Link>. Payment status is not a refund guarantee.</p>
      </div>
    </>
  );
}
