"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, CircleHelp, RefreshCw, Search, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Field } from "@/components/ui/input";
import { Address } from "@/components/ui/address";
import { config } from "@/lib/config";
import { assessHealth, correlate, isRequestId, lookupDelivery, stateMeaning, stateTone, type DeliveryRecord, type HealthView, type Tone } from "@/lib/delivery";
import { gateway } from "@/lib/gateway";
import { cn, fmtUsdc } from "@/lib/utils";
import { inspectTransaction, isTransactionHash, SETTLED_CONFIRMATIONS, STALE_HEAD_SECONDS, type ChainInspection } from "@/lib/receipt-inspector";

// Historical project-operated QIE Mainnet SDK purchase (19 November 2026), recorded in evidence/M8_sdk_mainnet.md.
const REFERENCE_TX = "0x7e41ccaa46724c9ca943b6f9580b6a71a9090d80affdca0df36d3bbc809621b7";

const EDGE: Record<Tone, string> = { neutral: "border-border", success: "border-success", warn: "border-warn", danger: "border-danger" };
const TONE_WORD: Record<Tone, string> = { neutral: "Note", success: "Records agree", warn: "Not settled between the two", danger: "Mismatch" };

function verdict(tx: ChainInspection): { tone: Tone; label: string } {
  switch (tx.kind) {
    case "paid":
      return !tx.settled ? { tone: "warn", label: "Paid event found, still settling" }
        : tx.headAgeSeconds > STALE_HEAD_SECONDS ? { tone: "warn", label: "Paid event found, RPC is behind" }
        : { tone: "success", label: "Paid event found" };
    case "reverted": return { tone: "danger", label: "Reverted" };
    case "pending": return { tone: "warn", label: "Pending" };
    case "uncertain": return { tone: "warn", label: "Uncertain" };
    case "not_found": return { tone: "neutral", label: "Not found" };
    case "not_turnspike": return { tone: "neutral", label: "No Turnspike Paid event" };
  }
}

function explanation(tx: Exclude<ChainInspection, { kind: "paid" }>): string {
  switch (tx.kind) {
    case "not_found": return "This RPC has no receipt and no pending transaction for that hash. It may be unknown, dropped, or on another chain.";
    case "pending": return "This RPC knows the transaction but it has not been mined. Nothing has settled yet; check again before acting on it.";
    case "reverted": return "The transaction reverted. It did not make a Turnspike payment, although gas may have been consumed.";
    case "not_turnspike": return "This transaction succeeded but did not contain a Paid event from the configured Turnspike vault.";
    case "uncertain": return tx.reason;
  }
}

/** Cancels the previous request of one kind and ignores anything it still returns. */
function useLatest() {
  const current = useRef<AbortController | null>(null);
  const cancel = useCallback(() => { current.current?.abort(); current.current = null; }, []);
  const begin = useCallback(() => { cancel(); const c = new AbortController(); current.current = c; return c; }, [cancel]);
  const isCurrent = useCallback((c: AbortController) => current.current === c && !c.signal.aborted, []);
  useEffect(() => cancel, [cancel]);
  return { begin, cancel, isCurrent };
}

