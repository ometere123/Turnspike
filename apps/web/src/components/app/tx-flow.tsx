"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, type BrowserProvider, type ContractTransaction, type JsonRpcProvider, type JsonRpcSigner, type Signer } from "ethers";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { describeError } from "@/lib/errors";
import { config, explorerTx } from "@/lib/config";
import { Address } from "@/components/ui/address";
import { useWallet } from "@/lib/wallet";

export interface TxRequest {
  title: string;
  summary: React.ReactNode;
  /** The exact contract the wallet will be asked to call. */
  to: string;
  contractName: string;
  estimate: (s: Signer) => Promise<bigint>;
  /** The exact call the wallet will be asked to sign. */
  tx: (s: Signer) => Promise<ContractTransaction>;
  /** Called once the chain confirms it, so a form does not stay ready to send the same thing again. */
  onConfirmed?: () => void;
}
export interface SessionTx { id: number; title: string; from: string; hash: string; nonce?: number; status: "pending" | "confirmed" | "failed" | "unknown"; note?: string; req?: TxRequest }
type Outcome = Pick<SessionTx, "status" | "note">;

const POLL_MS = 3_000;
const GIVE_UP_MS = 180_000;
const GIVE_UP_ERRORS = 8;
const LOST: Outcome = { status: "unknown", note: "Confirmation could not be read. It may still confirm, so check it before sending it again." };
const REPLACED: Outcome = { status: "unknown", note: "Another transaction from this account used the same nonce, so this one may have been sped up, cancelled or replaced. Check your wallet's activity before sending it again." };

/** One read of the chain. Null means nothing is settled yet. Only a mined receipt is ever "confirmed" or "failed". */
async function readOutcome(rpc: JsonRpcProvider, hash: string, from: string, nonce?: number): Promise<Outcome | null> {
  const rc = await rpc.getTransactionReceipt(hash);
  if (rc) return rc.status === 1 ? { status: "confirmed", note: undefined } : { status: "failed", note: "Transaction reverted on-chain." };
  if (nonce === undefined || (await rpc.getTransactionCount(from, "latest")) <= nonce) return null;
  // The nonce is spent. Read once more, in case the receipt appeared between the two reads.
  const again = await rpc.getTransactionReceipt(hash);
  return again ? (again.status === 1 ? { status: "confirmed", note: undefined } : { status: "failed", note: "Transaction reverted on-chain." }) : REPLACED;
}

/**
 * One path for every owner transaction: wrong-network guard, gas estimate, balance check, explicit confirmation, wallet
 * rejection, pending, confirmed, failed and unknown states. Nothing is shown as successful unless the receipt says so, and
 * nothing is shown as failed unless the chain says so. Waiting for one transaction never blocks the next review: pause and
 * revoke must stay reachable while something else is pending.
 */
