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
  readAt: number; account: AccountView; walletQusdc: bigint; allowanceToVault: bigint; depositCap: bigint; merchantAllowed: boolean;
}
export interface HistoryItem { key: string; name: string; txHash: string; blockNumber: number; logIndex: number; args: Record<string, string> }

const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
const EVENTS = ["Deposited", "Withdrawn", "PolicySet", "MerchantSet", "AgentRevoked", "PausedSet", "Paid"] as const;
const TOPICS0 = EVENTS.map((n) => iface.getEvent(n)!.topicHash);
const CHUNK = 20_000;
const REORG_OVERLAP = 12; // re-read this many recent blocks each refresh so a short reorg cannot leave stale history

interface HistoryCache { address: string; scannedTo: number; items: Map<string, HistoryItem> }

/**
 * Blockchain reads for the connected owner. Reads use the public RPC, never the wallet. Balances refresh every 20 s; the
 * event history is scanned once from the deployment block and afterwards only from the last scanned block, so a refresh
 * costs one small range query instead of a full-history scan.
 */
export function useAllowance() {
  const { address, readProvider } = useWallet();
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [merchants, setMerchants] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  // The wallet now connected. A refresh started for another wallet (for example after a slow confirmation) must not write here.
  const owner = useRef(address);
  owner.current = address;
  const reading = useRef(false); // a slow read is left to finish instead of being restarted by the next tick
  const cache = useRef<HistoryCache | null>(null);

  // A different wallet must never see the previous wallet's numbers.
  useEffect(() => { seq.current++; cache.current = null; reading.current = false; setSnap(null); setHistory(null); setMerchants({}); setError(null); }, [address]);

  const refresh = useCallback(async () => {
    if (!address || owner.current !== address) return;
    const my = ++seq.current;
    setLoading(true);
    let balancesRead = false;
    reading.current = true;
    try {
      // The provider is configured for chain 1990; the endpoint has to say so itself before its numbers are shown.
      if (Number(await readProvider.send("eth_chainId", [])) !== config.chainId) throw new Error("wrong chain");
      const vault = new Contract(config.allowance, ALLOWANCE_ABI as unknown as string[], readProvider);
      const token = new Contract(config.qusdc, ERC20_ABI as unknown as string[], readProvider);
      const [a, spent, walletQusdc, allowanceToVault, depositCap, merchantAllowed] = await Promise.all([
        vault.account(address), vault.spentToday(address), token.balanceOf(address), token.allowance(address, config.allowance),
        vault.depositCap(), vault.allowedMerchant(address, config.merchant),
      ]);
      if (my !== seq.current) return;
      setSnap({
        readAt: Date.now(),
        account: { balance: a.balance, paused: a.paused, agent: a.agent, perCallCap: a.perCallCap, dailyCap: a.dailyCap, spentToday: spent },
        walletQusdc, allowanceToVault, depositCap, merchantAllowed,
      });
      balancesRead = true;

      const head = await readProvider.getBlockNumber();
      if (my !== seq.current) return;
      const c: HistoryCache = cache.current?.address === address ? { ...cache.current, items: new Map(cache.current.items) } : { address, scannedTo: config.deployBlock - 1, items: new Map() };
      const from0 = Math.max(config.deployBlock, c.scannedTo - REORG_OVERLAP + 1);
      // Drop anything in the overlap window and re-read it, so reorged-out events disappear.
      for (const [k, v] of c.items) if (v.blockNumber >= from0) c.items.delete(k);
      for (let from = from0; from <= head; from += CHUNK) {
        const logs: Log[] = await readProvider.getLogs({ address: config.allowance, fromBlock: from, toBlock: Math.min(from + CHUNK - 1, head), topics: [TOPICS0, zeroPadValue(address, 32)] });
        for (const l of logs) {
          const p = iface.parseLog({ topics: [...l.topics], data: l.data });
          if (!p) continue;
          const args: Record<string, string> = {};
          p.fragment.inputs.forEach((inp, i) => { args[inp.name] = String(p.args[i]); });
          const key = `${l.transactionHash}:${l.index}`;
          c.items.set(key, { key, name: p.name, txHash: l.transactionHash, blockNumber: l.blockNumber, logIndex: l.index, args });
        }
        if (my !== seq.current) return;
        c.scannedTo = Math.min(from + CHUNK - 1, head);
        cache.current = c; // keep progress, so a long first scan is resumed instead of restarted
      }
      if (my !== seq.current) return;
      c.scannedTo = Math.max(c.scannedTo, head);
      cache.current = c;
      const items = [...c.items.values()].sort((x, y) => y.blockNumber - x.blockNumber || y.logIndex - x.logIndex);
      setHistory(items);
      const m: Record<string, boolean> = {};
      for (const it of [...items].reverse()) if (it.name === "MerchantSet") m[it.args.merchant] = it.args.allowed === "true";
      setMerchants(m);
      setError(null);
    } catch {
      if (my === seq.current) setError(balancesRead
        ? "Balances and limits are current, but the transaction history and merchant list could not be read from the QIE RPC."
        : "Could not read from the QIE RPC. Balances, limits and history are not current until a read succeeds.");
    } finally { if (my === seq.current) { setLoading(false); reading.current = false; } }
  }, [address, readProvider]);

  useEffect(() => { refresh(); const t = setInterval(() => { if (!reading.current) refresh(); }, 20_000); return () => clearInterval(t); }, [refresh]);
  return { snap, history, merchants, error, loading, refresh };
}
