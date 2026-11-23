"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowUpRight, CheckCircle2, CircleHelp, RefreshCw, Search, Server, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Field } from "@/components/ui/input";
import { Address } from "@/components/ui/address";
import { config } from "@/lib/config";
import { gateway, type GatewayConfig, type GatewayStats, type Result } from "@/lib/gateway";
import { fmtUsdc } from "@/lib/utils";
import { inspectTransaction, isTransactionHash, type ChainInspection } from "@/lib/receipt-inspector";

const requestIdPattern = /^0x[0-9a-fA-F]{64}$/;
type DeliveryRecord = { state: string; txHash: string | null; expiresAt: number };
type Health = { reachable: boolean; config: GatewayConfig | null; stats: GatewayStats | null; error: string | null };

const initialHealth: Health = { reachable: false, config: null, stats: null, error: null };

function stateMeaning(state: string) {
  switch (state) {
    case "DELIVERED": return "The gateway records a stored response for this request. This is a gateway claim, not an on-chain delivery proof.";
    case "PAID_CONFIRMED": return "The gateway has confirmed payment; response delivery has not been recorded.";
    case "PAID_PENDING": return "Payment evidence is pending verification or confirmations.";
    case "DELIVERING": return "A worker is delivering the resource, or may need a retry after its lease expires.";
    case "ISSUED": return "A price challenge was issued, but this does not prove payment.";
    case "EXPIRED": return "The challenge expired without a confirmed payment in this gateway record.";
    case "REJECTED": return "The gateway rejected the payment proof. Check the original challenge and receipt.";
    default: return "Unknown gateway state. Consult the protocol documentation.";
  }
}

function statusTone(value: string): "neutral" | "success" | "warn" | "danger" {
  if (value === "DELIVERED") return "success";
  if (value === "REJECTED" || value === "EXPIRED") return "danger";
  if (value === "PAID_PENDING" || value === "DELIVERING" || value === "PAID_CONFIRMED") return "warn";
  return "neutral";
}

