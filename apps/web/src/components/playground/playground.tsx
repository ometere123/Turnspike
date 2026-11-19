"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract } from "ethers";
import { AlertTriangle, CheckCircle2, Circle, CloudOff, Play, ShieldAlert, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Address } from "@/components/ui/address";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { ALLOWANCE_ABI, ERROR_TEXT } from "@/lib/abi";
import { config, deploymentEvidence } from "@/lib/config";
import { gateway, solvePow, type Challenge, type DemoStatus, type GatewayConfig, type GatewayStats, type RunResult, type Scenario } from "@/lib/gateway";
import { useWallet } from "@/lib/wallet";
import { cn, fmtUsdc } from "@/lib/utils";

type Run = { id: number; scenario: Scenario; at: string; result: RunResult | null; error?: string };

const SCENARIOS: { id: Scenario; title: string; blurb: string }[] = [
  { id: "allowed", title: "Paid call", blurb: "Request, receive a 402, pay through the contract, wait for confirmations and receive live block data." },
  { id: "replay", title: "Replay", blurb: "Re-present the last proof (stored response, no second charge) and try to pay the same request ID again (refused by the contract)." },
  { id: "over-cap", title: "Over-cap payment", blurb: "Try to pay one base unit more than the per-call limit. The contract reverts with CapExceeded." },
  { id: "unauthorized-merchant", title: "Unlisted merchant (simulation)", blurb: "Asks the contract, with a read-only eth_call, to pay a merchant the owner never allowed. It reverts with MerchantNotAllowed. No transaction, no gas." },
];

const STAGES = [
  "Agent requests a protected resource",
  "Gateway answers with payment requirements (402)",
  "Agent makes an authorised QUSDC payment",
  "Gateway verifies the payment on-chain",
  "Resource is delivered",
  "Over-cap payment is refused",
  "Replayed request ID is refused",
] as const;

function stageStates(runs: Run[]): ("idle" | "done")[] {
  const steps = runs.flatMap((r) => (r.result?.steps ?? []).map((s) => ({ ...s, scenario: r.scenario })));
  const name = (s: any) => (s.detail as any)?.name;
  return [
    steps.some((s) => s.step === "402 challenge" && s.ok),
    steps.some((s) => s.step === "402 challenge" && s.ok),
    steps.some((s) => s.step === "pay submitted" && s.ok),
    steps.some((s) => (s.step === "delivered" || s.step === "pending") && s.ok),
    steps.some((s) => s.step === "delivered" && s.ok),
    steps.some((s) => name(s) === "CapExceeded"),
    steps.some((s) => name(s) === "RequestAlreadyUsed"),
  ].map((b) => (b ? "done" : "idle"));
}

function explain(error: string, body?: Record<string, unknown>): string {
  const retry = typeof body?.retryAfterSeconds === "number" ? ` Try again in about ${Math.max(1, Math.round((body.retryAfterSeconds as number) / 60))} minute(s).` : "";
  switch (error) {
    case "quota_exceeded": return (body?.scope === "global_day" ? "The shared daily budget for the demo is used up." : "You have reached the demo limit for your connection.") + retry;
    case "demo_busy": return "Another run is in progress. Try again in a moment.";
    case "demo_funds_low": return "The demo agent is low on gas, so runs are paused until it is topped up. Nothing was sent.";
    case "demo_disabled": return "The demo agent is switched off on this gateway.";
    case "pow_expired": case "pow_invalid": case "pow_used": case "pow_wrong_client": case "pow_required": return "The anti-abuse puzzle was not accepted. Please try again.";
    default: return error;
  }
}

