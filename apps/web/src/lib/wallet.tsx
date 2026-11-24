"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BrowserProvider, FetchRequest, JsonRpcProvider, type Eip1193Provider, type Signer } from "ethers";
import { config } from "./config";

interface Injected extends Eip1193Provider {
  on?: (e: string, cb: (...a: any[]) => void) => void;
  removeListener?: (e: string, cb: (...a: any[]) => void) => void;
}

/** A wallet that announced itself (EIP-6963). Several extensions can be installed; window.ethereum holds only one of them. */
export interface WalletChoice { uuid: string; name: string; icon: string; rdns: string; provider: Injected }

interface WalletState {
  wallets: WalletChoice[];
  address: string | null;
  chainId: number | null;
  hasProvider: boolean;
  connecting: boolean;
  wrongNetwork: boolean;
  connect: (choice?: WalletChoice) => Promise<void>;
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

const DISCONNECT_KEY = "turnspike.disconnected";
const WALLET_KEY = "turnspike.wallet";
const remembered = { get: () => { try { return localStorage.getItem(WALLET_KEY); } catch { return null; } }, set: (v: string | null) => { try { if (v) localStorage.setItem(WALLET_KEY, v); else localStorage.removeItem(WALLET_KEY); } catch { /* storage blocked */ } } };
const storage = {
  get: () => { try { return localStorage.getItem(DISCONNECT_KEY) === "1"; } catch { return false; } },
  set: (v: boolean) => { try { v ? localStorage.setItem(DISCONNECT_KEY, "1") : localStorage.removeItem(DISCONNECT_KEY); } catch { /* storage blocked */ } },
};

const readRequest = new FetchRequest(config.rpcUrls[0]);
readRequest.timeout = 10_000;
// When an endpoint fails, move to the next one and stay there. Callers check the chain id on every refresh, so the endpoint
// in use always proves its chain; two endpoints are never asked within one request.
let active = 0;
const send = FetchRequest.createGetUrlFunc();
readRequest.getUrlFunc = async (req, signal) => {
  const at = active;
  const r = req.clone();
  r.url = config.rpcUrls[at];
  try {
    const res = await send(r, signal);
    if (res.statusCode < 500 && res.statusCode !== 429) return res;
    if (active === at) active = (at + 1) % config.rpcUrls.length;
    return res;
  } catch (e) {
    if (active === at) active = (at + 1) % config.rpcUrls.length;
    throw e;
  }
};
const readProvider = new JsonRpcProvider(readRequest, config.chainId, { staticNetwork: true, cacheTimeout: -1 });

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [hasProvider, setHasProvider] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [wallets, setWallets] = useState<WalletChoice[]>([]);
  const chosen = useRef<Injected | null>(null);
  const eth = () => (typeof window === "undefined" ? undefined : (chosen.current ?? ((window as any).ethereum as Injected | undefined)));

  const attached = useRef(new Set<Injected>());
  const attach = useCallback((e: Injected) => {
    setHasProvider(true);
    if (attached.current.has(e)) return;
    attached.current.add(e);
    // Only the wallet in use may change what the page shows.
    e.on?.("accountsChanged", (a: string[]) => { if (eth() !== e || storage.get()) return; setAddress(a[0] ?? null); });
    e.on?.("chainChanged", (c: string) => { if (eth() === e) setChainId(Number(c)); });
  }, []);

  useEffect(() => {
    // Restore an already-authorised session without prompting, unless the user chose to disconnect.
    const restore = (p: Injected) => {
      if (storage.get()) return;
      p.request({ method: "eth_accounts" }).then(async (a: string[]) => {
        if (!a[0] || eth() !== p) return;
        const c = Number(await p.request({ method: "eth_chainId" }));
        if (eth() === p) { setAddress(a[0]); setChainId(c); }
      }).catch(() => {});
    };
    const announced = (ev: Event) => {
      const d = (ev as CustomEvent<{ info?: Omit<WalletChoice, "provider">; provider?: Injected }>).detail;
      if (!d?.info?.uuid || typeof d.info.name !== "string" || typeof d.provider?.request !== "function") return;
      const w: WalletChoice = { ...d.info, provider: d.provider };
      setHasProvider(true);
      setWallets((all) => (all.some((x) => x.uuid === w.uuid || x.provider === w.provider) ? all : [...all, w]));
      if (w.rdns === remembered.get() && !chosen.current) { chosen.current = w.provider; attach(w.provider); restore(w.provider); }
    };
    window.addEventListener("eip6963:announceProvider", announced);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const e = eth();
    if (e) { attach(e); if (!remembered.get() || chosen.current === e) restore(e); }
    // Some wallets inject after the page has loaded.
    const late = () => { const x = eth(); if (x) attach(x); };
    window.addEventListener("ethereum#initialized", late);
    return () => { window.removeEventListener("ethereum#initialized", late); window.removeEventListener("eip6963:announceProvider", announced); };
  }, [attach]);

  const connect = useCallback(async (choice?: WalletChoice) => {
    const e = choice?.provider ?? eth();
    if (!e) throw new Error("No injected wallet found. Install QIE Wallet or a MetaMask-compatible wallet.");
    setConnecting(true);
    try {
      attach(e);
      const a = (await e.request({ method: "eth_requestAccounts" })) as string[];
      storage.set(false);
      if (choice) { chosen.current = choice.provider; remembered.set(choice.rdns); }
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
        await e.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: config.chainName, nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 }, rpcUrls: config.rpcUrls, blockExplorerUrls: [config.explorer] }] });
      } else throw err;
    }
  }, []);

  const getSigner = useCallback(async () => {
    const e = eth();
    if (!e) throw new Error("No wallet");
    return new BrowserProvider(e).getSigner();
  }, []);

  const value = useMemo<WalletState>(() => ({
    wallets, address, chainId, hasProvider, connecting, wrongNetwork: chainId !== null && chainId !== config.chainId,
    connect, disconnect: () => { storage.set(true); setAddress(null); }, switchNetwork, getSigner, readProvider,
  }), [wallets, address, chainId, hasProvider, connecting, connect, switchNetwork, getSigner]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