export function OperationsCenter() {
  const [health, setHealth] = useState<Health>(initialHealth);
  const [healthLoading, setHealthLoading] = useState(true);
  const [hash, setHash] = useState("");
  const [tx, setTx] = useState<ChainInspection | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState("");
  const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setHealthLoading(true);
    const [h, c, s] = await Promise.all([gateway.health(), gateway.config(), gateway.stats()]);
    setHealth({
      reachable: h.ok && h.data.ok === true,
      config: c.ok ? c.data : null,
      stats: s.ok ? s.data : null,
      error: !h.ok ? h.error : !c.ok ? c.error : !s.ok ? s.error : null,
    });
    setHealthLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const inspect = async (event: FormEvent) => {
    event.preventDefault();
    setTx(null);
    setTxError(null);
    setDelivery(null);
    setDeliveryError(null);
    if (!isTransactionHash(hash.trim())) {
      setTxError("Enter a complete transaction hash: 0x followed by 64 hexadecimal characters.");
      return;
    }
    setTxLoading(true);
    try {
      const next = await inspectTransaction(hash);
      setTx(next);
      if (next.kind === "paid") setRequestId(next.requestId);
    } catch (error) {
      setTxError(error instanceof Error ? error.message : "The QIE RPC could not verify this transaction.");
    } finally { setTxLoading(false); }
  };

  const checkDelivery = async (event: FormEvent) => {
    event.preventDefault();
    setDelivery(null);
    setDeliveryError(null);
    const key = requestId.trim();
    if (!requestIdPattern.test(key)) {
      setDeliveryError("Enter a request ID: 0x followed by 64 hexadecimal characters.");
      return;
    }
    setDeliveryLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(config.gatewayUrl + "/v1/payments/" + encodeURIComponent(key), { method: "GET", cache: "no-store", signal: controller.signal });
      if (response.status === 404) throw new Error("This gateway has no matching request record. That does not establish whether a transaction settled.");
      if (!response.ok) throw new Error("The gateway could not provide this request's delivery state.");
      const data: unknown = await response.json();
      if (typeof data !== "object" || data === null || !("state" in data) || typeof data.state !== "string") {
        throw new Error("The gateway returned an unexpected status record.");
      }
      const record = data as Record<string, unknown>;
      if (record.txHash !== null && record.txHash !== undefined && (typeof record.txHash !== "string" || !isTransactionHash(record.txHash))) {
        throw new Error("The gateway's transaction reference was malformed.");
      }
      setDelivery({ state: data.state, txHash: typeof record.txHash === "string" ? record.txHash : null, expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0 });
    } catch (error) {
      setDeliveryError(error instanceof Error && error.name === "AbortError" ? "The gateway request timed out." : error instanceof Error ? error.message : "Gateway unavailable.");
    } finally {
      clearTimeout(timer);
      setDeliveryLoading(false);
    }
  };

  const crossCheck = tx?.kind === "paid" && delivery !== null
    ? !delivery.txHash ? "The gateway record does not include a transaction hash, so the two records cannot be correlated yet."
      : delivery.txHash.toLowerCase() !== tx.hash.toLowerCase() ? "Warning: the gateway transaction hash does not match the transaction inspected above. Do not treat these as one payment."
      : delivery.state === "DELIVERED" ? "The Paid event and this gateway delivery record refer to the same transaction. The gateway reports delivery."
      : "The records refer to the same transaction, but the gateway does not report completed delivery."
    : null;

  return (
    <div className="space-y-8">
      <section className="rounded-[10px] border bg-card" aria-labelledby="service-h">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2"><Server className="h-5 w-5" aria-hidden /><h2 id="service-h" className="h-card">Service status</h2></div>
          <Button type="button" size="sm" variant="secondary" onClick={() => void refresh()} loading={healthLoading}>
            {!healthLoading && <RefreshCw className="h-4 w-4" aria-hidden />}{healthLoading ? "Checking…" : "Refresh status"}
          </Button>
        </div>
        <div className="grid gap-5 p-5 sm:grid-cols-3 sm:p-6">
          <div>
            <p className="text-sm text-muted-foreground">Gateway</p>
            <p className="mt-2"><Badge tone={healthLoading ? "neutral" : health.reachable ? "success" : "danger"}>{healthLoading ? "Checking" : health.reachable ? "Responding" : "Unreachable"}</Badge></p>
            <p className="mt-2 break-all font-mono text-[12px] text-muted-foreground">{config.gatewayUrl}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Network configuration</p>
            <p className="mt-2 text-lg font-semibold">{health.config ? "QIE · " + health.config.chainId : "Unavailable"}</p>
            <p className="mt-2 text-xs text-muted-foreground">Gateway-reported configuration, not an independently verified chain read.</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Paid calls delivered</p>
            <p className="num mt-1 text-3xl font-bold">{health.stats ? health.stats.delivered.toLocaleString("en-US") : "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">Gateway database counter; includes project-operated activity.</p>
          </div>
        </div>
        {health.error && <p role="status" className="border-t px-5 py-3 text-sm text-muted-foreground sm:px-6">Partial status unavailable: {health.error}. No values were substituted.</p>}
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="min-w-0 rounded-[10px] border bg-card p-5 sm:p-6" aria-labelledby="chain-h">
          <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5" aria-hidden /><h2 id="chain-h" className="h-card">1. Verify on-chain payment</h2></div>
          <p className="mt-2 text-sm text-muted-foreground">Enter a QIE Mainnet transaction hash. We read its receipt and check for a Paid event emitted by the deployed Turnspike contract. This does not send a transaction.</p>
          <form className="mt-5 space-y-3" onSubmit={inspect} noValidate>
            <Field htmlFor="transaction-hash" label="Transaction hash" error={txError ?? undefined}>
              <Input id="transaction-hash" value={hash} onChange={(e) => setHash(e.target.value.trim())} placeholder="0x…" className="font-mono text-sm" spellCheck={false} autoComplete="off" aria-invalid={!!txError} aria-describedby={txError ? "transaction-hash-err" : undefined} />
            </Field>
            <Button type="submit" loading={txLoading} disabled={txLoading}><Search className="h-4 w-4" aria-hidden />Inspect payment</Button>
          </form>
          {tx && <div className="mt-6 space-y-3 border-t pt-5" aria-live="polite">
            <Badge tone={tx.kind === "paid" ? "success" : tx.kind === "reverted" || tx.kind === "uncertain" ? "warn" : "neutral"}>
              {tx.kind === "paid" ? "Paid event found" : tx.kind === "reverted" ? "Reverted" : tx.kind === "not_found" ? "Not found" : tx.kind === "uncertain" ? "Uncertain" : "No Turnspike Paid event"}
            </Badge>
            {tx.kind === "paid" ? (
              <>
                <p className="text-sm text-muted-foreground">On-chain settlement amount</p>
                <p className="num text-3xl font-bold">{fmtUsdc(BigInt(tx.amountBase))} <span className="text-lg">QUSDC</span></p>
                <dl className="space-y-2 text-sm">
                  <div><dt className="text-muted-foreground">Owner</dt><dd className="break-all"><Address value={tx.owner} full /></dd></div>
                  <div><dt className="text-muted-foreground">Agent</dt><dd className="break-all"><Address value={tx.agent} full /></dd></div>
                  <div><dt className="text-muted-foreground">Merchant</dt><dd className="break-all"><Address value={tx.merchant} full /></dd></div>
                  <div><dt className="text-muted-foreground">Block / confirmations at inspection</dt><dd className="num">{tx.blockNumber.toLocaleString("en-US")} / {tx.confirmations.toLocaleString("en-US")}</dd></div>
                  <div><dt className="text-muted-foreground">Request ID</dt><dd className="break-all font-mono text-xs">{tx.requestId}</dd></div>
                  <div><dt className="text-muted-foreground">Explorer receipt</dt><dd><Address value={tx.hash} kind="tx" /></dd></div>
                </dl>
                <p className="flex gap-2 text-sm text-muted-foreground"><CircleHelp className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Settlement is not the same thing as resource delivery. Inspect the gateway record next.</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {tx.kind === "not_found" ? "No receipt was returned by this RPC. It may be pending, unknown, or unavailable on this provider."
                  : tx.kind === "reverted" ? "The transaction reverted. It did not emit a successful Turnspike payment, although gas may have been consumed."
                    : tx.kind === "not_turnspike" ? "This transaction succeeded but did not contain a matching Paid event from the configured Turnspike vault."
                      : tx.reason}
              </p>
            )}
          </div>}
        </section>

        <section className="min-w-0 rounded-[10px] border bg-card p-5 sm:p-6" aria-labelledby="delivery-h">
          <div className="flex items-center gap-2"><Activity className="h-5 w-5" aria-hidden /><h2 id="delivery-h" className="h-card">2. Inspect gateway delivery</h2></div>
          <p className="mt-2 text-sm text-muted-foreground">Use the request ID from the Paid event above, or one from a 402 challenge. This reads the public gateway's status-only endpoint; it does not reveal the purchased response.</p>
          <form className="mt-5 space-y-3" onSubmit={checkDelivery} noValidate>
            <Field htmlFor="request-id" label="Request ID" error={deliveryError ?? undefined}>
              <Input id="request-id" value={requestId} onChange={(e) => setRequestId(e.target.value.trim())} placeholder="0x…" className="font-mono text-sm" spellCheck={false} autoComplete="off" aria-invalid={!!deliveryError} aria-describedby={deliveryError ? "request-id-err" : undefined} />
            </Field>
            <Button type="submit" variant="secondary" loading={deliveryLoading} disabled={deliveryLoading}><Search className="h-4 w-4" aria-hidden />Check delivery state</Button>
          </form>
          {delivery && <div className="mt-6 space-y-3 border-t pt-5" aria-live="polite">
            <Badge tone={statusTone(delivery.state)}>{delivery.state.replaceAll("_", " ")}</Badge>
            <p className="text-sm text-muted-foreground">{stateMeaning(delivery.state)}</p>
            {delivery.txHash && <div className="text-sm"><p className="text-muted-foreground">Gateway-linked transaction</p><Address value={delivery.txHash} kind="tx" /></div>}
            {delivery.expiresAt > 0 && <p className="text-xs text-muted-foreground">Original challenge expiry: {new Date(delivery.expiresAt * 1000).toLocaleString()} (local time)</p>}
          </div>}
          {crossCheck && <div role="status" className="mt-4 border-l-[3px] border-primary bg-muted p-3 text-sm">{crossCheck}</div>}
        </section>
      </div>

      <div className="flex flex-wrap items-start gap-3 rounded-[10px] border border-warn/40 bg-card p-4 text-sm">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
        <div className="max-w-[80ch]">
          <p className="font-semibold">When the gateway cannot deliver</p>
          <p className="mt-1 text-muted-foreground">Keep your original request ID, signature, transaction hash and client journal confidential. A 200 response and the same saved response on replay can demonstrate recovery. A 404 status, gateway outage or pending state is not evidence of a refund or a free retry.</p>
          <p className="mt-2"><Link className="link inline-flex items-center gap-1" href="/developers#trust">Read the protocol and recovery guidance <ArrowUpRight className="h-3 w-3" aria-hidden /></Link></p>
        </div>
      </div>
    </div>
  );
}
