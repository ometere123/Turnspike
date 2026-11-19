import React, { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, Interface, formatEther, formatUnits, parseUnits, isAddress } from "ethers";

const VAULT_ABI = [
  "function deposit(uint256)", "function withdraw(uint256)", "function setPolicy(address,uint256,uint256)",
  "function setMerchant(address,bool)", "function revokeAgent()", "function setPaused(bool)",
  "function allowedMerchant(address,address) view returns (bool)",
  "function account(address) view returns (tuple(uint256 balance,bool paused,address agent,uint256 perCallCap,uint256 dailyCap,uint256 dayIndex,uint256 spentToday))",
  "function spentToday(address) view returns (uint256)", "function depositCap() view returns (uint256)",
  "error NotOwnerAgent()", "error Paused()", "error MerchantNotAllowed()", "error CapExceeded(uint256 cap,uint256 attempted)", "error DailyCapExceeded(uint256 cap,uint256 attempted)",
  "error RequestAlreadyUsed(bytes32 requestId)", "error InsufficientBalance()", "error DepositCapExceeded()", "error ZeroAmount()", "error ZeroAddress()",
];
const ERC20_ABI = ["function approve(address,uint256)", "function allowance(address,address) view returns (uint256)", "function balanceOf(address) view returns (uint256)"];
const ERRORS: Record<string, string> = {
  NotOwnerAgent: "Agent not authorised (revoked or wrong key)", Paused: "Account is paused", MerchantNotAllowed: "Merchant not on allowlist",
  CapExceeded: "Over the per-call limit", DailyCapExceeded: "Over the daily limit", RequestAlreadyUsed: "Request ID already paid (replay refused)",
  InsufficientBalance: "Balance too low", DepositCapExceeded: "Over the per-account deposit cap", ZeroAmount: "Amount must be above zero", ZeroAddress: "Address required",
};
const iface = new Interface(VAULT_ABI);
const q = (base: string) => `${formatUnits(base, 6)} QUSDC`; // amounts always shown as QUSDC (6 decimals); base units in title
const Q = ({ v }: { v: bigint | string }) => <span title={`${v.toString()} base units`}>{q(v.toString())}</span>;

interface Cfg { chainId: number; contract: string; token: string; merchant: string; priceBase: string; confirmations: number; demoEnabled: boolean; explorer: string }
interface Step { step: string; ok: boolean; txHash?: string; detail?: any }
const human = (e: any) => { try { const p = iface.parseError(e?.data ?? e?.info?.error?.data); if (p) return ERRORS[p.name] ?? p.name; } catch { /* */ } return e?.shortMessage ?? e?.message ?? String(e); };

