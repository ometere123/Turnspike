"use client";

import { LogOut, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet";
import { short } from "@/lib/utils";

export function WalletButton({ size = "sm" }: { size?: "sm" | "md" }) {
  const w = useWallet();

  if (!w.address) {
    return (
      <Button size={size} className={size === "sm" ? "h-10 px-4" : undefined} loading={w.connecting} onClick={async () => {
        try { await w.connect(); } catch (e: any) {
          toast.error(e?.code === 4001 ? "Connection request was rejected in your wallet." : (e?.message ?? "Could not connect"));
        }
      }}>
        <Wallet className="h-4 w-4" aria-hidden />{w.connecting ? "Connecting…" : "Connect wallet"}
      </Button>
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