export function useTxFlow(onSettled: () => void) {
  const w = useWallet();
  const [req, setReq] = useState<{ r: TxRequest; fee: bigint | null; gasLimit: bigint; signer: JsonRpcSigner; from: string } | null>(null);
  const [signing, setSigning] = useState(false);
  const [session, setSession] = useState<SessionTx[]>([]);
  const id = useRef(0);
  const epoch = useRef(0); // increases whenever the account or network changes; work started under an older epoch is dropped
  const preparing = useRef(false);
  const alive = useRef(true);
  const opener = useRef<HTMLElement | null>(null); // where focus returns when the review closes
  const settled = useRef(onSettled);
  settled.current = onSettled;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  // A review opened for one account or network must not survive a switch to another.
  useEffect(() => { epoch.current++; setReq(null); setSigning(false); }, [w.address, w.chainId]);

  const patch = useCallback((i: number, p: Partial<SessionTx>) => setSession((s) => s.map((x) => (x.id === i ? { ...x, ...p } : x))), []);

  const run = useCallback(async (r: TxRequest): Promise<void> => {
    if (preparing.current) return;
    opener.current = document.activeElement as HTMLElement | null;
    if (!w.address) return void toast.error("Connect a wallet first.");
    if (w.wrongNetwork) return void toast.error("Wrong network. Switch to QIE Mainnet (1990) first.");
    preparing.current = true;
    const mine = epoch.current;
    try {
      const signer = (await w.getSigner()) as JsonRpcSigner;
      const provider = signer.provider as BrowserProvider;
      // Ask the wallet itself: the cached chain id can be stale, and a wallet may switch without announcing it.
      const chain = Number(await provider.send("eth_chainId", []));
      if (chain !== config.chainId) return void toast.error(`Your wallet is on chain ${chain}. Switch to QIE Mainnet (${config.chainId}) and try again.`);
      const from = await signer.getAddress();
      if (from.toLowerCase() !== w.address.toLowerCase()) return void toast.error("Your wallet switched to another account. Review the console for that account and try again.");
      const gasLimit = ((await r.estimate(signer)) * 12n) / 10n; // headroom, because state can move between the estimate and the block
      const fees = await provider.getFeeData();
      const price = fees.gasPrice ?? fees.maxFeePerGas;
      const fee = price === null ? null : gasLimit * price;
      const bal = await provider.getBalance(from);
      if (bal === 0n || (fee !== null && bal < fee)) return void toast.error(`Not enough QIE for gas. You have ${formatEther(bal)} QIE${fee === null ? "." : ` and need about ${formatEther(fee)} QIE.`}`);
      if (mine === epoch.current) setReq({ r, fee, gasLimit, signer, from });
    } catch (e) {
      const d = describeError(e);
      toast.error(d.kind === "contract" ? `This would fail: ${d.message}` : d.message);
    } finally { preparing.current = false; }
  }, [w]);

  /** Reads the chain until the transaction settles, for a bounded time. Runs beside the interface and never holds it. */
  const follow = async (n: number, r: TxRequest, hash: string, from: string) => {
    const { title } = r;
    const tid = toast.loading(`${title}: submitted. Waiting for confirmation. Blocks take about 4 s, not guaranteed.`);
    const view = { label: "View", onClick: () => window.open(explorerTx(hash), "_blank") };
    const deadline = Date.now() + GIVE_UP_MS;
    let errors = 0, replaced = 0, warned = false, nonce: number | undefined, out: Outcome | null = null;
    const started = Date.now();
    while (alive.current && !out) {
      try {
        if (nonce === undefined) {
          nonce = (await w.readProvider.getTransaction(hash))?.nonce;
          if (nonce !== undefined) patch(n, { nonce });
        }
        out = await readOutcome(w.readProvider, hash, from, nonce);
        errors = 0;
        // A load-balanced RPC can know the new nonce before it knows the receipt, so one sighting proves nothing.
        if (out === REPLACED && ++replaced < 5) out = null;
      } catch { if (++errors >= GIVE_UP_ERRORS) out = LOST; }
      if (!out && Date.now() > deadline) out = LOST;
      if (out) break;
      if (!warned && Date.now() - started > 60_000) {
        warned = true;
        toast.warning(`${title}: still pending after 60 s. It may yet confirm; check the transaction on the explorer before retrying.`, { id: tid, action: view });
      }
      await new Promise((res) => setTimeout(res, POLL_MS));
    }
    if (!alive.current || !out) return void toast.dismiss(tid);
    patch(n, out);
    if (out.status === "confirmed") { r.onConfirmed?.(); toast.success(`${title}: confirmed.`, { id: tid, action: view }); }
    else if (out.status === "failed") toast.error(`${title}: ${out.note}`, { id: tid, action: view });
    else toast.warning(`${title}: ${out.note}`, { id: tid, action: view });
    settled.current();
  };

  const confirm = async () => {
    if (!req) return;
    const { r, signer, from, gasLimit } = req;
    const mine = epoch.current;
    const provider = signer.provider as BrowserProvider;
    setSigning(true);
    let asked = false;
    try {
      const call = await r.tx(signer);
      // The review may have been open for a while: ask the wallet again, as the last thing before it is asked to sign.
      const [chain, accounts] = await Promise.all([provider.send("eth_chainId", []) as Promise<string>, provider.send("eth_accounts", []) as Promise<string[]>]);
      if (mine !== epoch.current || Number(chain) !== config.chainId || accounts[0]?.toLowerCase() !== from.toLowerCase()) {
        setReq(null);
        toast.error("Your wallet's account or network changed after this review. Nothing was sent. Start again.");
        return;
      }
      asked = true;
      // Only the hash is taken from the wallet; confirmation is read from the QIE RPC. The chain id and gas limit are part of
      // the request, so the wallet can refuse the wrong network and nothing else happens between the check and the prompt.
      const hash = await signer.sendUncheckedTransaction({ ...call, chainId: config.chainId, gasLimit });
      if (mine === epoch.current) setReq(null);
      const n = ++id.current;
      setSession((s) => [{ id: n, title: r.title, from, hash, status: "pending" as const, req: r }, ...s]);
      void follow(n, r, hash, from);
    } catch (e) {
      const d = describeError(e);
      if (mine === epoch.current) setReq(null);
      // After the wallet was asked, a lost connection does not mean nothing was sent.
      if (asked && (d.kind === "network" || d.kind === "unknown")) toast.warning(`${r.title}: the wallet did not report an outcome. Check your wallet's activity before trying again; the transaction may have been sent.`, { duration: 15_000 });
      else toast[d.kind === "rejected" ? "message" : "error"](d.message);
    } finally { if (mine === epoch.current) setSigning(false); }
  };

  /** Asks the read RPC about a transaction whose confirmation was lost. Never sends anything. */
  const recheck = async (t: SessionTx) => {
    try {
      const out = await readOutcome(w.readProvider, t.hash, t.from, t.nonce);
      if (!out) return void toast.message("Still no receipt from the QIE RPC. Check the explorer before sending it again.");
      patch(t.id, out);
      if (out.status === "unknown") toast.message(out.note);
      settled.current();
    } catch { toast.error("The QIE RPC did not answer. The outcome is still unknown."); }
  };

  /** Opens a new review for a transaction the chain reverted. Each failed row can be retried once. */
  const retry = (t: SessionTx) => {
    if (!t.req || preparing.current) return;
    const r = t.req;
    patch(t.id, { req: undefined });
    void run(r);
  };

  const open = session.filter((t) => t.from.toLowerCase() === w.address?.toLowerCase() && (t.status === "pending" || t.status === "unknown"));
  const dialog = (
    <Dialog open={!!req} onOpenChange={(o) => !o && !signing && setReq(null)}>
      {req && (
        <DialogContent title={req.r.title} description="Review before your wallet asks you to sign." className="max-w-lg" onOpenAutoFocus={(e) => { e.preventDefault(); (e.currentTarget as HTMLElement | null)?.focus(); }} onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted p-3.5 leading-relaxed">{req.r.summary}</div>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Network</dt><dd className="num font-medium">{config.chainName}, chain {config.chainId}</dd>
              <dt className="text-muted-foreground">Your account</dt><dd><Address value={req.from} full /></dd>
              <dt className="text-muted-foreground">{req.r.contractName}</dt><dd><Address value={req.r.to} full /></dd>
            </dl>
            {open.length > 0 && <p role="status" className="rounded-md border border-warn/50 p-3 text-warn">{open[0].title} is still {open[0].status === "pending" ? "pending" : "unconfirmed"}. Signing this sends another transaction.</p>}
            <p className="text-muted-foreground">Estimated network fee: <span className="num font-medium text-foreground">{req.fee === null ? "unavailable, see your wallet" : `up to ${Number(formatEther(req.fee)).toFixed(6)} QIE`}</span> (paid in QIE, not QUSDC).</p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setReq(null)} disabled={signing}>Cancel</Button>
              <Button onClick={confirm} loading={signing}>{signing ? "Waiting for your wallet…" : "Confirm in wallet"}</Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
  const mine = session.filter((t) => t.from.toLowerCase() === w.address?.toLowerCase());
  return { run, retry, recheck, dialog, session: mine };
}
