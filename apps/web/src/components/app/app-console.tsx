"use client";

import { useEffect, useMemo, useState } from "react";
import { Contract, type Signer } from "ethers";
import { AlertTriangle, PauseCircle, PlayCircle, RefreshCw, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Address } from "@/components/ui/address";
import { Badge, StatusPill } from "@/components/ui/badge";
import { WalletButton } from "@/components/site/wallet-button";
import { ALLOWANCE_ABI, ERC20_ABI } from "@/lib/abi";
import { config } from "@/lib/config";
import { useAllowance, type HistoryItem } from "@/lib/useAllowance";
import { useWallet } from "@/lib/wallet";
import { cn, fmtUsdc, parseUsdc, ZERO } from "@/lib/utils";
import { isHexAddress } from "@/lib/address";
import { toast } from "sonner";
import { useTxFlow, type TxRequest } from "./tx-flow";
import { QieIdentityHint } from "./qie-identity-hint";

const VAULT = { to: config.allowance, contractName: "Vault" };
const TOKEN = { to: config.qusdc, contractName: "QUSDC token" };
const vault = (s: Signer) => new Contract(config.allowance, ALLOWANCE_ABI as unknown as string[], s);
const token = (s: Signer) => new Contract(config.qusdc, ERC20_ABI as unknown as string[], s);

/** Inputs follow the 40px control height and 16px text on mobile (no iOS zoom). */
const INPUT = "h-10 rounded-md text-base sm:text-sm";

const LABELS: Record<string, (a: Record<string, string>) => string> = {
  Deposited: (a) => `Deposited ${fmtUsdc(a.amount)} QUSDC`,
  Withdrawn: (a) => `Withdrew ${fmtUsdc(a.amount)} QUSDC`,
  PolicySet: (a) => `Policy set: per-call ${fmtUsdc(a.perCallCap)}, daily ${fmtUsdc(a.dailyCap)} QUSDC`,
  MerchantSet: (a) => `Merchant ${a.allowed === "true" ? "allowed" : "removed"}`,
  AgentRevoked: () => "Agent revoked",
  PausedSet: (a) => (a.paused === "true" ? "Account paused" : "Account unpaused"),
  Paid: (a) => `Agent paid ${fmtUsdc(a.amount)} QUSDC`,
};

type FormKey = "amt" | "agent" | "pc" | "dc" | "m";
const focus = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

