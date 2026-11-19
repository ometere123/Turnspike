"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { gateway, type Challenge } from "@/lib/gateway";
import { config } from "@/lib/config";
import { cn } from "@/lib/utils";

const short = (h: string, a = 6, b = 4) => `${h.slice(0, a)}…${h.slice(-b)}`;
const qusdc = (base: string) => (Number(base) / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 });

type State = { kind: "loading" } | { kind: "ok"; c: Challenge; at: number } | { kind: "error"; message: string };

/**
 * The live gate. It asks the real gateway for /v1/block-summary without paying, and prints the 402 quote it gets back
 * as a ticket. Nothing here is mocked: if the gateway is down, the gate says so.
 */
export function HeroVisual() {
  const [s, setS] = useState<State>({ kind: "loading" });
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [round, setRound] = useState(0);

  const ask = useCallback(async () => {
    setS({ kind: "loading" });
    const r = await gateway.probe();
    if (r.ok && r.data?.requestId) { setS({ kind: "ok", c: r.data, at: Date.now() }); setRound((n) => n + 1); }
    else setS({ kind: "error", message: r.ok ? "The gateway answered without a challenge." : r.error });
  }, []);

  useEffect(() => { void ask(); }, [ask]);
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t); }, []);

  const left = s.kind === "ok" ? Math.max(0, s.c.expiresAt - now) : 0;
  const mm = String(Math.floor(left / 60)).padStart(1, "0"), ss = String(left % 60).padStart(2, "0");

  return (
    <div className="relative">
      {/* The gate: a post and a barrier arm. The arm settles each time a fresh quote arrives. */}
      <div className="relative h-[92px]" aria-hidden>
        <div className="absolute bottom-0 left-2 h-[92px] w-5 rounded-t-[3px] bg-foreground" />
        <div className="absolute bottom-[78px] left-[6px] h-3 w-3 rounded-full bg-primary" />
        <div key={round} className={cn("absolute bottom-[54px] left-5 h-[18px] w-[calc(100%-1.25rem)] origin-left rounded-r-[3px] border border-foreground/80", "barrier-stripe", s.kind === "ok" && "animate-barrier-down")} />
      </div>

      <div className="ticket shadow-ticket mt-3" style={{ ["--notch-y" as string]: "118px" }}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5">
          <div>
            <p className="kicker">Live from the gateway, unpaid request</p>
            <p className="mt-1 break-all font-mono text-[13px] text-muted-foreground">GET {config.gatewayUrl.replace("https://", "")}/v1/block-summary</p>
          </div>
          <span className="shrink-0 rounded-[4px] bg-foreground px-2 py-1 font-mono text-xs font-semibold text-background">402</span>
        </div>

        <div className="px-6 pb-5 pt-4">
          {s.kind === "loading" && (
            <div className="space-y-3" aria-live="polite">
              <span className="sr-only">Asking the gate for a quote…</span>
              <div className="h-10 w-40 animate-pulse rounded bg-muted" />
              <div className="h-4 w-56 animate-pulse rounded bg-muted" />
            </div>
          )}
          {s.kind === "error" && (
            <div aria-live="polite">
              <p className="h-card">The gate did not answer</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.message}. The hosted gateway may be restarting; nothing was charged.</p>
            </div>
          )}
          {s.kind === "ok" && (
            <div aria-live="polite">
              <p className="text-sm text-muted-foreground">Toll to pass</p>
              <p className="num mt-0.5 text-[2.6rem] font-bold leading-none [font-stretch:118%]">{qusdc(s.c.priceBase)} <span className="text-xl font-semibold text-muted-foreground">QUSDC</span></p>
              <p className="num mt-2 text-sm">Quote valid for <strong>{mm}:{ss}</strong> {left === 0 && <span className="text-danger">(expired, ask again)</span>}</p>
            </div>
          )}
        </div>

        <div className="perforation mx-6" />

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 px-6 py-5 text-sm">
          <div className="col-span-2"><dt className="text-muted-foreground">Request ID</dt><dd className="mt-0.5 font-mono text-[13px]">{s.kind === "ok" ? short(s.c.requestId, 14, 8) : "…"}</dd></div>
          <div><dt className="text-muted-foreground">Pays</dt><dd className="mt-0.5 font-mono text-[13px]">{s.kind === "ok" ? short(s.c.merchant) : "…"}</dd></div>
          <div><dt className="text-muted-foreground">Chain</dt><dd className="num mt-0.5">QIE {s.kind === "ok" ? s.c.chainId : config.chainId}</dd></div>
          <div><dt className="text-muted-foreground">Resource</dt><dd className="mt-0.5 font-mono text-[13px]">{s.kind === "ok" ? s.c.resourceId : "…"}</dd></div>
          <div><dt className="text-muted-foreground">Settles through</dt><dd className="mt-0.5 font-mono text-[13px]">{short(config.allowance)}</dd></div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className="text-sm text-muted-foreground">An agent pays this on chain, within its owner&apos;s limits, then presents the proof.</p>
          <Button size="sm" variant="secondary" onClick={() => void ask()} loading={s.kind === "loading"}>Ask the gate again</Button>
        </div>
      </div>
    </div>
  );
}
