"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { BrowserProvider, JsonRpcProvider, type Eip1193Provider, type Signer } from "ethers";
import { config } from "./config";

interface Injected extends Eip1193Provider {
  on?: (e: string, cb: (...a: any[]) => void) => void;
  removeListener?: (e: string, cb: (...a: any[]) => void) => void;
}

interface WalletState {
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
  connecting: boolean;
  wrongNetwork: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
  getSigner: () => Promise<Signer>;
  readProvider: JsonRpcProvider;
}

const Ctx = createContext<WalletState | null>(null);
export const useWallet = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet must be used inside <WalletProvider>");
  return c;
};

const readProvider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const eth = () => (typeof window === "undefined" ? undefined : ((window as any).ethereum as Injected | undefined));

  useEffect(() => {
    const e = eth();
    setHasProvider(!!e);
    if (!e) return;
    // Restore an already-authorised session without prompting.
    e.request({ method: "eth_accounts" }).then(async (a: string[]) => {
      if (a[0]) { setAddress(a[0]); setChainId(Number(await e.request({ method: "eth_chainId" }))); }
    }).catch(() => {});
    const onAccounts = (a: string[]) => setAddress(a[0] ?? null);
    const onChain = (c: string) => setChainId(Number(c));
    e.on?.("accountsChanged", onAccounts);
    e.on?.("chainChanged", onChain);
    return () => { e.removeListener?.("accountsChanged", onAccounts); e.removeListener?.("chainChanged", onChain); };
  }, []);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) throw new Error("No injected wallet found. Install QIE Wallet or a MetaMask-compatible wallet.");
    setConnecting(true);
    try {
      const a = (await e.request({ method: "eth_requestAccounts" })) as string[];
      setAddress(a[0] ?? null);
      setChainId(Number(await e.request({ method: "eth_chainId" })));
    } finally { setConnecting(false); }
  }, []);

  const switchNetwork = useCallback(async () => {
    const e = eth();
    if (!e) return;
    const hex = "0x" + config.chainId.toString(16);
    try { await e.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
    catch (err: any) {
      if (err?.code === 4902 || /unrecognized|not added/i.test(String(err?.message))) {
        await e.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: config.chainName, nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: [config.rpcUrl], blockExplorerUrls: [config.explorer] }] });
      } else throw err;
    }
  }, []);

  const getSigner = useCallback(async () => {
    const e = eth();
    if (!e) throw new Error("No wallet");
    return new BrowserProvider(e).getSigner();
  }, []);

  const value = useMemo<WalletState>(() => ({
    address, chainId, hasProvider, connecting, wrongNetwork: chainId !== null && chainId !== config.chainId,
    connect, disconnect: () => setAddress(null), switchNetwork, getSigner, readProvider,
  }), [address, chainId, hasProvider, connecting, connect, switchNetwork, getSigner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
