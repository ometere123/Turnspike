"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contract } from "ethers";
import { AlertTriangle, CloudOff, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Address } from "@/components/ui/address";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { ALLOWANCE_ABI, ERROR_TEXT } from "@/lib/abi";
import { config, deploymentEvidence } from "@/lib/config";
import { gateway, solvePow, type Challenge, type DemoStatus, type GatewayConfig, type GatewayStats, type RunResult, type RunStep, type Scenario } from "@/lib/gateway";
import { useWallet } from "@/lib/wallet";
import { cn, fmtUsdc } from "@/lib/utils";
import { Barrier, type GateState } from "./barrier";

type Run = { id: number; scenario: Scenario; at: string; result: RunResult | null; error?: string; unknown?: boolean; notSent?: boolean };
type Phase = "idle" | "solving" | "running";

const SCENARIOS: { id: Scenario; title: string; verb: string; blurb: string }[] = [
  { id: "allowed", title: "Paid call", verb: "Run the paid call", blurb: "Request, receive a 402, pay through the contract, wait for confirmations and receive live block data." },
  { id: "replay", title: "Replay", verb: "Run the replay", blurb: "Re-present the last proof (stored response, no second charge) and try to pay the same request ID again (refused by the contract)." },
  { id: "over-cap", title: "Over-cap payment", verb: "Run the over-cap payment", blurb: "Try to pay one base unit more than the per-call limit. The contract reverts with CapExceeded." },
  { id: "unauthorized-merchant", title: "Unlisted merchant (simulation)", verb: "Run the simulation", blurb: "Asks the contract, with a read-only eth_call, to pay a merchant the owner never allowed. It reverts with MerchantNotAllowed. No transaction, no gas." },
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

const PHASE_TEXT: Record<Exclude<Phase, "idle">, string> = {
  solving: "Solving a short puzzle. It keeps scripts from draining the demo wallet, and takes a second or two.",
  running: "Running on the gateway. Paid runs wait for chain confirmations, about 10 to 30 seconds.",
};

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

function stepText(s: RunStep): string {
  const d = s.detail as any;
  return d?.name ? ERROR_TEXT[d.name] ?? d.name : d?.why ? `${d.why}, ${d.confirmations} confirmation(s), ${d.elapsedSeconds}s elapsed` : d?.note ?? (typeof d === "string" ? d : d?.status ? `HTTP ${d.status}` : "");
}
const outcome = (s: RunStep) => (s.ok ? (s.step === "pending" ? { word: "Pending", cls: "text-warn" } : { word: "Passed", cls: "text-success" }) : { word: "Refused", cls: "text-danger" });

/** What the barrier should show for a finished run. It lifts only on a real, successful "delivered" step and no refusal. */
function gateFor(r: Run | undefined): { state: GateState; refusal?: string } {
  if (!r) return { state: "idle" };
  if (r.unknown || r.notSent) return { state: "idle" };
  if (r.error) return { state: "refused" };
  const steps = r.result?.steps ?? [];
  const bad = steps.find((s) => !s.ok);
  if (bad) return { state: "refused", refusal: (bad.detail as any)?.name };
  if (steps.some((s) => s.step === "delivered" && s.ok)) return { state: "lifted" };
  return { state: "idle" };
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [demo, setDemo] = useState<DemoStatus | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Scenario>("allowed");

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
    setProbeError(r.ok ? null : r.status === 429 ? "The gateway is rate limiting this connection. Try again in a minute." : r.error === "payments_disabled" ? "This gateway is not accepting payments." : `No quote came back (${r.error}). Nothing was charged.`);
    setProbing(false);
  }

  async function run(s: Scenario) {
    setRunning(s);
    const push = (result: RunResult | null, error?: string, unknown = false, notSent = false) => setRuns((x) => [{ id: Date.now(), scenario: s, at: new Date().toLocaleTimeString(), result, error, unknown, notSent }, ...x]);
    try {
      setPhase("solving");
      const ch = await gateway.demoChallenge();
      if (!ch.ok) return push(null, ch.status === undefined ? "The gateway did not answer. Nothing was sent; try again." : explain(ch.error, ch.body), false, true);
      const nonce = await solvePow(ch.data.token, ch.data.bits);
      setPhase("running");
      const r = await gateway.run(s, `${ch.data.token}.${nonce}`);
      if (r.ok) return push(r.data);
      // A lost answer or a server error after the run started is not a refusal: the agent may have paid.
      const lost = r.status === undefined || r.status < 400 || (r.status >= 500 && r.error !== "demo_funds_low");
      push(null, lost ? `No usable answer came back (${r.error}). The run may still have sent a transaction; check the demo account's history on the explorer before running it again.` : explain(r.error, r.body), lost);
    } finally { setRunning(null); setPhase("idle"); load(); }
  }

  const demoOk = !!cfg?.demoEnabled && !down && !(demo?.enabled && (demo.txBudgetRemaining === 0 || demo.agentGasOk === false));
  const latest = runs[0];
  const gate = running ? { state: "working" as GateState } : gateFor(latest);
  const sel = SCENARIOS.find((s) => s.id === selected)!;
  const runningTitle = SCENARIOS.find((s) => s.id === running)?.title;

  const caption = running ? <>Barrier down. {runningTitle} in progress.</>
    : gate.state === "lifted" ? <><b className="text-success">Barrier up.</b> The gateway verified the payment on-chain and delivered the resource.</>
    : gate.state === "refused" ? <><b className="text-danger">Barrier stays down.</b> {gate.refusal ? <>The contract reverted with <span className="font-mono">{gate.refusal}</span>.</> : latest?.error ?? "The run was refused."}</>
    : latest?.notSent ? <><b>Not started.</b> {latest.error}</>
    : latest?.unknown ? <><b className="text-warn">Outcome unknown.</b> {latest.error}</>
    : <>Barrier down. Choose a scenario and run it; the barrier lifts only if the real gateway delivers.</>;

  return (
    <div className="container py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="kicker mb-3">Playground, live on QIE Mainnet</p>
        <h1 className="h-section">Watch an agent pay for an API, and get refused.</h1>
        <p className="lead mt-4">Live gateway, live contract, QIE Mainnet.</p>
      </div>

      {/* Gate status and the limits posted for the demo account */}
      <div className="mt-10 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section aria-labelledby="gw-h" className="rounded-[10px] border bg-card p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="gw-h" className="h-card">Gateway</h2>
            {loading ? <Skeleton className="h-6 w-24" /> : down ? <Badge tone="danger">Unavailable</Badge> : <Badge tone="success"><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />Reachable</Badge>}
          </div>
          {loading ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i}><Skeleton className="h-4 w-28" /><Skeleton className="mt-2 h-5 w-40 max-w-full" /></div>)}</div>
          ) : down ? (
            <div role="alert" className="mt-4 flex gap-3 rounded-md border border-danger/50 p-4 text-sm text-danger">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p>The gateway at <span className="break-all font-mono">{config.gatewayUrl}</span> did not respond ({down}). Nothing below can run until it is back. No results are simulated.</p>
                <Button variant="secondary" className="mt-3" onClick={() => { setLoading(true); load(); }}>Check again</Button>
              </div>
            </div>
          ) : (
            <dl className="mt-4 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2"><dt className="text-muted-foreground">Endpoint</dt><dd className="mt-0.5 break-all font-mono text-[13px]">GET {config.gatewayUrl.replace("https://", "")}/v1/block-summary</dd></div>
              <div><dt className="text-muted-foreground">Price per call</dt><dd className="num mt-0.5">{cfg ? `${fmtUsdc(cfg.priceBase)} QUSDC` : "…"} ({cfg?.priceBase} base units)</dd></div>
              <div><dt className="text-muted-foreground">Confirmations required</dt><dd className="num mt-0.5">{cfg?.confirmations}</dd></div>
              <div className="sm:col-span-2"><dt className="text-muted-foreground">Calls delivered (all time on this gateway)</dt><dd className="num mt-0.5">{stats ? `${stats.delivered} (${stats.deliveredExternal} from addresses we do not control)` : "…"}</dd></div>
            </dl>
          )}
        </section>
        <section aria-labelledby="lim-h" className="rounded-[10px] border bg-card p-5 sm:p-6">
          <h2 id="lim-h" className="h-card">Demo account limits</h2>
          <p className="mt-1 text-sm text-muted-foreground">Read from the contract just now.</p>
          {!limits ? (
            <div className="mt-4 space-y-2.5" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="flex justify-between"><Skeleton className="h-4 w-28" /><Skeleton className="h-4 w-20" /></div>)}</div>
          ) : (
            <dl className="mt-4 space-y-2 text-sm">
              {([["Per-call limit", limits.perCall], ["Daily limit", limits.daily], ["Spent today (UTC)", limits.spent], ["Remaining balance", limits.balance]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-dashed pb-2 last:border-b-0"><dt className="text-muted-foreground">{k}</dt><dd className="num font-medium">{fmtUsdc(v)} QUSDC</dd></div>
              ))}
            </dl>
          )}
          <p className="mt-4 text-sm text-muted-foreground">Owner <Address value={deploymentEvidence.deployer_owner} />. When the daily limit is reached, further paid calls are refused by the contract until the next UTC day.</p>
        </section>
      </div>

      {/* Step 1: the unpaid request */}
      <section aria-labelledby="probe-h" className="mt-4 rounded-[10px] border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 id="probe-h" className="h-card">1. See the payment requirements</h2>
            <p className="mt-1 text-sm text-muted-foreground">An unpaid request to the real endpoint. Free, sends no transaction.</p>
          </div>
          <Button variant="secondary" onClick={probe} loading={probing} disabled={!!down}>{probing ? "Requesting…" : "Request without paying"}</Button>
        </div>
        {probeError && <p role="alert" className="mt-4 text-sm text-danger">{probeError}</p>}
        {challenge && <div className="mt-4"><CodeBlock lang="json" title="HTTP 402 from the gateway" code={JSON.stringify(challenge, null, 2)} /></div>}
      </section>

      {/* Step 2: the toll lane */}
      <section aria-labelledby="lane-h" className="mt-4 rounded-[10px] border bg-card">
        <div className="border-b p-5 sm:p-6">
          <h2 id="lane-h" className="h-card">2. Run the scripted agent through the lane</h2>
          <p className="mt-1 text-sm text-muted-foreground">Real mainnet transactions, within the demo account&apos;s on-chain limits.</p>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <div className="space-y-4 p-5 sm:p-6 lg:border-r">
            <fieldset disabled={!!running}>
              <legend className="text-sm font-semibold">Scenario</legend>
              <div className="mt-2 space-y-2">
                {SCENARIOS.map((s) => (
                  <label key={s.id} className={cn("flex cursor-pointer gap-3 rounded-md border p-3 transition-colors duration-150 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring", selected === s.id ? "border-foreground" : "[@media(hover:hover)]:hover:border-foreground/50")}>
                    <input type="radio" name="scenario" value={s.id} checked={selected === s.id} onChange={() => setSelected(s.id)} className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--foreground))]" />
                    <span className="min-w-0"><span className="block text-sm font-semibold">{s.title}</span><span className="mt-0.5 block text-sm leading-relaxed text-muted-foreground">{s.blurb}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button size="lg" className="w-full sm:w-auto" disabled={!demoOk || !!running} loading={!!running} onClick={() => run(selected)}>
              {running ? (phase === "solving" ? "Solving puzzle…" : "Running on the gateway…") : sel.verb}
            </Button>
            {!demoOk && !loading && <p className="text-sm text-muted-foreground">{down ? "The gateway is unavailable, so runs cannot start. Use Check again above." : demo?.enabled && demo.txBudgetRemaining === 0 ? "Today's demo budget is used up." : demo?.enabled && demo.agentGasOk === false ? "The demo agent is out of gas." : "The demo agent is not enabled on this gateway."}</p>}
            <div role="note" className="flex gap-2.5 rounded-md border border-warn/50 p-3 text-sm leading-relaxed">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden />
              <span>Real transactions, real QUSDC (0.001 per paid call) and QIE gas. Failed attempts are broadcast too, so they have explorer links. Runs can take 10 to 30 seconds.</span>
            </div>
            {demo?.enabled && (
              <p className="text-sm leading-relaxed text-muted-foreground" aria-live="polite">
                Demo limits: {demo.perIpHour} runs per hour and {demo.perIpDay} per day per visitor, and {demo.txBudgetRemaining} of {demo.txBudget} transactions left in today&apos;s shared budget.
                {demo.agentGasOk === false && " The demo agent is out of gas, so runs are paused until it is topped up."}
                {demo.txBudgetRemaining === 0 && " Today's budget is used up; try again tomorrow, or fund your own account in the app."}
              </p>
            )}
            <p className="text-sm text-muted-foreground">To see revocation, fund your own account in the <a className="link" href="/app">app</a>, authorise an agent, then revoke it. A recorded mainnet revoke is on the <a className="link" href="/evidence">evidence</a> page.</p>
          </div>

          <div className="min-w-0 border-t p-5 sm:p-6 lg:border-t-0">
            <Lane phase={phase} running={running} latest={running ? undefined : latest} />
            <div className="mt-6 border-t pt-6">
              <Barrier state={gate.state} caption={caption} />
            </div>
          </div>
        </div>
      </section>

      {/* What this session has actually observed */}
      <section aria-labelledby="journey-h" className="mt-4 rounded-[10px] border bg-card p-5 sm:p-6">
        <h2 id="journey-h" className="h-card">Seen in this session</h2>
        <p className="mt-1 text-sm text-muted-foreground">A step is marked seen only after the real gateway or contract produced it in this session.</p>
        <ol className="mt-4 grid gap-x-6 sm:grid-cols-2">
          {STAGES.map((s, i) => (
            <li key={s} className="flex items-baseline justify-between gap-3 border-b border-dashed py-2.5 text-sm">
              <span className={states[i] === "done" ? "" : "text-muted-foreground"}>{s}</span>
              <span className={cn("shrink-0 font-semibold", states[i] === "done" ? "text-success" : "text-muted-foreground")}>{states[i] === "done" ? "Seen" : "Not yet"}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Receipts */}
      <section aria-labelledby="log-h" className="mt-10">
        <h2 id="log-h" className="h-card">Run receipts</h2>
        <p className="mt-1 text-sm text-muted-foreground">Exactly what the gateway returned.</p>
        {runs.length === 0 ? (
          <p className="mt-4 rounded-[10px] border border-dashed p-6 text-sm text-muted-foreground">No runs yet. Choose a scenario in the lane above and run it; each result is printed here with explorer links. Nothing is pre-filled.</p>
        ) : (
          <ul className="mt-4 grid gap-4 lg:grid-cols-2" aria-live="polite">
            {runs.map((r) => <Receipt key={r.id} r={r} />)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Lane({ phase, running, latest }: { phase: Phase; running: Scenario | null; latest: Run | undefined }) {
  const steps = latest?.result?.steps ?? [];
  type Item = { key: string; title: string; word: string; cls: string; text?: string; name?: string; hash?: string; current?: boolean };
  const items: Item[] = [];
  if (running) {
    items.push({ key: "pow", title: "Anti-abuse puzzle", word: phase === "solving" ? "Solving" : "Solved", cls: phase === "solving" ? "text-warn" : "text-success", text: phase === "solving" ? PHASE_TEXT.solving : undefined, current: phase === "solving" });
    if (phase === "running") items.push({ key: "run", title: "Gateway run", word: "In progress", cls: "text-warn", text: PHASE_TEXT.running, current: true });
  } else if (latest) {
    items.push({ key: "pow", title: "Anti-abuse puzzle", word: latest.result || !latest.error || latest.unknown ? "Solved" : latest.notSent ? "Not started" : "Not accepted", cls: latest.result || !latest.error || latest.unknown ? "text-success" : "text-danger" });
    steps.forEach((s, i) => {
      const o = outcome(s);
      items.push({ key: `s${i}`, title: s.step, word: o.word, cls: o.cls, text: stepText(s) || undefined, name: (s.detail as any)?.name, hash: s.txHash });
    });
    if (latest.error) items.push({ key: "err", title: "Gateway answer", word: latest.notSent ? "Not started" : latest.unknown ? "Unknown" : "Refused", cls: latest.notSent ? "text-muted-foreground" : latest.unknown ? "text-warn" : "text-danger", text: latest.error });
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">The lane</h3>
        {latest && !running && <span className="text-sm text-muted-foreground">{SCENARIOS.find((s) => s.id === latest.scenario)?.title}, {latest.at}</span>}
      </div>
      {items.length === 0 ? (
        <div className="mt-4">
          <div className="lane-line" aria-hidden />
          <p className="mt-3 text-sm text-muted-foreground">Empty lane. Each step the gateway returns will appear here in order.</p>
        </div>
      ) : (
        <ol className="relative mt-4 space-y-4 pl-7" aria-live="polite">
          <span className="lane-line-v absolute bottom-2 left-[7px] top-2" aria-hidden />
          {items.map((it) => (
            <li key={it.key} className="relative min-w-0">
              <span className={cn("absolute -left-7 top-1 h-4 w-4 rounded-sm border-2 bg-card", it.word === "Refused" || it.word === "Not accepted" ? "border-danger" : it.current ? "border-warn" : "border-foreground")} aria-hidden />
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-sm font-semibold">{it.title}</span>
                <span className={cn("flex items-center gap-1.5 text-sm font-semibold", it.cls)}>
                  {it.current && <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-current" aria-hidden />}{it.word}
                </span>
              </div>
              {it.text && <p className="mt-0.5 text-sm text-muted-foreground">{it.text}</p>}
              {it.name && <p className="mt-0.5 font-mono text-xs text-danger">{it.name}</p>}
              {it.hash && <div className="mt-1"><Address value={it.hash} kind="tx" /></div>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Receipt({ r }: { r: Run }) {
  const g = gateFor(r);
  const word = g.state === "lifted" ? { t: "Delivered", c: "text-success" } : g.state === "refused" ? { t: "Refused", c: "text-danger" } : r.notSent ? { t: "Not started", c: "text-muted-foreground" } : r.unknown ? { t: "Outcome unknown", c: "text-warn" } : { t: "No delivery", c: "text-muted-foreground" };
  return (
    <li className="ticket min-w-0 p-4 sm:p-5" style={{ ["--notch-y" as string]: "52px" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{SCENARIOS.find((s) => s.id === r.scenario)?.title}</p>
        <p className={cn("text-sm font-semibold", word.c)}>{word.t}</p>
      </div>
      <p className="num mt-0.5 text-sm text-muted-foreground">Run at {r.at}</p>
      <div className="perforation my-3" aria-hidden />
      {r.error && <p role="alert" className="flex items-start gap-2 text-sm text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{r.error}</p>}
      {r.result && (
        <ol className="space-y-2 text-sm">
          {r.result.steps.map((s, i) => {
            const o = outcome(s);
            const text = stepText(s);
            const name = (s.detail as any)?.name;
            return (
              <li key={i} className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{s.step}</span>
                  <span className={cn("font-semibold", o.cls)}>{o.word}</span>
                </div>
                {text && <p className="text-muted-foreground">{text}{name && <span className="ml-1 font-mono text-xs">{name}</span>}</p>}
                {s.txHash && <Address value={s.txHash} kind="tx" />}
              </li>
            );
          })}
        </ol>
      )}
      {r.result?.data && <><div className="perforation my-3" aria-hidden /><p className="text-sm text-muted-foreground">Delivered: block {r.result.data.blockNumber} at {new Date(r.result.data.timestamp * 1000).toISOString()}, {r.result.data.txCount} transactions, read live from the QIE RPC.</p></>}
    </li>
  );
}
