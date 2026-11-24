"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatEther, type ContractTransaction, type JsonRpcProvider, type JsonRpcSigner, type Signer } from "ethers";
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
}
export interface SessionTx { id: number; title: string; from: string; hash?: string; status: "pending" | "confirmed" | "failed" | "unknown"; note?: string; req?: TxRequest }

/** Waits for one confirmation on the read RPC. Detects a sped-up or cancelled transaction; throws when the RPC never sees it. */
async function confirmation(rpc: JsonRpcProvider, hash: string, startBlock: number | null) {
  for (let i = 0; i < 45; i++) {
    const tx = await rpc.getTransaction(hash).catch(() => null);
    if (tx) return (startBlock === null ? tx : tx.replaceableTransaction(startBlock)).wait();
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("not seen");
}

/** What a failed wait really means. Only a mined revert or a cancellation is "failed"; a lost connection is not. */
export function classifyWait(e: any): { status: "confirmed" | "failed" | "unknown"; note?: string; hash?: string } {
  if (e?.code === "TRANSACTION_REPLACED") {
    const hash: string | undefined = e?.receipt?.hash ?? e?.replacement?.hash;
    if (e.reason === "repriced") return e?.receipt?.status === 1 ? { status: "confirmed", hash } : { status: "failed", note: "Transaction reverted on-chain.", hash };
    return { status: "failed", note: e.reason === "cancelled" ? "Cancelled in your wallet." : "Replaced by a different transaction in your wallet." };
  }
  if (e?.code === "CALL_EXCEPTION" && e?.receipt) return { status: "failed", note: describeError(e).message };
  return { status: "unknown", note: "The connection was lost while waiting. It may still confirm, so check it before sending it again." };
}

/**
 * One path for every owner transaction: wrong-network guard, gas estimate, balance check, explicit confirmation,
 * wallet rejection, pending, confirmed and failed states. Nothing is shown as successful unless the receipt says so.
 */
export function useTxFlow(onSettled: () => void) {
  const w = useWallet();
  const [req, setReq] = useState<{ r: TxRequest; fee: bigint; signer: Signer; from: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionTx[]>([]);
  const id = useRef(0);
  const opener = useRef<HTMLElement | null>(null); // where focus returns when the review closes

  // A review opened for one account must not survive a switch to another account or network.
  useEffect(() => { setReq(null); }, [w.address, w.chainId]);

  const patch = (i: number, p: Partial<SessionTx>) => setSession((s) => s.map((x) => (x.id === i ? { ...x, ...p } : x)));

  const run = useCallback(async (r: TxRequest) => {
    opener.current = document.activeElement as HTMLElement | null;
    if (!w.address) return toast.error("Connect a wallet first.");
    if (w.wrongNetwork) return toast.error("Wrong network. Switch to QIE Mainnet (1990) first.");
    try {
      const signer = await w.getSigner();
      // Re-read the network from the wallet at the moment of sending: the cached chain id can be stale.
      const net = await signer.provider!.getNetwork();
      if (Number(net.chainId) !== config.chainId) return toast.error(`Your wallet is on chain ${net.chainId}. Switch to QIE Mainnet (${config.chainId}) and try again.`);
      const from = await signer.getAddress();
      if (from.toLowerCase() !== w.address.toLowerCase()) return toast.error("Your wallet switched to another account. Review the console for that account and try again.");
      const gas = await r.estimate(signer);
      const price = (await signer.provider!.getFeeData()).gasPrice ?? 0n;
      const fee = gas * price;
      const bal = await signer.provider!.getBalance(w.address);
      if (bal < fee) return toast.error(`Not enough QIE for gas. You have ${formatEther(bal)} QIE and need about ${formatEther(fee)} QIE.`);
      setReq({ r, fee, signer, from });
    } catch (e) {
      const d = describeError(e);
      toast.error(d.kind === "contract" ? `This would fail: ${d.message}` : d.message);
    }
  }, [w]);

  const confirm = async () => {
    if (!req) return;
    const { r, signer, from } = req;
    setBusy(true);
    const n = ++id.current;
    let asked = false;
    try {
      // The review may have been open for a while: check the wallet again at the moment of signing.
      const [net, accounts] = await Promise.all([signer.provider!.getNetwork(), (signer.provider as unknown as { send: (m: string, p: unknown[]) => Promise<string[]> }).send("eth_accounts", [])]);
      if (Number(net.chainId) !== config.chainId || accounts[0]?.toLowerCase() !== from.toLowerCase()) {
        setReq(null);
        toast.error("Your wallet's account or network changed after this review. Nothing was sent. Start again.");
        return;
      }
      asked = true;
      const startBlock = await w.readProvider.getBlockNumber().catch(() => null);
      // Only the hash is taken from the wallet. Confirmation is read from the QIE RPC, so a wallet that loses its own
      // connection after broadcasting cannot leave the review hanging or hide a transaction that was sent.
      const hash = await (signer as JsonRpcSigner).sendUncheckedTransaction(await r.tx(signer));
      setReq(null);
      setSession((s) => [{ id: n, title: r.title, from, hash, status: "pending" as const, req: r }, ...s]);
      const tid = toast.loading(`${r.title}: submitted. Waiting for confirmation. Blocks take about 4 s, not guaranteed.`);
      const slow = setTimeout(() => toast.warning(`${r.title}: still pending after 60 s. It may yet confirm; check the transaction on the explorer before retrying.`, { id: tid, action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank") } }), 60_000);
      try {
        const rc = await confirmation(w.readProvider, hash, startBlock);
        clearTimeout(slow);
        if (rc && rc.status === 1) {
          patch(n, { status: "confirmed" });
          toast.success(`${r.title}: confirmed.`, { id: tid, action: { label: "View", onClick: () => window.open(explorerTx(hash), "_blank") } });
        } else {
          patch(n, { status: "failed", note: "Transaction reverted on-chain." });
          toast.error(`${r.title}: reverted on-chain.`, { id: tid });
        }
      } catch (e) {
        clearTimeout(slow);
        const out = classifyWait(e);
        patch(n, out);
        if (out.status === "confirmed") toast.success(`${r.title}: confirmed.`, { id: tid });
        else if (out.status === "failed") toast.error(`${r.title}: ${out.note}`, { id: tid });
        else toast.warning(`${r.title}: ${out.note}`, { id: tid });
      }
      onSettled();
    } catch (e) {
      const d = describeError(e);
      setReq(null);
      // After the wallet was asked, a lost connection does not mean nothing was sent.
      if (asked && (d.kind === "network" || d.kind === "unknown")) toast.warning(`${r.title}: the wallet did not report an outcome. Check your wallet's activity before trying again; the transaction may have been sent.`, { duration: 15_000 });
      else toast[d.kind === "rejected" ? "message" : "error"](d.message);
    } finally { setBusy(false); }
  };

  /** Asks the read RPC about a transaction whose confirmation was lost. Never sends anything. */
  const recheck = async (t: SessionTx) => {
    if (!t.hash) return;
    try {
      const rc = await w.readProvider.getTransactionReceipt(t.hash);
      if (!rc) return void toast.message("Still no receipt from the QIE RPC. Check the explorer before sending it again.");
      patch(t.id, rc.status === 1 ? { status: "confirmed", note: undefined } : { status: "failed", note: "Transaction reverted on-chain." });
      onSettled();
    } catch { toast.error("The QIE RPC did not answer. The outcome is still unknown."); }
  };

  const dialog = (
    <Dialog open={!!req} onOpenChange={(o) => !o && !busy && setReq(null)}>
      {req && (
        <DialogContent title={req.r.title} description="Review before your wallet asks you to sign." onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}>
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted p-3.5 leading-relaxed">{req.r.summary}</div>
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)]">
              <dt className="text-muted-foreground">Network</dt><dd className="num font-medium">{config.chainName}, chain {config.chainId}</dd>
              <dt className="text-muted-foreground">Your account</dt><dd><Address value={req.from} full /></dd>
              <dt className="text-muted-foreground">{req.r.contractName}</dt><dd><Address value={req.r.to} full /></dd>
            </dl>
            <p className="text-muted-foreground">Estimated network fee: <span className="num font-medium text-foreground">{Number(formatEther(req.fee)).toFixed(6)} QIE</span> (paid in QIE, not QUSDC).</p>
            <div className="flex flex-wrap justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setReq(null)} disabled={busy}>Cancel</Button>
              <Button onClick={confirm} loading={busy}>{busy ? "Waiting for your wallet…" : "Confirm in wallet"}</Button>
            </div>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
  const mine = session.filter((t) => t.from.toLowerCase() === w.address?.toLowerCase());
  return { run, recheck, dialog, session: mine };
}