const message = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function OperationsCenter() {
  // Until the page is interactive a native submit would reload it and lose the input, so the controls wait.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const [health, setHealth] = useState<HealthView | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const [hash, setHash] = useState("");
  const [hashError, setHashError] = useState<string | null>(null);
  const [tx, setTx] = useState<ChainInspection | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const [requestId, setRequestId] = useState("");
  const [idError, setIdError] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const chainRead = useLatest();
  const gatewayRead = useLatest();

  const refresh = useCallback(async () => {
    setHealthLoading(true);
    const [h, c, s] = await Promise.all([gateway.health(), gateway.config(), gateway.stats()]);
    setHealth(assessHealth(h, c, s));
    setCheckedAt(new Date().toLocaleTimeString());
    setHealthLoading(false);
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // A result always belongs to the value in the field beside it: editing a field discards its answer and any request in flight.
  const clearDelivery = () => { gatewayRead.cancel(); setDelivery(null); setDeliveryError(null); setIdError(null); setDeliveryLoading(false); };
  const clearTx = () => { chainRead.cancel(); setTx(null); setTxError(null); setHashError(null); setTxLoading(false); };
  const editHash = (v: string) => { setHash(v.trim()); clearTx(); };
  const editRequestId = (v: string) => { setRequestId(v.trim()); clearDelivery(); };

  const inspect = async (event: FormEvent) => {
    event.preventDefault();
    clearTx();
    if (!isTransactionHash(hash)) {
      setHashError("Enter a complete transaction hash: 0x followed by 64 hexadecimal characters.");
      document.getElementById("transaction-hash")?.focus();
      return;
    }
    const run = chainRead.begin();
    setTxLoading(true);
    try {
      const next = await inspectTransaction(hash, run.signal);
      if (!chainRead.isCurrent(run)) return;
      setTx(next);
      if (next.kind === "paid" && next.requestId.toLowerCase() !== requestId.toLowerCase()) { clearDelivery(); setRequestId(next.requestId); }
    } catch (e) {
      if (chainRead.isCurrent(run)) setTxError(message(e, "The QIE RPC could not verify this transaction."));
    } finally {
      if (chainRead.isCurrent(run)) setTxLoading(false);
    }
  };

  const checkDelivery = async (event: FormEvent) => {
    event.preventDefault();
    clearDelivery();
    if (!isRequestId(requestId)) {
      setIdError("Enter a request ID: 0x followed by 64 hexadecimal characters.");
      document.getElementById("request-id")?.focus();
      return;
    }
    const run = gatewayRead.begin();
    setDeliveryLoading(true);
    try {
      const record = await lookupDelivery(requestId, run.signal);
      if (gatewayRead.isCurrent(run)) setDelivery(record);
    } catch (e) {
      if (gatewayRead.isCurrent(run)) setDeliveryError(message(e, "The gateway could not be reached."));
    } finally {
      if (gatewayRead.isCurrent(run)) setDeliveryLoading(false);
    }
  };

  const match = correlate(tx, delivery);
  const v = tx ? verdict(tx) : null;

  return (
    <div className="space-y-8">
      <section className="rounded-[10px] border bg-card" aria-labelledby="service-h">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2"><Server className="h-5 w-5" aria-hidden /><h2 id="service-h" className="h-card">Service status</h2></div>
          <div className="flex flex-wrap items-center gap-3">
            {checkedAt && <p className="text-xs text-muted-foreground">Checked at {checkedAt}</p>}
            <Button type="button" variant="secondary" onClick={() => void refresh()} loading={healthLoading}>
              {!healthLoading && <RefreshCw className="h-4 w-4" aria-hidden />}{healthLoading ? "Checking…" : "Refresh status"}
            </Button>
          </div>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6" aria-live="polite" aria-busy={healthLoading}>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Gateway</p>
            <p className="mt-2"><Badge tone={health?.gateway.tone ?? "neutral"}>{health?.gateway.label ?? "Checking"}</Badge></p>
            <p className="mt-2 break-all font-mono text-[12px] text-muted-foreground">{config.gatewayUrl}</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Network configuration</p>
            <p className="mt-2"><Badge tone={health?.network.tone ?? "neutral"}>{health?.network.label ?? "Checking"}</Badge></p>
            <p className="mt-2 text-xs text-muted-foreground">{health?.network.note ?? "Reading the gateway's configuration."}</p>
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">Paid calls delivered</p>
            <p className="num mt-1 text-3xl font-bold">{health ? health.delivered === null ? "Unknown" : health.delivered.toLocaleString("en-US") : "…"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Includes project-operated activity.</p>
          </div>
        </div>
        {health?.problem && <p role="status" className="break-words border-t px-5 py-3 text-sm text-danger sm:px-6">{health.problem}</p>}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="min-w-0 rounded-[10px] border bg-card p-5 sm:p-6" aria-labelledby="chain-h">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 shrink-0" aria-hidden /><h2 id="chain-h" className="h-card">1. Verify on-chain payment</h2></div>
          <p className="mt-2 text-sm text-muted-foreground">Paste a QIE transaction hash. Read-only.</p>
          <form className="mt-5 space-y-3" onSubmit={inspect} noValidate>
            <Field htmlFor="transaction-hash" label="Transaction hash" error={hashError ?? undefined}>
              <Input id="transaction-hash" disabled={!ready} value={hash} onChange={(e) => editHash(e.target.value)} placeholder="0x…" className="font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!hashError} aria-describedby={hashError ? "transaction-hash-err" : undefined} />
            </Field>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" loading={txLoading} disabled={!ready || txLoading}>{!txLoading && <Search className="h-4 w-4" aria-hidden />}{txLoading ? "Reading the chain…" : "Inspect payment"}</Button>
              <Button type="button" variant="secondary" disabled={!ready} onClick={() => { editHash(REFERENCE_TX); editRequestId(""); }}>Load recorded example</Button>
            </div>
            <p className="text-xs text-muted-foreground">Example: a project-operated payment of 19 November 2026, read live.</p>
          </form>
          <div aria-live="polite">
            {txLoading && <p className="sr-only">Reading the transaction from the QIE RPC.</p>}
            {txError && <div className="mt-6 border-t pt-5"><Badge tone="danger">Not verified</Badge><p className="mt-2 break-words text-sm text-danger">{txError}</p></div>}
            {tx && v && <div className="mt-6 space-y-3 border-t pt-5">
              <Badge tone={v.tone}>{v.label}</Badge>
              {tx.kind === "paid" ? (
                <>
                  <p className="text-sm text-muted-foreground">On-chain settlement amount</p>
                  <p className="num text-3xl font-bold">{fmtUsdc(BigInt(tx.amountBase))} <span className="text-lg">QUSDC</span></p>
                  <dl className="space-y-2 text-sm">
                    <div><dt className="text-muted-foreground">Transaction</dt><dd><Address value={tx.hash} kind="tx" full /></dd></div>
                    <div><dt className="text-muted-foreground">Owner</dt><dd><Address value={tx.owner} full /></dd></div>
                    <div><dt className="text-muted-foreground">Agent</dt><dd><Address value={tx.agent} full /></dd></div>
                    <div><dt className="text-muted-foreground">Merchant</dt><dd><Address value={tx.merchant} full /></dd></div>
                    <div><dt className="text-muted-foreground">Block / confirmations at inspection</dt><dd className="num">{tx.blockNumber.toLocaleString("en-US")} / {tx.confirmations.toLocaleString("en-US")}</dd></div>
                    <div><dt className="text-muted-foreground">Request ID</dt><dd className="flex items-start gap-1"><span className="min-w-0 break-all font-mono text-[13px]">{tx.requestId}</span><CopyButton value={tx.requestId} label="Copy request ID" className="shrink-0" /></dd></div>
                  </dl>
                  {!tx.settled && <p className="text-sm text-warn">Fewer than {SETTLED_CONFIRMATIONS} confirmations. The block can still be replaced; inspect it again shortly.</p>}
                  {tx.headAgeSeconds > STALE_HEAD_SECONDS && <p className="text-sm text-warn">This RPC&apos;s latest block is about {Math.round(tx.headAgeSeconds / 60)} minutes old, so the confirmation count may be out of date.</p>}
                  <p className="flex gap-2 text-sm text-muted-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Paid is not the same as delivered. Check the gateway record next.</p>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">{explanation(tx)}</p>
                  <div className="text-sm"><p className="text-muted-foreground">Transaction</p><Address value={tx.hash} kind="tx" full /></div>
                </>
              )}
            </div>}
          </div>
        </section>

        <section className="min-w-0 rounded-[10px] border bg-card p-5 sm:p-6" aria-labelledby="delivery-h">
          <div className="flex items-center gap-2"><Activity className="h-5 w-5 shrink-0" aria-hidden /><h2 id="delivery-h" className="h-card">2. Inspect gateway delivery</h2></div>
          <p className="mt-2 text-sm text-muted-foreground">Paste a request ID. Status only; the purchased response stays private.</p>
          <form className="mt-5 space-y-3" onSubmit={checkDelivery} noValidate>
            <Field htmlFor="request-id" label="Request ID" error={idError ?? undefined}>
              <Input id="request-id" disabled={!ready} value={requestId} onChange={(e) => editRequestId(e.target.value)} placeholder="0x…" className="font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!idError} aria-describedby={idError ? "request-id-err" : undefined} />
            </Field>
            <Button type="submit" variant="secondary" loading={deliveryLoading} disabled={!ready || deliveryLoading}>{!deliveryLoading && <Search className="h-4 w-4" aria-hidden />}{deliveryLoading ? "Asking the gateway…" : "Check delivery state"}</Button>
          </form>
          <div aria-live="polite">
            {deliveryError && <div className="mt-6 border-t pt-5"><Badge tone="danger">Unknown</Badge><p className="mt-2 break-words text-sm text-danger">{deliveryError}</p></div>}
            {delivery && <div className="mt-6 space-y-3 border-t pt-5">
              <Badge tone={stateTone(delivery.state)}>{delivery.state.replaceAll("_", " ")}</Badge>
              <p className="text-sm text-muted-foreground">{stateMeaning(delivery.state)}</p>
              {delivery.txHash && <div className="text-sm"><p className="text-muted-foreground">Gateway-linked transaction</p><Address value={delivery.txHash} kind="tx" full /></div>}
              {delivery.expiresAt > 0 && <p className="text-xs text-muted-foreground">Original challenge expiry: {new Date(delivery.expiresAt * 1000).toLocaleString()} (local time)</p>}
            </div>}
            {match && <div data-tone={match.tone} className={cn("mt-4 border-l-[3px] bg-muted p-3 text-sm", EDGE[match.tone])}><p className="font-semibold">{TONE_WORD[match.tone]}</p><p className="mt-1">{match.text}</p></div>}
          </div>
        </section>
      </div>

      <div className="flex items-start gap-3 rounded-[10px] border border-warn/40 bg-card p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
        <div className="max-w-[80ch]">
          <p className="font-semibold">When the gateway cannot deliver</p>
          <p className="mt-1 text-muted-foreground">Keep your proof and retry with it. Never pay a second time for a payment whose outcome is unknown.</p>
          <p className="mt-2"><Link className="link inline-flex items-center gap-1" href="/developers#trust">Recovery guidance <ArrowUpRight className="h-3 w-3" aria-hidden /></Link></p>
        </div>
      </div>
    </div>
  );
}