function Panel({ id, title, description, children, className }: { id?: string; title: string; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-h` : undefined} className={cn("scroll-mt-24 rounded-[10px] border bg-card p-5 sm:p-6", className)}>
      <h2 id={id ? `${id}-h` : undefined} className="h-card">{title}</h2>
      {description && <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Q({ v, className }: { v: bigint; className?: string }) {
  return <span className={cn("num", className)} title={`${v.toString()} base units`}>{fmtUsdc(v)} <span className="text-[0.7em] font-medium text-muted-foreground">QUSDC</span></span>;
}

export function AppConsole() {
  const w = useWallet();
  const { snap, history, merchants, error, loading, refresh } = useAllowance();
  const tx = useTxFlow(refresh);
  const [amount, setAmount] = useState("");
  const [agent, setAgent] = useState("");
  const [perCall, setPerCall] = useState("");
  const [daily, setDaily] = useState("");
  const [merchant, setMerchant] = useState(config.merchant);
  const [touched, setTouched] = useState(false);
  const [errs, setErrs] = useState<Partial<Record<FormKey, string>>>({});
  const [pending, setPending] = useState<string | null>(null);

  // Forms belong to the connected account: switching wallets must not carry one owner's values into another's.
  useEffect(() => {
    setAmount(""); setAgent(""); setPerCall(""); setDaily(""); setMerchant(config.merchant); setTouched(false); setErrs({});
  }, [w.address]);

  // Prefill the policy form once with the current on-chain values.
  useEffect(() => {
    if (snap && !touched) {
      setAgent(snap.account.agent === ZERO ? "" : snap.account.agent);
      setPerCall(snap.account.perCallCap > 0n ? fmtUsdc(snap.account.perCallCap) : "0.01");
      setDaily(snap.account.dailyCap > 0n ? fmtUsdc(snap.account.dailyCap) : "0.05");
    }
  }, [snap, touched]);

  const amt = useMemo(() => parseUsdc(amount), [amount]);
  const blocked = !w.address || w.wrongNetwork;

  if (!w.address) {
    return (
      <section className="max-w-2xl rounded-[10px] border bg-card p-6 sm:p-8">
        <h1 className="h-section">Connect your wallet to open the console</h1>
        <p className="lead mt-4">Fund an allowance and post the limits your agent must obey.</p>
        <div className="mt-6"><WalletButton size="md" /></div>
        {!w.hasProvider && <p role="status" className="mt-4 text-sm text-warn">No injected wallet detected in this browser. Install QIE Wallet or a MetaMask-compatible wallet, then reload this page.</p>}
      </section>
    );
  }

  const a = snap?.account;
  const depositErr = amount && !amt ? "Enter a number with up to 6 decimals." : amt && snap && amt > snap.walletQusdc ? "More than your wallet QUSDC balance." : amt && snap && a && a.balance + amt > snap.depositCap ? `Over the per-account deposit cap of ${fmtUsdc(snap.depositCap)} QUSDC.` : undefined;
  const needsApproval = !!(amt && snap && snap.allowanceToVault < amt);

  const agentErr = agent && !isHexAddress(agent) ? "Enter a full 0x address (40 hexadecimal characters, correct checksum)." : undefined;
  const pc = parseUsdc(perCall), dc = parseUsdc(daily);
  const policyErr = (perCall && !pc) || (daily && !dc) ? "Limits must be numbers with up to 6 decimals." : pc && dc && pc > dc ? "The per-call limit is above the daily limit, so the daily limit would never be reached." : undefined;
  const merchErr = merchant && !isHexAddress(merchant) ? "Enter a full 0x address (40 hexadecimal characters, correct checksum)." : undefined;

  const setErr = (k: FormKey, v?: string) => setErrs((e) => ({ ...e, [k]: v }));
  /** Runs one transaction request while its button shows a spinner. The tx flow itself guards the network and confirms. */
  const go = async (key: string, r: TxRequest) => {
    setPending(key);
    try { await tx.run(r); } finally { setPending(null); }
  };

  const cleared = () => setAmount("");
  const synced = () => setTouched(false); // the policy form shows the chain again

  const deposit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const err = !amount.trim() ? "Enter an amount to deposit." : depositErr;
    if (err || !amt) { setErr("amt", err ?? "Enter an amount to deposit."); focus("amt"); return; }
    setErr("amt");
    go("deposit", needsApproval
      ? { ...TOKEN, title: "Approve QUSDC", summary: <>Allow the vault <span className="break-all font-mono text-xs">{config.allowance}</span> to pull exactly <b>{fmtUsdc(amt)} QUSDC</b> from your wallet. This does not move funds yet.</>, estimate: (s) => token(s).approve.estimateGas(config.allowance, amt), tx: (s) => token(s).approve.populateTransaction(config.allowance, amt) }
      : { ...VAULT, title: "Deposit", onConfirmed: cleared, summary: <>Deposit <b>{fmtUsdc(amt)} QUSDC</b> into your allowance.</>, estimate: (s) => vault(s).deposit.estimateGas(amt), tx: (s) => vault(s).deposit.populateTransaction(amt) });
  };

  const withdraw = () => {
    const err = !amount.trim() ? "Enter an amount to withdraw." : !amt ? "Enter a number with up to 6 decimals." : !a ? "Your account is still loading. Try again in a moment." : amt > a.balance ? `Withdraw is limited to your allowance balance of ${fmtUsdc(a.balance)} QUSDC.` : undefined;
    if (err || !amt) { setErr("amt", err); focus("amt"); return; }
    setErr("amt");
    go("withdraw", { ...VAULT, title: "Withdraw", onConfirmed: cleared, summary: <>Withdraw <b>{fmtUsdc(amt)} QUSDC</b> from your allowance back to your wallet.</>, estimate: (s) => vault(s).withdraw.estimateGas(amt), tx: (s) => vault(s).withdraw.populateTransaction(amt) });
  };

  const savePolicy = (e: React.FormEvent) => {
    e.preventDefault();
    const ae = !agent ? "Enter the agent address." : agentErr;
    const pe = !perCall.trim() ? "Enter a per-call limit." : undefined;
    const de = !daily.trim() ? "Enter a daily limit." : undefined;
    setErrs((x) => ({ ...x, agent: ae, pc: pe, dc: de }));
    if (ae) return focus("agent");
    if (pe) return focus("pc");
    if (de) return focus("dc");
    if (policyErr || !pc || !dc) return focus("pc");
    go("policy", { ...VAULT, title: "Set policy", onConfirmed: synced, summary: <>Authorise <span className="break-all font-mono text-xs">{agent}</span> with a per-call limit of <b>{fmtUsdc(pc)}</b> and a daily limit of <b>{fmtUsdc(dc)} QUSDC</b>.</>, estimate: (s) => vault(s).setPolicy.estimateGas(agent, pc, dc), tx: (s) => vault(s).setPolicy.populateTransaction(agent, pc, dc) });
  };

  const setMerchantAllowed = (allowed: boolean) => {
    const err = !merchant ? "Enter the merchant address." : merchErr;
    if (err) { setErr("m", err); focus("m"); return; }
    setErr("m");
    go(allowed ? "allow" : "remove", allowed
      ? { ...VAULT, title: "Allow merchant", summary: <>Allow payments to <span className="break-all font-mono text-xs">{merchant}</span>.</>, estimate: (s) => vault(s).setMerchant.estimateGas(merchant, true), tx: (s) => vault(s).setMerchant.populateTransaction(merchant, true) }
      : { ...VAULT, title: "Remove merchant", summary: <>Stop allowing payments to <span className="break-all font-mono text-xs">{merchant}</span>.</>, estimate: (s) => vault(s).setMerchant.estimateGas(merchant, false), tx: (s) => vault(s).setMerchant.populateTransaction(merchant, false) });
  };

  const allowed = Object.entries(merchants).filter(([, ok]) => ok);
  const busy = !!pending;

  return (
    <div className="space-y-6">
      {tx.dialog}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="h-section">Your gate</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">Owner <Address value={w.address} /></span>
            {w.wrongNetwork ? <Badge tone="danger">Wrong network</Badge> : <Badge tone="accent">QIE Mainnet</Badge>}
          </p>
        </div>
        <Button variant="secondary" onClick={refresh} loading={loading && !!snap}>
          {!(loading && snap) && <RefreshCw className="h-4 w-4" aria-hidden />}{loading && snap ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {w.wrongNetwork && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-danger/50 bg-card p-4 text-sm">
          <span className="flex items-start gap-2 text-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />Your wallet is on the wrong network. Nothing will be sent until you switch to QIE Mainnet (1990).</span>
          <Button variant="danger" onClick={() => w.switchNetwork().catch((e) => toast.error(e?.code === 4001 ? "Network switch was rejected in your wallet." : e?.message ?? "Could not switch network"))}>Switch network</Button>
        </div>
      )}
      {error && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-warn/50 bg-card p-4 text-sm">
          <span className="flex items-start gap-2 text-warn"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</span>
          <Button variant="secondary" onClick={refresh} loading={loading}>Try again</Button>
        </div>
      )}

      <GatePanel snap={snap} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel id="fund" title="Fund or withdraw" description="Withdraw at any time, even while paused.">
          <form noValidate onSubmit={deposit} className="space-y-4">
            <Field label="Amount (QUSDC)" htmlFor="amt" error={errs.amt ?? depositErr} hint="1 QUSDC = 1,000,000 base units">
              <Input id="amt" name="amount" className={cn(INPUT, "num")} inputMode="decimal" autoComplete="off" spellCheck={false} placeholder="0.05…" value={amount}
                onChange={(e) => { setAmount(e.target.value); setErr("amt"); }} aria-invalid={!!(errs.amt ?? depositErr)} aria-describedby={errs.amt ?? depositErr ? "amt-err" : undefined} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={pending === "deposit"} disabled={busy && pending !== "deposit"}>
                {pending === "deposit" ? (needsApproval ? "Preparing approval…" : "Preparing deposit…") : needsApproval ? "Step 1: approve QUSDC" : amt ? `Deposit ${fmtUsdc(amt)} QUSDC` : "Deposit"}
              </Button>
              <Button type="button" variant="secondary" loading={pending === "withdraw"} disabled={busy && pending !== "withdraw"} onClick={withdraw}>
                {pending === "withdraw" ? "Preparing withdrawal…" : "Withdraw"}
              </Button>
              <Button type="button" variant="ghost" className="h-10" loading={pending === "withdraw-all"} disabled={(busy && pending !== "withdraw-all") || !a || a.balance === 0n}
                onClick={() => a && go("withdraw-all", { ...VAULT, title: "Withdraw all", onConfirmed: cleared, summary: <>Withdraw your entire allowance of <b>{fmtUsdc(a.balance)} QUSDC</b>.</>, estimate: (s) => vault(s).withdraw.estimateGas(a.balance), tx: (s) => vault(s).withdraw.populateTransaction(a.balance) })}>
                Withdraw all
              </Button>
            </div>
            {needsApproval && <p className="text-sm text-muted-foreground">Step 1 approves the amount. After it confirms, the button becomes Deposit.</p>}
            {a && a.balance === 0n && <p className="text-sm text-muted-foreground">Withdraw all is unavailable because your allowance balance is 0 QUSDC.</p>}
          </form>
        </Panel>

        <Panel id="policy" title="Agent and spending limits" description="One agent key. The contract enforces both limits.">
          <form noValidate onSubmit={savePolicy} className="space-y-4">
            <Field label="Authorised agent address" htmlFor="agent" error={errs.agent ?? agentErr}>
              <Input id="agent" name="agent" className={cn(INPUT, "font-mono")} autoComplete="off" spellCheck={false} placeholder="0x…" value={agent}
                onChange={(e) => { setTouched(true); setAgent(e.target.value.trim()); setErr("agent"); }} aria-invalid={!!(errs.agent ?? agentErr)} aria-describedby={errs.agent ?? agentErr ? "agent-err" : undefined} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Per-call limit (QUSDC)" htmlFor="pc" error={errs.pc}>
                <Input id="pc" name="perCall" className={cn(INPUT, "num")} inputMode="decimal" autoComplete="off" placeholder="0.01…" value={perCall}
                  onChange={(e) => { setTouched(true); setPerCall(e.target.value); setErr("pc"); }} aria-invalid={!!errs.pc || !!policyErr} aria-describedby={errs.pc ? "pc-err" : policyErr ? "policy-err" : undefined} />
              </Field>
              <Field label="Daily limit (QUSDC)" htmlFor="dc" error={errs.dc}>
                <Input id="dc" name="daily" className={cn(INPUT, "num")} inputMode="decimal" autoComplete="off" placeholder="0.05…" value={daily}
                  onChange={(e) => { setTouched(true); setDaily(e.target.value); setErr("dc"); }} aria-invalid={!!errs.dc || !!policyErr} aria-describedby={errs.dc ? "dc-err" : policyErr ? "policy-err" : undefined} />
              </Field>
            </div>
            {policyErr && <p id="policy-err" role="alert" className="text-sm text-danger">{policyErr}</p>}
            <p className="text-sm text-muted-foreground">Days are UTC: up to twice the limit can pass across midnight.</p>
            <Button type="submit" loading={pending === "policy"} disabled={busy && pending !== "policy"}>{pending === "policy" ? "Preparing policy…" : "Save policy"}</Button>
          </form>
        </Panel>

        <Panel id="merchants" title="Merchant allowlist" description="Only these addresses can be paid.">
          <form noValidate onSubmit={(e) => { e.preventDefault(); setMerchantAllowed(true); }} className="space-y-4">
            <Field label="Merchant address" htmlFor="m" error={errs.m ?? merchErr}>
              <Input id="m" name="merchant" className={cn(INPUT, "font-mono")} autoComplete="off" spellCheck={false} value={merchant} placeholder="0x…"
                onChange={(e) => { setMerchant(e.target.value.trim()); setErr("m"); }} aria-invalid={!!(errs.m ?? merchErr)} aria-describedby={errs.m ?? merchErr ? "m-err" : undefined} />
            </Field>
            <QieIdentityHint address={merchant} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={pending === "allow"} disabled={busy && pending !== "allow"}>{pending === "allow" ? "Preparing…" : "Allow merchant"}</Button>
              <Button type="button" variant="secondary" loading={pending === "remove"} disabled={busy && pending !== "remove"} onClick={() => setMerchantAllowed(false)}>{pending === "remove" ? "Preparing…" : "Remove merchant"}</Button>
            </div>
          </form>
          <div className="mt-6">
            <h3 className="text-sm font-semibold">On your allowlist</h3>
            {!history ? (
              <div className="mt-2 space-y-2" aria-hidden><Skeleton className="h-10 w-full rounded-md" /></div>
            ) : allowed.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">No merchants yet. Allow the demo merchant (<span className="font-mono">{config.merchant.slice(0, 8)}…</span>, already in the field above) so the demo agent can pay.</p>
            ) : (
              <ul className="mt-2 divide-y rounded-md border">{allowed.map(([m]) => <li key={m} className="flex min-h-10 items-center justify-between gap-2 px-3 py-1.5 text-sm"><Address value={m} /><span className="text-success">Allowed</span></li>)}</ul>
            )}
          </div>
        </Panel>

        <Panel id="emergency" title="Emergency controls" description="Pause blocks payments, never withdrawals. Revoke removes the agent.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
              <p className="text-sm">{!a ? "Reading pause state…" : a.paused ? <>Agent payments are <b>paused</b>.</> : <>Agent payments are <b>allowed</b>.</>}</p>
              <Button variant="secondary" loading={pending === "pause"} disabled={!a || (busy && pending !== "pause")}
                onClick={() => a && go("pause", { ...VAULT, title: a.paused ? "Unpause" : "Pause", summary: a.paused ? <>Allow the agent to pay again.</> : <>Block all agent payments for your account. You can still withdraw.</>, estimate: (s) => vault(s).setPaused.estimateGas(!a.paused), tx: (s) => vault(s).setPaused.populateTransaction(!a.paused) })}>
                {pending !== "pause" && (a?.paused ? <PlayCircle className="h-4 w-4" aria-hidden /> : <PauseCircle className="h-4 w-4" aria-hidden />)}{a?.paused ? "Unpause account" : "Pause account"}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-danger/40 p-3">
              <p className="text-sm">{!a ? "Reading agent…" : a.agent === ZERO ? "No agent is authorised, so there is nothing to revoke." : <>Revoking makes the agent&apos;s next payment revert with NotOwnerAgent.</>}</p>
              <Button variant="danger" loading={pending === "revoke"} disabled={!a || a.agent === ZERO || (busy && pending !== "revoke")}
                onClick={() => go("revoke", { ...VAULT, title: "Revoke agent", onConfirmed: synced, summary: <>Remove the authorised agent. Its next payment will revert with NotOwnerAgent. You can authorise an agent again later.</>, estimate: (s) => vault(s).revokeAgent.estimateGas(), tx: (s) => vault(s).revokeAgent.populateTransaction() })}>
                {pending !== "revoke" && <ShieldOff className="h-4 w-4" aria-hidden />}Revoke agent
              </Button>
            </div>
            {blocked && w.wrongNetwork && <p className="text-sm text-danger">Switch to QIE Mainnet before using these controls.</p>}
          </div>
        </Panel>
      </div>

      <section aria-labelledby="activity-h">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="activity-h" className="h-card">Receipts</h2>
            <p className="mt-1 text-sm text-muted-foreground">Read from the chain.</p>
          </div>
        </div>
        <div className="ticket mt-4 px-4 py-2 sm:px-6" style={{ ["--notch-y" as string]: "28px" }}>
          {tx.session.length > 0 && (
            <ul aria-label="This session" aria-live="polite">
              {tx.session.map((t) => (
                <li key={t.id} className="border-b border-dashed last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 text-sm">
                    <span className="font-semibold">{t.title}</span>
                    <span className="flex flex-wrap items-center gap-3">
                      <StatusPill status={t.status} />
                      {t.status === "failed" && t.req && <Button size="sm" variant="secondary" className="h-10" onClick={() => tx.retry(t)}>Retry</Button>}
                      {t.status === "unknown" && <Button size="sm" variant="secondary" className="h-10" onClick={() => void tx.recheck(t)}>Check again</Button>}
                      {t.hash && <Address value={t.hash} kind="tx" />}
                    </span>
                  </div>
                  {t.note && <p className={cn("-mt-1 pb-3 text-sm", t.status === "unknown" ? "text-warn" : "text-danger")}>{t.note}</p>}
                </li>
              ))}
            </ul>
          )}
          {tx.session.length > 0 && <div className="perforation my-1" aria-hidden />}
          {!history ? (
            <ul aria-label="Loading history" className="space-y-2 py-3">{[0, 1, 2].map((i) => <li key={i} className="flex items-center justify-between gap-4"><Skeleton className="h-5 w-56 max-w-[60%]" /><Skeleton className="h-5 w-28" /></li>)}</ul>
          ) : history.length === 0 ? (
            <div className="py-6 text-sm">
              <p className="font-semibold">No on-chain activity for this wallet yet.</p>
              <p className="mt-1 text-muted-foreground">Start by approving and depositing QUSDC in <a href="#fund" className="link">Fund or withdraw</a>. Each confirmed transaction will be printed here.</p>
            </div>
          ) : <HistoryList items={history} />}
        </div>
      </section>
    </div>
  );
}

/** The posted gate panel: what the contract currently enforces for this owner. */
function GatePanel({ snap }: { snap: ReturnType<typeof useAllowance>["snap"] }) {
  const a = snap?.account;
  if (!snap || !a) {
    return (
      <section aria-label="Gate panel loading" aria-busy className="rounded-[10px] border bg-card">
        <div className="flex items-center justify-between gap-3 border-b p-5"><Skeleton className="h-6 w-40" /><Skeleton className="h-6 w-20" /></div>
        <div className="grid gap-6 p-5 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i}><Skeleton className="h-4 w-24" /><Skeleton className="mt-2 h-8 w-32" /></div>)}</div>
        <div className="border-t p-5"><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="mt-3 h-2 w-full" /></div>
      </section>
    );
  }
  const state = a.paused ? { word: "Paused", tone: "warn" as const, text: "Agent payments are blocked. Withdrawals still work." }
    : a.agent === ZERO ? { word: "No agent", tone: "neutral" as const, text: "No agent is authorised, so no payment can pass. Set a policy below." }
    : { word: "Active", tone: "success" as const, text: "The authorised agent can pay allowed merchants within the limits below." };
  const daily = a.dailyCap;
  const pct = daily > 0n ? Math.min(100, Number((a.spentToday * 10000n) / daily) / 100) : 0;
  const left = daily > a.spentToday ? daily - a.spentToday : 0n;

  return (
    <section aria-labelledby="gate-h" className="overflow-hidden rounded-[10px] border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
        <div><h2 id="gate-h" className="h-card">Posted limits</h2><p className="mt-0.5 text-xs text-muted-foreground">Read from the chain at {new Date(snap.readAt).toLocaleTimeString()}</p></div>
        <p className="flex items-center gap-2 text-sm">
          <Badge tone={state.tone}><span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{state.word}</Badge>
          <span className="hidden text-muted-foreground md:inline">{state.text}</span>
        </p>
      </div>
      <p className="px-5 pt-4 text-sm text-muted-foreground sm:px-6 md:hidden">{state.text}</p>
      <dl className="grid gap-x-6 gap-y-5 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div><dt className="text-sm text-muted-foreground">Allowance balance</dt><dd className="mt-1 text-[1.75rem] font-bold leading-tight"><Q v={a.balance} /></dd><dd className="mt-1 text-sm text-muted-foreground num">Deposit cap {fmtUsdc(snap.depositCap)} QUSDC</dd></div>
        <div><dt className="text-sm text-muted-foreground">Wallet QUSDC</dt><dd className="mt-1 text-[1.75rem] font-bold leading-tight"><Q v={snap.walletQusdc} /></dd></div>
        <div><dt className="text-sm text-muted-foreground">Per-call limit</dt><dd className="mt-1 text-[1.75rem] font-bold leading-tight"><Q v={a.perCallCap} /></dd></div>
        <div className="min-w-0"><dt className="text-sm text-muted-foreground">Authorised agent</dt><dd className="mt-2">{a.agent === ZERO ? <span className="text-sm font-semibold">None</span> : <Address value={a.agent} />}</dd></div>
      </dl>
      <div className="border-t px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="font-semibold">Daily limit (UTC day)</span>
          <span id="daily-words" className="num text-muted-foreground">
            {daily === 0n ? "No daily limit set, so no payment can pass." : <>{fmtUsdc(a.spentToday)} of {fmtUsdc(daily)} QUSDC spent today, {fmtUsdc(left)} left</>}
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-sm bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-labelledby="daily-words">
          <div className={cn("h-full", pct >= 100 ? "bg-danger" : "bg-foreground")} style={{ width: `${pct}%` }} />
        </div>
        {pct >= 100 && daily > 0n && <p className="mt-2 text-sm text-danger">Daily limit reached. Further payments are refused until the next UTC day.</p>}
      </div>
    </section>
  );
}

function HistoryList({ items }: { items: HistoryItem[] }) {
  return (
    <ul aria-label="On-chain history">
      {items.map((h) => (
        <li key={h.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-dashed py-3 text-sm last:border-b-0">
          <span className="min-w-0">
            <span className="font-medium">{(LABELS[h.name] ?? (() => h.name))(h.args)}</span>
            <span className="num ml-2 text-muted-foreground">block {h.blockNumber}</span>
          </span>
          <span className="flex items-center gap-3"><span className="text-success">Confirmed</span><Address value={h.txHash} kind="tx" /></span>
        </li>
      ))}
    </ul>
  );
}
