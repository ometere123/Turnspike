"use client";

import { useEffect, useMemo, useState } from "react";
import { Contract, isAddress, type Signer } from "ethers";
import { AlertTriangle, History, PauseCircle, PlayCircle, RefreshCw, ShieldOff, Store, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Address } from "@/components/ui/address";
import { Badge, StatusPill } from "@/components/ui/badge";
import { WalletButton } from "@/components/site/wallet-button";
import { ALLOWANCE_ABI, ERC20_ABI } from "@/lib/abi";
import { config } from "@/lib/config";
import { useAllowance, type HistoryItem } from "@/lib/useAllowance";
import { useWallet } from "@/lib/wallet";
import { fmtUsdc, parseUsdc, ZERO } from "@/lib/utils";
import { useTxFlow } from "./tx-flow";

const vault = (s: Signer) => new Contract(config.allowance, ALLOWANCE_ABI as unknown as string[], s);
const token = (s: Signer) => new Contract(config.qusdc, ERC20_ABI as unknown as string[], s);

function Stat({ label, value, sub, loading }: { label: string; value: React.ReactNode; sub?: React.ReactNode; loading: boolean }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      {loading ? <Skeleton className="mt-2 h-8 w-32" /> : <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>}
      {sub && !loading && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  );
}

const Q = ({ v }: { v: bigint }) => <span title={`${v.toString()} base units`}>{fmtUsdc(v)} <span className="text-base font-medium text-muted-foreground">QUSDC</span></span>;

