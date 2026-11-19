// Browser-console snippet for manual end-to-end testing of apps/web against a LOCAL chain-1990 node (see scripts/e2e-setup.ts).
// It installs a minimal EIP-1193 provider that forwards to the local Hardhat node, whose default accounts are unlocked.
// This is a test double for a wallet. It is not a real wallet and proves nothing about QIE Wallet or MetaMask behaviour.
(() => {
  const RPC = "http://127.0.0.1:8545";
  const rpc = async (method, params = []) => {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    const j = await r.json();
    if (j.error) { const e = new Error(j.error.message); e.code = j.error.code; e.data = j.error.data; throw e; }
    return j.result;
  };
  const handlers = {};
  const st = { chain: "0x7c6", acct: 0, reject: false, log: [] }; // st.reject = true simulates the user rejecting; st.chain = "0x1" simulates the wrong network
  const emit = (e, v) => (handlers[e] || []).forEach((cb) => cb(v));
  window.__mock = st;
  window.__mockEmit = emit;
  window.ethereum = {
    isMock: true,
    on: (e, cb) => { (handlers[e] ||= []).push(cb); },
    removeListener: () => {},
    request: async ({ method, params }) => {
      st.log.push(method);
      const accounts = await rpc("eth_accounts");
      if (method === "eth_requestAccounts" || method === "eth_accounts") {
        if (st.reject && method === "eth_requestAccounts") { const e = new Error("User rejected the request."); e.code = 4001; throw e; }
        return [accounts[st.acct]];
      }
      if (method === "eth_chainId") return st.chain;
      if (method === "wallet_switchEthereumChain") { st.chain = params[0].chainId; emit("chainChanged", st.chain); return null; }
      if (method === "eth_sendTransaction" && st.reject) { const e = new Error("User denied transaction signature."); e.code = 4001; throw e; }
      return rpc(method, params);
    },
  };
  window.dispatchEvent(new Event("ethereum#initialized"));
})();
