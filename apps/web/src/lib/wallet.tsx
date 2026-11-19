"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

const DISCONNECT_KEY = "turnpike.disconnected";
const storage = {
  get: () => { try { return localStorage.getItem(DISCONNECT_KEY) === "1"; } catch { return false; } },
  set: (v: boolean) => { try { v ? localStorage.setItem(DISCONNECT_KEY, "1") : localStorage.removeItem(DISCONNECT_KEY); } catch { /* storage blocked */ } },
};

const readProvider = new JsonRpcProvider(config.rpcUrl, config.chainId, { staticNetwork: true, cacheTimeout: -1 });

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const eth = () => (typeof window === "undefined" ? undefined : ((window as any).ethereum as Injected | undefined));

  const attached = useRef<Injected | null>(null);
  const attach = useCallback((e: Injected) => {
    if (attached.current === e) return;
    attached.current = e;
    setHasProvider(true);
    e.on?.("accountsChanged", (a: string[]) => { if (storage.get()) return; setAddress(a[0] ?? null); });
    e.on?.("chainChanged", (c: string) => setChainId(Number(c)));
  }, []);

  useEffect(() => {
    const e = eth();
    if (e) {
      attach(e);
      // Restore an already-authorised session without prompting, unless the user chose to disconnect.
      if (!storage.get()) e.request({ method: "eth_accounts" }).then(async (a: string[]) => {
        if (a[0]) { setAddress(a[0]); setChainId(Number(await e.request({ method: "eth_chainId" }))); }
      }).catch(() => {});
    }
    // Some wallets inject after the page has loaded.
    const late = () => { const x = eth(); if (x) attach(x); };
    window.addEventListener("ethereum#initialized", late);
    return () => window.removeEventListener("ethereum#initialized", late);
  }, [attach]);

  const connect = useCallback(async () => {
    const e = eth();
    if (!e) throw new Error("No injected wallet found. Install QIE Wallet or a MetaMask-compatible wallet.");
    setConnecting(true);
    try {
      attach(e);
      const a = (await e.request({ method: "eth_requestAccounts" })) as string[];
      storage.set(false);
      setAddress(a[0] ?? null);
      setChainId(Number(await e.request({ method: "eth_chainId" })));
    } finally { setConnecting(false); }
  }, [attach]);

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
    connect, disconnect: () => { storage.set(true); setAddress(null); }, switchNetwork, getSigner, readProvider,
  }), [address, chainId, hasProvider, connecting, connect, switchNetwork, getSigner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
