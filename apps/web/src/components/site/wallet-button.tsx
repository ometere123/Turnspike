"use client";

import { useState } from "react";
import { LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useWallet, type WalletChoice } from "@/lib/wallet";
import { short } from "@/lib/utils";

export function WalletButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const w = useWallet();
  const [picking, setPicking] = useState(false);
  const connect = async (choice?: WalletChoice) => {
    setPicking(false);
    try { await w.connect(choice); } catch (e: any) {
      toast.error(e?.code === 4001 ? "Connection request was rejected in your wallet." : (e?.message ?? "Could not connect"));
    }
  };

  if (!w.address) {
    return (
      <>
        <Button size={size} className={size === "sm" ? "h-10 px-4" : undefined} loading={w.connecting} onClick={() => { if (w.wallets.length > 1) setPicking(true); else void connect(w.wallets[0]); }}>
          <Wallet className="h-4 w-4" aria-hidden />{w.connecting ? "Connecting…" : "Connect wallet"}
        </Button>
        <Dialog open={picking} onOpenChange={setPicking}>
          <DialogContent title="Choose a wallet">
            <ul className="space-y-2">
              {w.wallets.map((c) => (
                <li key={c.uuid}>
                  <Button variant="secondary" size="lg" className="w-full justify-start" onClick={() => void connect(c)}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data URI supplied by the wallet */}
                    {c.icon?.startsWith("data:image/") ? <img src={c.icon} alt="" width={24} height={24} className="h-6 w-6 rounded" /> : <Wallet className="h-5 w-5" aria-hidden />}
                    {c.name}
                  </Button>
                </li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {w.wrongNetwork ? (
        <Button size={size} className={size === "sm" ? "h-10" : undefined} variant="danger" onClick={() => w.switchNetwork().catch((e) => toast.error(e?.message ?? "Could not switch network"))}>Switch to QIE</Button>
      ) : null}
      <span className="hidden h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm sm:inline-flex" title={w.address}>
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        <span className="sr-only">Connected wallet</span>
        <span className="font-mono text-[13px]">{short(w.address)}</span>
      </span>
      <Button size="icon" variant="ghost" aria-label="Disconnect wallet" title="Disconnect wallet" onClick={w.disconnect}><LogOut className="h-4 w-4" aria-hidden /></Button>
    </div>
  );
}