const LABELS: Record<string, (a: Record<string, string>) => string> = {
  Deposited: (a) => `Deposited ${fmtUsdc(a.amount)} QUSDC`,
  Withdrawn: (a) => `Withdrew ${fmtUsdc(a.amount)} QUSDC`,
  PolicySet: (a) => `Policy set: per-call ${fmtUsdc(a.perCallCap)}, daily ${fmtUsdc(a.dailyCap)} QUSDC`,
  MerchantSet: (a) => `Merchant ${a.allowed === "true" ? "allowed" : "removed"}`,
  AgentRevoked: () => "Agent revoked",
  PausedSet: (a) => (a.paused === "true" ? "Account paused" : "Account unpaused"),
  Paid: (a) => `Agent paid ${fmtUsdc(a.amount)} QUSDC`,
};

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
      <Card className="mx-auto mt-10 max-w-lg p-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"><Wallet className="h-6 w-6" aria-hidden /></span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Connect your wallet</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Your wallet is your Turnpike account. Connect it to fund an allowance and set the limits an agent must obey. Balances are read from QIE Mainnet.</p>
        <div className="mt-6 flex justify-center"><WalletButton size="md" /></div>
        {!w.hasProvider && <p className="mt-4 text-sm text-warn">No injected wallet detected in this browser. Install QIE Wallet or a MetaMask-compatible wallet.</p>}
      </Card>
    );
  }

  const a = snap?.account;
  const depositErr = amount && !amt ? "Enter a number with up to 6 decimals." : amt && snap && amt > snap.walletQusdc ? "More than your wallet QUSDC balance." : amt && snap && a && a.balance + amt > snap.depositCap ? `Over the per-account deposit cap of ${fmtUsdc(snap.depositCap)} QUSDC.` : undefined;
  const needsApproval = !!(amt && snap && snap.allowanceToVault < amt);

  const agentErr = agent && !isAddress(agent) ? "Not a valid address." : undefined;
  const pc = parseUsdc(perCall), dc = parseUsdc(daily);
  const policyErr = (perCall && !pc) || (daily && !dc) ? "Limits must be numbers with up to 6 decimals." : pc && dc && pc > dc ? "The per-call limit is above the daily limit, so the daily limit would never be reached." : undefined;
  const merchErr = merchant && !isAddress(merchant) ? "Not a valid address." : undefined;

  return (
    <div className="space-y-6">
      {tx.dialog}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your allowance</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">Owner <Address value={w.address} /><Badge tone="accent">QIE Mainnet</Badge></p>
        </div>
        <Button variant="secondary" size="sm" onClick={refresh} loading={loading && !!snap}><RefreshCw className="h-4 w-4" aria-hidden />Refresh</Button>
      </div>

      {w.wrongNetwork && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger/40 bg-danger/10 p-4 text-sm">
          <span className="flex items-center gap-2 text-danger"><AlertTriangle className="h-4 w-4" aria-hidden />Your wallet is on the wrong network. Actions are disabled until you switch to QIE Mainnet (1990).</span>
          <Button size="sm" variant="danger" onClick={() => w.switchNetwork()}>Switch network</Button>
        </div>
      )}
      {error && <div role="status" className="rounded-2xl border border-warn/40 bg-warn/10 p-4 text-sm text-warn">{error}</div>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Wallet QUSDC" loading={!snap} value={snap && <Q v={snap.walletQusdc} />} />
        <Stat label="Allowance balance" loading={!snap} value={a && <Q v={a.balance} />} sub={snap && `Deposit cap ${fmtUsdc(snap.depositCap)} QUSDC`} />
        <Stat label="Spent today (UTC)" loading={!snap} value={a && <Q v={a.spentToday} />} sub={a && `Daily limit ${fmtUsdc(a.dailyCap)} QUSDC`} />
        <Stat label="Status" loading={!snap} value={a && (a.paused ? "Paused" : a.agent === ZERO ? "No agent" : "Active")} sub={a && a.agent !== ZERO && <Address value={a.agent} />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Fund or withdraw</CardTitle><CardDescription>Deposits move QUSDC from your wallet into your allowance on the contract. You can withdraw unspent balance at any time, even while paused.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Amount (QUSDC)" htmlFor="amt" error={depositErr} hint="1 QUSDC = 1,000,000 base units">
              <Input id="amt" inputMode="decimal" placeholder="0.05" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!depositErr} aria-describedby={depositErr ? "amt-err" : undefined} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={blocked || !amt || !!depositErr} onClick={() => amt && (needsApproval
                ? tx.run({ title: "Approve QUSDC", summary: <>Allow the contract to pull exactly <b>{fmtUsdc(amt)} QUSDC</b> from your wallet. This does not move funds yet.</>, estimate: (s) => token(s).approve.estimateGas(config.allowance, amt), send: (s) => token(s).approve(config.allowance, amt) })
                : tx.run({ title: "Deposit", summary: <>Deposit <b>{fmtUsdc(amt)} QUSDC</b> into your allowance.</>, estimate: (s) => vault(s).deposit.estimateGas(amt), send: (s) => vault(s).deposit(amt) }))}>
                {needsApproval ? "1. Approve QUSDC" : "Deposit"}
              </Button>
              <Button variant="secondary" disabled={blocked || !amt || !a || amt > a.balance} onClick={() => amt && tx.run({ title: "Withdraw", summary: <>Withdraw <b>{fmtUsdc(amt)} QUSDC</b> from your allowance back to your wallet.</>, estimate: (s) => vault(s).withdraw.estimateGas(amt), send: (s) => vault(s).withdraw(amt) })}>Withdraw</Button>
              <Button variant="ghost" disabled={blocked || !a || a.balance === 0n} onClick={() => a && tx.run({ title: "Withdraw all", summary: <>Withdraw your entire allowance of <b>{fmtUsdc(a.balance)} QUSDC</b>.</>, estimate: (s) => vault(s).withdraw.estimateGas(a.balance), send: (s) => vault(s).withdraw(a.balance) })}>Withdraw all</Button>
            </div>
            {needsApproval && <p className="text-xs text-muted-foreground">Step 1 approves the amount. After it confirms, the button becomes Deposit.</p>}
            {amt && a && amt > a.balance && <p className="text-xs text-muted-foreground">Withdraw is limited to your allowance balance of {fmtUsdc(a.balance)} QUSDC.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Agent and spending limits</CardTitle><CardDescription>One agent key per account. The contract enforces both limits on every payment, whatever the agent or gateway does.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Authorised agent address" htmlFor="agent" error={agentErr}>
              <Input id="agent" placeholder="0x…" value={agent} onChange={(e) => { setTouched(true); setAgent(e.target.value.trim()); }} aria-invalid={!!agentErr} />
            </Field>
            <div className="flex gap-3">
              <Field label="Per-call limit (QUSDC)" htmlFor="pc"><Input id="pc" inputMode="decimal" value={perCall} onChange={(e) => { setTouched(true); setPerCall(e.target.value); }} /></Field>
              <Field label="Daily limit (QUSDC)" htmlFor="dc"><Input id="dc" inputMode="decimal" value={daily} onChange={(e) => { setTouched(true); setDaily(e.target.value); }} /></Field>
            </div>
            {policyErr && <p role="alert" className="text-xs text-danger">{policyErr}</p>}
            <p className="text-xs text-muted-foreground">Daily limits use fixed UTC days, so up to twice the daily limit can pass across midnight UTC.</p>
            <Button disabled={blocked || !isAddress(agent) || !pc || !dc || !!policyErr} onClick={() => pc && dc && tx.run({ title: "Set policy", summary: <>Authorise <span className="break-all font-mono text-xs">{agent}</span> with a per-call limit of <b>{fmtUsdc(pc)}</b> and a daily limit of <b>{fmtUsdc(dc)} QUSDC</b>.</>, estimate: (s) => vault(s).setPolicy.estimateGas(agent, pc, dc), send: (s) => vault(s).setPolicy(agent, pc, dc) })}>Save policy</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Store className="h-4 w-4" aria-hidden />Merchant allowlist</CardTitle><CardDescription>Payments to addresses that are not allowed revert with MerchantNotAllowed.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <Field label="Merchant address" htmlFor="m" error={merchErr}><Input id="m" value={merchant} onChange={(e) => setMerchant(e.target.value.trim())} placeholder="0x…" /></Field>
            <div className="flex flex-wrap gap-2">
              <Button disabled={blocked || !isAddress(merchant)} onClick={() => tx.run({ title: "Allow merchant", summary: <>Allow payments to <span className="break-all font-mono text-xs">{merchant}</span>.</>, estimate: (s) => vault(s).setMerchant.estimateGas(merchant, true), send: (s) => vault(s).setMerchant(merchant, true) })}>Allow</Button>
              <Button variant="secondary" disabled={blocked || !isAddress(merchant)} onClick={() => tx.run({ title: "Remove merchant", summary: <>Stop allowing payments to <span className="break-all font-mono text-xs">{merchant}</span>.</>, estimate: (s) => vault(s).setMerchant.estimateGas(merchant, false), send: (s) => vault(s).setMerchant(merchant, false) })}>Remove</Button>
            </div>
            <div>
              <p className="mb-2 text-[13px] font-medium">On your allowlist</p>
              {!history ? <Skeleton className="h-8 w-full" /> : Object.entries(merchants).filter(([, ok]) => ok).length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No merchants yet. Add the demo merchant ({config.merchant.slice(0, 8)}…) to let the demo agent pay.</p>
              ) : (
                <ul className="space-y-1.5">{Object.entries(merchants).filter(([, ok]) => ok).map(([m]) => <li key={m}><Address value={m} /></li>)}</ul>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Emergency controls</CardTitle><CardDescription>Pause blocks new payments but never withdrawals. Revoking clears the agent immediately.</CardDescription></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={blocked || !a} onClick={() => a && tx.run({ title: a.paused ? "Unpause" : "Pause", summary: a.paused ? <>Allow the agent to pay again.</> : <>Block all agent payments for your account. You can still withdraw.</>, estimate: (s) => vault(s).setPaused.estimateGas(!a.paused), send: (s) => vault(s).setPaused(!a.paused) })}>
              {a?.paused ? <><PlayCircle className="h-4 w-4" aria-hidden />Unpause</> : <><PauseCircle className="h-4 w-4" aria-hidden />Pause account</>}
            </Button>
            <Button variant="danger" disabled={blocked || !a || a.agent === ZERO} onClick={() => tx.run({ title: "Revoke agent", summary: <>Remove the authorised agent. Its next payment will revert with NotOwnerAgent. You can authorise an agent again later.</>, estimate: (s) => vault(s).revokeAgent.estimateGas(), send: (s) => vault(s).revokeAgent() })}><ShieldOff className="h-4 w-4" aria-hidden />Revoke agent</Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" aria-hidden />Activity</CardTitle><CardDescription>This session&apos;s transactions, then your on-chain history read from the contract&apos;s events.</CardDescription></CardHeader>
        <CardContent>
          {tx.session.length > 0 && (
            <ul className="mb-4 divide-y rounded-xl border">
              {tx.session.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="flex items-center gap-3"><StatusPill status={t.status} />{t.note && <span className="text-xs text-danger">{t.note}</span>}{t.hash && <Address value={t.hash} kind="tx" />}</span>
                </li>
              ))}
            </ul>
          )}
          {!history ? <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            : history.length === 0 ? <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No on-chain activity for this wallet yet. Approve and deposit to get started.</p>
            : <HistoryList items={history} />}
        </CardContent>
      </Card>
    </div>
  );
}

function HistoryList({ items }: { items: HistoryItem[] }) {
  return (
    <ul className="divide-y rounded-xl border">
      {items.map((h) => (
        <li key={`${h.txHash}-${h.name}-${h.blockNumber}`} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
          <span>{(LABELS[h.name] ?? (() => h.name))(h.args)}<span className="ml-2 text-xs text-muted-foreground">block {h.blockNumber}</span></span>
          <Address value={h.txHash} kind="tx" />
        </li>
      ))}
    </ul>
  );
}
