"use client";

import { useCallback, useRef, useState } from "react";
import { formatEther, type ContractTransactionResponse, type Signer } from "ethers";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { describeError } from "@/lib/errors";
import { config, explorerTx } from "@/lib/config";
import { useWallet } from "@/lib/wallet";

export interface TxRequest {
  title: string;
  summary: React.ReactNode;
  estimate: (s: Signer) => Promise<bigint>;
  send: (s: Signer) => Promise<ContractTransactionResponse>;
}
export interface SessionTx { id: number; title: string; hash?: string; status: "pending" | "confirmed" | "failed"; note?: string; req?: TxRequest }

/**
 * One path for every owner transaction: wrong-network guard, gas estimate, balance check, explicit confirmation,
 * wallet rejection, pending, confirmed and failed states. Nothing is shown as successful unless the receipt says so.
 */
export function useTxFlow(onSettled: () => void) {
  const w = useWallet();
  const [req, setReq] = useState<{ r: TxRequest; fee: bigint; signer: Signer } | null>(null);
  const [busy, setBusy] = useState(false);
  const [session, setSession] = useState<SessionTx[]>([]);
  const id = useRef(0);

  const patch = (i: number, p: Partial<SessionTx>) => setSession((s) => s.map((x) => (x.id === i ? { ...x, ...p } : x)));

  const run = useCallback(async (r: TxRequest) => {
    if (!w.address) return toast.error("Connect a wallet first.");
    if (w.wrongNetwork) return toast.error("Wrong network. Switch to QIE Mainnet (1990) first.");
    try {
      const signer = await w.getSigner();
      // Re-read the network from the wallet at the moment of sending: the cached chain id can be stale.
      const net = await signer.provider!.getNetwork();
      if (Number(net.chainId) !== config.chainId) return toast.error(`Your wallet is on chain ${net.chainId}. Switch to QIE Mainnet (${config.chainId}) and try again.`);
      const gas = await r.estimate(signer);
      const price = (await signer.provider!.getFeeData()).gasPrice ?? 0n;
      const fee = gas * price;
      const bal = await signer.provider!.getBalance(w.address);
      if (bal < fee) return toast.error(`Not enough QIE for gas. You have ${formatEther(bal)} QIE and need about ${formatEther(fee)} QIE.`);
      setReq({ r, fee, signer });
    } catch (e) {
      const d = describeError(e);
      toast.error(d.kind === "contract" ? `This would fail: ${d.message}` : d.message);
    }
  }, [w]);

  const confirm = async () => {
    if (!req) return;
    const { r, signer } = req;
    setBusy(true);
    const n = ++id.current;
    try {
      const tx = await r.send(signer);
      setReq(null);
      setSession((s) => [{ id: n, title: r.title, hash: tx.hash, status: "pending" as const, req: r }, ...s]);
      const tid = toast.loading(`${r.title}: submitted. Waiting for confirmation. Blocks take about 4 s, not guaranteed.`);
      const slow = setTimeout(() => toast.warning(`${r.title}: still pending after 60 s. It may yet confirm; check the transaction on the explorer before retrying.`, { id: tid, action: { label: "View", onClick: () => window.open(explorerTx(tx.hash), "_blank") } }), 60_000);
      try {
        const rc = await tx.wait();
        clearTimeout(slow);
        if (rc && rc.status === 1) {
          patch(n, { status: "confirmed" });
          toast.success(`${r.title}: confirmed.`, { id: tid, action: { label: "View", onClick: () => window.open(explorerTx(tx.hash), "_blank") } });
        } else {
          patch(n, { status: "failed", note: "Transaction reverted on-chain." });
          toast.error(`${r.title}: reverted on-chain.`, { id: tid });
        }
      } catch (e) {
        clearTimeout(slow);
        const d = describeError(e);
        patch(n, { status: "failed", note: d.message });
        toast.error(`${r.title}: ${d.message}`, { id: tid });
      }
      onSettled();
    } catch (e) {
      const d = describeError(e);
      setReq(null);
      toast[d.kind === "rejected" ? "message" : "error"](d.message);
    } finally { setBusy(false); }
  };

  const dialog = (
    <Dialog open={!!req} onOpenChange={(o) => !o && !busy && setReq(null)}>
      {req && (
        <DialogContent title={req.r.title} description="Review before your wallet asks you to sign.">
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted p-3.5 leading-relaxed">{req.r.summary}</div>
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
  return { run, dialog, session };
}