export function Playground() {
  const w = useWallet();
  const [cfg, setCfg] = useState<GatewayConfig | null>(null);
  const [stats, setStats] = useState<GatewayStats | null>(null);
  const [down, setDown] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [limits, setLimits] = useState<{ perCall: bigint; daily: bigint; spent: bigint; balance: bigint } | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [running, setRunning] = useState<Scenario | null>(null);
  const [phase, setPhase] = useState("");
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [probing, setProbing] = useState(false);

  const load = useCallback(async () => {
    const [c, s, d] = await Promise.all([gateway.config(), gateway.stats(), gateway.demoStatus()]);
    if (c.ok) { setCfg(c.data); setDown(null); } else setDown(c.error);
    if (s.ok) setStats(s.data);
    if (d.ok) setDemo(d.data);
    setLoading(false);
    try {
      const v = new Contract(config.allowance, ALLOWANCE_ABI as unknown as string[], w.readProvider);
      const owner = deploymentEvidence.deployer_owner;
      const [a, spent] = await Promise.all([v.account(owner), v.spentToday(owner)]);
      setLimits({ perCall: a.perCallCap, daily: a.dailyCap, spent, balance: a.balance });
    } catch { /* limits stay unknown */ }
  }, [w.readProvider]);
  useEffect(() => { load(); }, [load]);

  const states = useMemo(() => stageStates(runs), [runs]);

  async function probe() {
    setProbing(true);
    const r = await gateway.probe();
    setChallenge(r.ok ? r.data : null);
    if (!r.ok) setDown(r.error);
    setProbing(false);
  }

  async function run(s: Scenario) {
    setRunning(s);
    const push = (result: RunResult | null, error?: string) => setRuns((x) => [{ id: Date.now(), scenario: s, at: new Date().toLocaleTimeString(), result, error }, ...x]);
    try {
      setPhase("Solving a short puzzle. It keeps scripts from draining the demo wallet, and takes a second or two.");
      const ch = await gateway.demoChallenge();
      if (!ch.ok) return push(null, explain(ch.error, ch.body));
      const nonce = await solvePow(ch.data.token, ch.data.bits);
      setPhase("Running on the gateway. Paid runs wait for chain confirmations, about 10 to 30 seconds.");
      const r = await gateway.run(s, `${ch.data.token}.${nonce}`);
      push(r.ok ? r.data : null, r.ok ? undefined : explain(r.error, r.body));
    } finally { setRunning(null); setPhase(""); load(); }
  }

  const demoOk = !!cfg?.demoEnabled && !down && !(demo?.enabled && (demo.txBudgetRemaining === 0 || demo.agentGasOk === false));

  return (
    <div className="container py-12 sm:py-16">
      <div className="max-w-2xl">
        <p className="mb-3 text-sm font-medium text-accent">Playground</p>
        <h1 className="h-section">Watch an agent pay for an API, and get refused.</h1>
        <p className="lead mt-4">This talks to the live gateway and the deployed contract on QIE Mainnet. The scripted agent (no LLM) is driven from the gateway and spends small real amounts from a demo account, bounded by that account&apos;s on-chain limits.</p>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-semibold tracking-tight"><Radio className="h-4 w-4 text-accent" aria-hidden />Gateway</h2>
            {loading ? <Skeleton className="h-6 w-24" /> : down ? <Badge tone="danger">Unavailable</Badge> : <Badge tone="success">Reachable</Badge>}
          </div>
          {loading ? <Skeleton className="mt-4 h-28 w-full" /> : down ? (
            <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger"><CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><span>The gateway at <span className="font-mono">{config.gatewayUrl}</span> did not respond ({down}). Nothing below can run until it is back. No results are simulated.</span></div>
          ) : (
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">Endpoint</dt><dd className="font-mono text-[13px]">GET {config.gatewayUrl.replace("https://", "")}/v1/block-summary</dd></div>
              <div><dt className="text-muted-foreground">Price per call</dt><dd>{cfg ? `${fmtUsdc(cfg.priceBase)} QUSDC` : "…"} ({cfg?.priceBase} base units)</dd></div>
              <div><dt className="text-muted-foreground">Confirmations required</dt><dd>{cfg?.confirmations}</dd></div>
              <div><dt className="text-muted-foreground">Calls delivered (all time on this gateway)</dt><dd>{stats ? `${stats.delivered} (${stats.deliveredExternal} from addresses we do not control)` : "…"}</dd></div>
            </dl>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="font-semibold tracking-tight">Demo account limits (read from chain)</h2>
          {!limits ? <Skeleton className="mt-3 h-[6.5rem] w-full" /> : (
            <dl className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Per-call limit</dt><dd>{fmtUsdc(limits.perCall)} QUSDC</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Daily limit</dt><dd>{fmtUsdc(limits.daily)} QUSDC</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Spent today (UTC)</dt><dd>{fmtUsdc(limits.spent)} QUSDC</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Remaining balance</dt><dd>{fmtUsdc(limits.balance)} QUSDC</dd></div>
            </dl>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Owner <Address value={deploymentEvidence.deployer_owner} />. When the daily limit is reached, further paid calls are refused by the contract until the next UTC day.</p>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="font-semibold tracking-tight">Journey</h2>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STAGES.map((s, i) => (
            <li key={s} className={cn("flex items-start gap-2.5 rounded-xl border p-3 text-sm", states[i] === "done" ? "border-accent/40 bg-accent-soft" : "text-muted-foreground")}>
              {states[i] === "done" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-label="Observed in this session" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0" aria-label="Not yet run" />}
              <span><span className="font-mono text-xs">0{i + 1}</span> {s}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">A step lights up only after the real gateway or contract produced it in this session.</p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>1. See the payment requirements</CardTitle><CardDescription>An unpaid request to the real endpoint. Free, sends no transaction.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <Button variant="secondary" onClick={probe} loading={probing} disabled={!!down}>Request without paying</Button>
              {challenge && <CodeBlock lang="json" title="HTTP 402 from the gateway" code={JSON.stringify(challenge, null, 2)} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>2. Run the scripted agent</CardTitle><CardDescription>Each run sends real mainnet transactions from the demo agent.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              <div role="note" className="flex gap-2.5 rounded-xl bg-warn/10 p-3 text-xs leading-relaxed text-warn"><ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Real transactions, real QUSDC (0.001 per paid call) and QIE gas. Failed attempts are broadcast too, so they have explorer links. Runs can take 10 to 30 seconds.</div>
              {demo?.enabled && (
                <p className="rounded-xl bg-muted p-3 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
                  Demo limits: {demo.perIpHour} runs per hour and {demo.perIpDay} per day per visitor, and {demo.txBudgetRemaining} of {demo.txBudget} transactions left in today&apos;s shared budget.
                  {demo.agentGasOk === false && " The demo agent is out of gas, so runs are paused until it is topped up."}
                  {demo.txBudgetRemaining === 0 && " Today's budget is used up; try again tomorrow, or fund your own account in the app."}
                </p>
              )}
              {running && phase && <p role="status" className="text-xs text-muted-foreground">{phase}</p>}
              {!demoOk && !loading && <p className="text-sm text-muted-foreground">{down ? "The gateway is unavailable." : "The demo agent is not enabled on this gateway."}</p>}
              {SCENARIOS.map((s) => (
                <div key={s.id} className="flex items-start justify-between gap-3 rounded-xl border p-3">
                  <div><p className="text-sm font-medium">{s.title}</p><p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.blurb}</p></div>
                  <Button size="sm" disabled={!demoOk || !!running} loading={running === s.id} onClick={() => run(s.id)}><Play className="h-3.5 w-3.5" aria-hidden />Run</Button>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">To see revocation, fund your own account in the <a className="underline" href="/app">app</a>, authorise an agent, then revoke it. A recorded mainnet revoke is on the <a className="underline" href="/evidence">evidence</a> page.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Run log</CardTitle><CardDescription>Exactly what the gateway returned.</CardDescription></CardHeader>
          <CardContent>
            {runs.length === 0 ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No runs yet. Results appear here with explorer links. Nothing is pre-filled.</p> : (
              <ul className="space-y-5" aria-live="polite">
                {runs.map((r) => (
                  <li key={r.id}>
                    <p className="text-sm font-semibold">{SCENARIOS.find((s) => s.id === r.scenario)?.title} <span className="font-normal text-muted-foreground">· {r.at}</span></p>
                    {r.error && <p role="alert" className="mt-2 flex items-center gap-2 text-sm text-danger"><AlertTriangle className="h-4 w-4" aria-hidden />{r.error}</p>}
                    <ol className="mt-2 divide-y rounded-xl border text-sm">
                      {r.result?.steps.map((s, i) => {
                        const d = s.detail as any;
                        const text = d?.name ? ERROR_TEXT[d.name] ?? d.name : d?.why ? `${d.why}, ${d.confirmations} confirmation(s), ${d.elapsedSeconds}s elapsed` : d?.note ?? (typeof d === "string" ? d : d?.status ? `HTTP ${d.status}` : "");
                        return (
                          <li key={i} className="flex flex-wrap items-center justify-between gap-2 p-3">
                            <span className="flex items-center gap-2">
                              <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold", s.ok ? (s.step === "pending" ? "bg-warn/15 text-warn" : "bg-success/15 text-success") : "bg-danger/15 text-danger")}>{s.ok ? (s.step === "pending" ? "PENDING" : "OK") : "REFUSED"}</span>
                              <span>{s.step}{text ? <span className="text-muted-foreground"> · {text}</span> : null}{d?.name ? <span className="ml-1 font-mono text-xs text-muted-foreground">{d.name}</span> : null}</span>
                            </span>
                            {s.txHash && <Address value={s.txHash} kind="tx" />}
                          </li>
                        );
                      })}
                    </ol>
                    {r.result?.data && <p className="mt-2 text-sm text-muted-foreground">Delivered: block {r.result.data.blockNumber} at {new Date(r.result.data.timestamp * 1000).toISOString()}, {r.result.data.txCount} transactions, read live from the QIE RPC.</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
