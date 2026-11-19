"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Contract, Interface, zeroPadValue, type Log } from "ethers";
import { ALLOWANCE_ABI, ERC20_ABI } from "./abi";
import { config } from "./config";
import { useWallet } from "./wallet";

export interface AccountView {
  balance: bigint; paused: boolean; agent: string; perCallCap: bigint; dailyCap: bigint; spentToday: bigint;
}
export interface Snapshot {
  account: AccountView; walletQusdc: bigint; allowanceToVault: bigint; depositCap: bigint; merchantAllowed: boolean;
}
export interface HistoryItem { name: string; txHash: string; blockNumber: number; args: Record<string, string>; }

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
const EVENTS = ["Deposited", "Withdrawn", "PolicySet", "MerchantSet", "AgentRevoked", "PausedSet", "Paid"] as const;

/** Blockchain reads for the connected owner. Reads use the public RPC, never the wallet. */
export function useAllowance() {
  const { address, readProvider } = useWallet();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [merchants, setMerchants] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!address) { setSnap(null); setHistory(null); return; }
    const my = ++seq.current;
    setLoading(true);
    try {
      const vault = new Contract(config.allowance, ALLOWANCE_ABI as unknown as string[], readProvider);
      const token = new Contract(config.qusdc, ERC20_ABI as unknown as string[], readProvider);
      const [a, spent, walletQusdc, allowanceToVault, depositCap, merchantAllowed] = await Promise.all([
        vault.account(address), vault.spentToday(address), token.balanceOf(address), token.allowance(address, config.allowance),
        vault.depositCap(), vault.allowedMerchant(address, config.merchant),
      ]);
      if (my !== seq.current) return;
      setSnap({
        account: { balance: a.balance, paused: a.paused, agent: a.agent, perCallCap: a.perCallCap, dailyCap: a.dailyCap, spentToday: spent },
        walletQusdc, allowanceToVault, depositCap, merchantAllowed,
      });
      setError(null);

      // History: this owner's events from the deployment block, read in chunks to respect RPC range limits.
      const head = await readProvider.getBlockNumber();
      const topics0 = EVENTS.map((n) => iface.getEvent(n)!.topicHash);
      const items: HistoryItem[] = [];
      const step = 20_000;
      for (let from = config.deployBlock; from <= head; from += step) {
        const logs: Log[] = await readProvider.getLogs({ address: config.allowance, fromBlock: from, toBlock: Math.min(from + step - 1, head), topics: [topics0, zeroPadValue(address, 32)] });
        for (const l of logs) {
          const p = iface.parseLog({ topics: [...l.topics], data: l.data });
          if (!p) continue;
          const args: Record<string, string> = {};
          p.fragment.inputs.forEach((inp, i) => { args[inp.name] = String(p.args[i]); });
          items.push({ name: p.name, txHash: l.transactionHash, blockNumber: l.blockNumber, args });
        }
      }
      if (my !== seq.current) return;
      items.sort((x, y) => y.blockNumber - x.blockNumber);
      setHistory(items);
      const m: Record<string, boolean> = {};
      for (const it of [...items].reverse()) if (it.name === "MerchantSet") m[it.args.merchant] = it.args.allowed === "true";
      setMerchants(m);
    } catch (e: any) {
      if (my === seq.current) setError("Could not read from the QIE RPC. Showing the last known values.");
    } finally { if (my === seq.current) setLoading(false); }
  }, [address, readProvider]);

  useEffect(() => { refresh(); const t = setInterval(refresh, 20_000); return () => clearInterval(t); }, [refresh]);
  return { snap, history, merchants, error, loading, refresh };
}