export function App() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [cfgErr, setCfgErr] = useState("");
  const [addr, setAddr] = useState("");
  const [chain, setChain] = useState<number | null>(null);
  const [acct, setAcct] = useState<any>(null);
  const [qusdc, setQusdc] = useState<bigint>(0n);
  const [cap, setCap] = useState<bigint>(0n);
  const [merchOk, setMerchOk] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<{ kind: string; text: string; tx?: string } | null>(null);
  const [form, setForm] = useState({ amount: "0.05", agent: "", perCall: "0.01", daily: "0.05", merchant: "" });
  const [runLog, setRunLog] = useState<{ scenario: string; steps: Step[]; data?: any }[]>([]);
  const [running, setRunning] = useState("");
  const [stats, setStats] = useState<any>(null);
  const [dep, setDep] = useState<any>(null);
  const [rpcDown, setRpcDown] = useState(false);

  useEffect(() => {
    fetch("/v1/config").then((r) => r.json()).then((c) => { setCfg(c); setForm((f) => ({ ...f, merchant: c.merchant })); }).catch((e) => setCfgErr(String(e)));
    fetch("/v1/stats").then((r) => r.json()).then(setStats).catch(() => {});
    fetch("/evidence-files/deployment.json").then((r) => r.json()).then(setDep).catch(() => {});
  }, []);

  const eth = (window as any).ethereum;
  const tx = (h: string) => `${cfg?.explorer}/tx/${h}`;

  const refresh = useCallback(async (a = addr) => {
    if (!cfg || !eth || !a) return;
    try {
      const p = new BrowserProvider(eth);
      const v = new Contract(cfg.contract, VAULT_ABI, p), t = new Contract(cfg.token, ERC20_ABI, p);
      const [ac, bal, c, m] = await Promise.all([v.account(a), t.balanceOf(a), v.depositCap(), v.allowedMerchant(a, cfg.merchant)]);
      setAcct(ac); setQusdc(bal); setCap(c); setMerchOk(m); setRpcDown(false);
    } catch { setRpcDown(true); }
  }, [cfg, eth, addr]);

  async function connect() {
    if (!eth) return setMsg({ kind: "bad", text: "No injected wallet found. Install QIE Wallet or a MetaMask-style wallet." });
    const accs: string[] = await eth.request({ method: "eth_requestAccounts" });
    setAddr(accs[0]);
    setChain(Number(await eth.request({ method: "eth_chainId" })));
    eth.on?.("chainChanged", (c: string) => setChain(Number(c)));
    eth.on?.("accountsChanged", (a: string[]) => { setAddr(a[0] ?? ""); });
  }
  async function switchChain() {
    if (!cfg) return;
    const hex = "0x" + cfg.chainId.toString(16);
    try { await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch { await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "QIE Mainnet", nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: ["https://rpc1mainnet.qie.digital"], blockExplorerUrls: [cfg.explorer] }] }); }
  }
  useEffect(() => { if (addr && cfg) refresh(addr); }, [addr, cfg, chain]);

  const wrong = !!cfg && chain !== null && chain !== cfg.chainId;

  /** Sends an owner transaction, showing the estimated gas cost first (doc 07 cost disclosure). */
  async function send(label: string, build: (s: any) => Promise<any>, estimate: (s: any) => Promise<bigint>) {
    if (!cfg || wrong) return;
    try {
      const p = new BrowserProvider(eth); const s = await p.getSigner();
      const gas = await estimate(s); const price = (await p.getFeeData()).gasPrice ?? 0n;
      const bal = await p.getBalance(addr);
      if (bal < gas * price) return setMsg({ kind: "bad", text: `Not enough QIE for gas. Balance ${formatEther(bal)} QIE, need about ${formatEther(gas * price)} QIE.` });
      if (!window.confirm(`${label}\nEstimated gas cost: about ${formatEther(gas * price)} QIE`)) return;
      setMsg({ kind: "warn", text: `${label}: waiting for confirmation…` });
      const t = await build(s); setMsg({ kind: "warn", text: `${label}: submitted, pending (blocks take about 4 s; not guaranteed).`, tx: t.hash });
      await t.wait(); setMsg({ kind: "ok", text: `${label}: confirmed.`, tx: t.hash }); refresh();
    } catch (e: any) { setMsg({ kind: "bad", text: `${label} failed: ${human(e)}` }); }
  }
  const V = (s: any) => new Contract(cfg!.contract, VAULT_ABI, s);
  const T = (s: any) => new Contract(cfg!.token, ERC20_ABI, s);
  const amt = () => parseUnits(form.amount || "0", 6);

  async function deposit() {
    if (!cfg) return;
    const p = new BrowserProvider(eth); const s = await p.getSigner();
    const allowance: bigint = await T(s).allowance(addr, cfg.contract);
    if (allowance < amt()) await send("Approve QUSDC", (s2) => T(s2).approve(cfg.contract, amt()), (s2) => T(s2).approve.estimateGas(cfg.contract, amt()));
    await send(`Deposit ${form.amount} QUSDC`, (s2) => V(s2).deposit(amt()), (s2) => V(s2).deposit.estimateGas(amt()).catch(() => 120000n));
  }

  async function run(scenario: string) {
    setRunning(scenario);
    try {
      const r = await fetch(`/demo/run/${scenario}`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) setRunLog((l) => [{ scenario, steps: [{ step: "error", ok: false, detail: j.error }] }, ...l]);
      else setRunLog((l) => [{ scenario, ...j }, ...l]);
      fetch("/v1/stats").then((x) => x.json()).then(setStats).catch(() => {});
      refresh();
    } catch (e: any) { setRunLog((l) => [{ scenario, steps: [{ step: "gateway unreachable", ok: false, detail: String(e) }] }, ...l]); }
    setRunning("");
  }

  const base = (x?: any) => x?.toString() ?? "0";
  return (
    <main>
      <h1>Turnpike</h1>
      <p className="sub">Pay-per-request APIs in QUSDC on QIE Mainnet. The limits are enforced by the contract, not by the agent. Unaudited; mainnet; small amounts only.</p>

      {cfgErr && <div className="banner bad" role="alert">Gateway unreachable: {cfgErr}</div>}
      {rpcDown && <div className="banner bad" role="alert">QIE RPC is not responding. Showing the last known values.</div>}
      {wrong && <div className="banner bad" role="alert">Wrong network. <button onClick={switchChain}>Switch to QIE Mainnet (1990)</button> Actions are blocked until you do.</div>}
      {msg && <div className={`banner ${msg.kind === "bad" ? "bad" : msg.kind === "warn" ? "warn" : ""}`} role="status">{msg.text} {msg.tx && <a href={tx(msg.tx)} target="_blank" rel="noreferrer">view transaction</a>}</div>}

      <section aria-labelledby="s1">
        <h2 id="s1">1. Wallet and balance</h2>
        {!addr ? <button className="primary" onClick={connect}>Connect wallet</button> : (
          <dl className="kv">
            <dt>Account</dt><dd>{addr}</dd>
            <dt>Network</dt><dd>{chain === cfg?.chainId ? "QIE Mainnet (1990)" : `chain ${chain} (wrong)`}</dd>
            <dt>Wallet QUSDC</dt><dd><Q v={qusdc} /></dd>
            <dt>Vault balance</dt><dd>{acct ? <Q v={acct.balance} /> : "…"} (deposit cap <Q v={cap} />)</dd>
          </dl>
        )}
        <div className="row">
          <label>Amount (QUSDC)<input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} inputMode="decimal" /></label>
          <button className="primary" disabled={!addr || wrong} onClick={deposit}>Approve and deposit</button>
          <button disabled={!addr || wrong} onClick={() => send(`Withdraw ${form.amount} QUSDC`, (s) => V(s).withdraw(amt()), (s) => V(s).withdraw.estimateGas(amt()))}>Withdraw</button>
        </div>
      </section>

      <section aria-labelledby="s2">
        <h2 id="s2">2. Policy</h2>
        {acct && <dl className="kv">
          <dt>Agent</dt><dd>{acct.agent === "0x0000000000000000000000000000000000000000" ? "none (revoked or unset)" : acct.agent}</dd>
          <dt>Per-call limit</dt><dd><Q v={acct.perCallCap} /></dd><dt>Daily limit</dt><dd><Q v={acct.dailyCap} /></dd>
          <dt>Paused</dt><dd>{acct.paused ? "yes (pay blocked, withdraw still works)" : "no"}</dd>
          <dt>Merchant allowed</dt><dd>{merchOk === null ? "…" : merchOk ? "yes" : "no"} ({cfg?.merchant})</dd>
        </dl>}
        <div className="row">
          <label>Agent address<input value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} placeholder="0x…" /></label>
          <label>Per-call (QUSDC)<input value={form.perCall} onChange={(e) => setForm({ ...form, perCall: e.target.value })} /></label>
          <label>Daily (QUSDC)<input value={form.daily} onChange={(e) => setForm({ ...form, daily: e.target.value })} /></label>
        </div>
        <div className="row">
          <button className="primary" disabled={!addr || wrong || !isAddress(form.agent)} onClick={() => send("Set policy", (s) => V(s).setPolicy(form.agent, parseUnits(form.perCall, 6), parseUnits(form.daily, 6)), (s) => V(s).setPolicy.estimateGas(form.agent, parseUnits(form.perCall, 6), parseUnits(form.daily, 6)))}>Set policy</button>
          <button disabled={!addr || wrong} onClick={() => send("Allow merchant", (s) => V(s).setMerchant(cfg!.merchant, true), (s) => V(s).setMerchant.estimateGas(cfg!.merchant, true))}>Allow demo merchant</button>
          <button disabled={!addr || wrong} onClick={() => send("Revoke agent", (s) => V(s).revokeAgent(), (s) => V(s).revokeAgent.estimateGas())}>Revoke agent</button>
          <button disabled={!addr || wrong} onClick={() => send(acct?.paused ? "Unpause" : "Pause", (s) => V(s).setPaused(!acct?.paused), (s) => V(s).setPaused.estimateGas(!acct?.paused))}>{acct?.paused ? "Unpause" : "Pause"}</button>
        </div>
      </section>

      <section aria-labelledby="s3">
        <h2 id="s3">3. Run the scripted agent</h2>
        <p className="sub">The scripted agent (no LLM) calls <code>/v1/block-summary</code>. It runs against the demo owner's account, so the limits shown are the demo owner's. Price {cfg ? q(cfg.priceBase) : "…"} per call. Settlement is not instant: expect a pending state for several seconds.</p>
        {!cfg?.demoEnabled && <div className="banner warn">The demo agent is not enabled on this gateway.</div>}
        <div className="row">
          {[["allowed", "Allowed call"], ["over-cap", "Over-cap payment"], ["replay", "Replay"], ["after-revoke", "Call after revoke"]].map(([k, l]) => (
            <button key={k} disabled={!cfg?.demoEnabled || !!running} onClick={() => run(k)}>{running === k ? "Running…" : l}</button>
          ))}
        </div>
        {running && <p role="status">Running {running}… waiting on the chain. This can take 10 to 30 seconds.</p>}
        {runLog.map((r, i) => (
          <div key={i}><strong>{r.scenario}</strong>
            <ol className="log">{r.steps.map((s, j) => (
              <li key={j}><span className={`tag ${s.ok ? (s.step === "pending" ? "wait" : "ok") : "no"}`}>{s.step}</span>{" "}
                {s.detail?.text ?? (typeof s.detail === "string" ? s.detail : s.detail ? JSON.stringify(s.detail) : "")}{" "}
                {s.txHash && <a href={tx(s.txHash)} target="_blank" rel="noreferrer">tx {s.txHash.slice(0, 10)}…</a>}</li>))}
            </ol>
            {r.data && <p>Delivered: block {r.data.blockNumber} at {new Date(r.data.timestamp * 1000).toISOString()} ({r.data.txCount} txs), read live from QIE RPC.</p>}
          </div>))}
      </section>

      <section aria-labelledby="s4" id="evidence">
        <h2 id="s4">4. Evidence</h2>
        {cfg && <dl className="kv">
          <dt>Contract</dt><dd><a href={`${cfg.explorer}/address/${cfg.contract}#code`} target="_blank" rel="noreferrer">{cfg.contract}</a> (source verified on the explorer)</dd>
          <dt>Token</dt><dd>{cfg.token} (QUSDC, 6 decimals)</dd><dt>Merchant</dt><dd>{cfg.merchant}</dd>
          <dt>Confirmations required</dt><dd>{cfg.confirmations}</dd>
        </dl>}
        {stats && <p>Calls delivered by this gateway: <strong>{stats.delivered}</strong> (from addresses we control: {stats.deliveredOwn}; from other addresses: <strong>{stats.deliveredExternal}</strong>). Paid but undelivered for over 24 h: {stats.paidUndelivered24h}.</p>}
        {dep?.smokeTxs && <><h3>Mainnet transactions</h3><ul>{Object.entries(dep.smokeTxs).map(([k, h]) => <li key={k}>{k}: <a href={tx(h as string)} target="_blank" rel="noreferrer">{(h as string).slice(0, 14)}…</a></li>)}</ul></>}
        <h3>Limitations and trust assumptions</h3>
        <ul className="lim">
          <li>Unaudited contract. A per-account deposit cap limits exposure.</li>
          <li>QUSDC's issuer can mint and burn through a role (visible in its verified source). No pause or blacklist code was found, but this is not an execution test.</li>
          <li>The daily limit uses fixed UTC days, so up to twice the limit can be spent across midnight UTC. The per-call limit and balance still bound it.</li>
          <li>The gateway is centralised. There is no refund if a payment lands and delivery then fails; such rows are listed above.</li>
          <li>The Turnpike 402 flow is its own format, not x402-compatible.</li>
          <li>Finality and reorg behaviour on QIE are untested; confirmations are configurable.</li>
        </ul>
      </section>
    </main>
  );
}
