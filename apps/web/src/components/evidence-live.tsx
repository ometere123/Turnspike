"use client";

import { useEffect, useState } from "react";
import { CloudOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { gateway, type GatewayStats } from "@/lib/gateway";
import { config } from "@/lib/config";

/** Live usage counters straight from the gateway database. Shows an unavailable state, never a made-up number. */
export function LiveStats() {
  const [s, setS] = useState<GatewayStats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { gateway.stats().then((r) => (r.ok ? setS(r.data) : setErr(r.error))); }, []);

  if (err) return <Card role="alert" className="flex items-center gap-3 p-5 text-sm text-muted-foreground"><CloudOff className="h-4 w-4" aria-hidden />Usage counters are unavailable right now ({err}). Gateway: <span className="font-mono">{config.gatewayUrl}</span></Card>;
  const items: [string, number | undefined, string][] = [
    ["Calls delivered", s?.delivered, "All paid calls this gateway has delivered"],
    ["From addresses the operator controls", s?.deliveredOwn, "The project's own test wallets"],
    ["From other addresses", s?.deliveredExternal, "Counted only if the payer is not in the operator's list"],
    ["Paid but undelivered over 24 h", s?.paidUndelivered24h, "No automatic refund in this version"],
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map(([l, v, d]) => (
        <Card key={l} className="p-5"><p className="text-[13px] text-muted-foreground">{l}</p>{s ? <p className="mt-1 text-3xl font-semibold tracking-tight">{v}</p> : <Skeleton className="mt-2 h-9 w-16" />}<p className="mt-1 text-xs text-muted-foreground">{d}</p></Card>
      ))}
    </div>
  );
}
