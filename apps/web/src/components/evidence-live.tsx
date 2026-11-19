"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type GatewayStats } from "@/lib/gateway";
import { config } from "@/lib/config";

/** Live usage counters straight from the gateway database, posted like a tally board. Shows an unavailable state, never a made-up number. */
export function LiveStats() {
  const [s, setS] = useState<GatewayStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { gateway.stats().then((r) => (r.ok ? setS(r.data) : setErr(r.error))); }, []);

  if (err) return (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
      <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>Usage counters are unavailable right now ({err}). Reload the page to try again. Gateway: <span className="break-all font-mono">{config.gatewayUrl}</span></span>
    </div>
  );
  const items: [string, number | undefined, string][] = [
    ["Calls delivered", s?.delivered, "All paid calls this gateway has delivered"],
    ["From addresses the operator controls", s?.deliveredOwn, "The project's own test wallets"],
    ["From other addresses", s?.deliveredExternal, "Counted only if the payer is not in the operator's list"],
    ["Paid but undelivered over 24 h", s?.paidUndelivered24h, "No automatic refund in this version"],
  ];
  return (
    <dl aria-busy={!s} className="grid overflow-hidden rounded-2xl border border-t-2 border-t-foreground bg-card sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([l, v, d]) => (
        <div key={l} className="-mb-px -mr-px border-b border-r p-5">
          <dt className="text-sm font-semibold">{l}</dt>
          <dd className="mt-2">
            {s ? <span className="num block text-4xl font-bold tracking-tight [font-stretch:112%]">{v}</span> : <Skeleton className="h-10 w-16" />}
            <span className="mt-1 block text-[13px] text-muted-foreground">{d}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
