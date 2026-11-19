// Phase A: READ-ONLY audit of QIE Mainnet. Only eth_chainId / eth_getCode / eth_call / eth_getStorageAt. No signing, no sends.
import { JsonRpcProvider, Interface, id, Contract, getAddress } from "ethers";
const RPCS = ["https://rpc1mainnet.qie.digital", "https://rpc2mainnet.qie.digital"];
const VAULT = "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c";
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const CANDIDATES = {
  "Permit2 (canonical)": "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  "x402ExactPermit2Proxy": "0x402085c248EeA27D92E8b30b2C58ed07f9E20001",
  "x402UptoPermit2Proxy": "0x4020A4f3b7b90ccA423B9fabCc0CE57C6C240002",
  "x402UptoPermit2Proxy (Base Sepolia legacy)": "0x402039b3d6E6BEC5A02c2C9fd937ac17A6940002",
  "x402BatchSettlement": "0x4020074e9dF2ce1deE5A9C1b5c3f541D02a10003",
  "ERC3009DepositCollector": "0x4020806089470a89826cB9fB1f4059150b550004",
  "Permit2DepositCollector": "0x4020425FAf3B746C082C2f942b4E5159887B0005",
  "CREATE2 deployer (Arachnid)": "0x4e59b44847b379578588920cA78FbF26c0B4956C",
  "Multicall3": "0xcA11bde05977b3631167028862bE2a173976CA11",
};
const out = { rpcs: {}, candidates: {}, qusdc: {}, vault: {} };
for (const u of RPCS) {
  const p = new JsonRpcProvider(u, undefined, { staticNetwork: false });
  try { const n = await p.getNetwork(); out.rpcs[u] = { chainId: Number(n.chainId), block: await p.getBlockNumber() }; } catch (e) { out.rpcs[u] = { error: String(e.message).slice(0, 100) }; }
  p.destroy();
}
const p = new JsonRpcProvider(RPCS[0], 1990, { staticNetwork: true });
const hasCode = async (a) => { const c = await p.getCode(a); return { bytes: (c.length - 2) / 2, keccak: c === "0x" ? null : id(c).slice(0, 18) }; };
for (const [k, a] of Object.entries(CANDIDATES)) out.candidates[k] = { address: a, ...(await hasCode(a)) };

// ---- QUSDC: selector scan + live calls
const code = (await p.getCode(QUSDC)).toLowerCase();
const sig = (s) => id(s).slice(0, 10);
const sels = {
  "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32) [EIP-3009]": "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
  "transferWithAuthorization(...,bytes signature) [EIP-3009 bytes variant]": "transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)",
  "receiveWithAuthorization(...) [EIP-3009]": "receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)",
  "authorizationState(address,bytes32) [EIP-3009]": "authorizationState(address,bytes32)",
  "permit(address,address,uint256,uint256,uint8,bytes32,bytes32) [EIP-2612]": "permit(address,address,uint256,uint256,uint8,bytes32,bytes32)",
  "nonces(address) [EIP-2612]": "nonces(address)",
  "DOMAIN_SEPARATOR() [EIP-2612]": "DOMAIN_SEPARATOR()",
  "eip712Domain() [EIP-5267]": "eip712Domain()",
  "version()": "version()", "name()": "name()", "symbol()": "symbol()", "decimals()": "decimals()", "totalSupply()": "totalSupply()",
  "transfer(address,uint256)": "transfer(address,uint256)", "approve(address,uint256)": "approve(address,uint256)", "transferFrom(address,address,uint256)": "transferFrom(address,address,uint256)",
  "owner()": "owner()", "mint(address,uint256)": "mint(address,uint256)", "pause()": "pause()", "blacklist(address)": "blacklist(address)", "implementation()": "implementation()",
};
out.qusdc.codeBytes = (code.length - 2) / 2;
out.qusdc.selectorPresentInBytecode = {};
for (const [label, s] of Object.entries(sels)) out.qusdc.selectorPresentInBytecode[label] = code.includes(sig(s).slice(2));
const tryCall = async (s, args = []) => { try { const i = new Interface([`function ${s}`]); const f = i.getFunction(s.split("(")[0]); const r = await p.call({ to: QUSDC, data: i.encodeFunctionData(f, args) }); return r === "0x" ? "empty-return" : i.decodeFunctionResult(f, r).map(String).join(","); } catch (e) { return "revert/err"; } };
out.qusdc.calls = {
  name: await tryCall("name() view returns (string)"), symbol: await tryCall("symbol() view returns (string)"), decimals: await tryCall("decimals() view returns (uint8)"),
  version: await tryCall("version() view returns (string)"), DOMAIN_SEPARATOR: await tryCall("DOMAIN_SEPARATOR() view returns (bytes32)"),
  nonces_zero: await tryCall("nonces(address) view returns (uint256)", ["0x0000000000000000000000000000000000000001"]),
  authorizationState: await tryCall("authorizationState(address,bytes32) view returns (bool)", ["0x0000000000000000000000000000000000000001", "0x" + "00".repeat(32)]),
  eip712Domain: await tryCall("eip712Domain() view returns (bytes1,string,string,uint256,address,bytes32,uint256[])"),
  totalSupply: await tryCall("totalSupply() view returns (uint256)"),
};
// EIP-1967 implementation slot (proxy?)
out.qusdc.eip1967ImplSlot = await p.getStorage(QUSDC, "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc");
// ---- Vault
const v = new Contract(VAULT, ["function token() view returns (address)", "function depositCap() view returns (uint256)"], p);
out.vault.codeBytes = (await hasCode(VAULT)).bytes;
out.vault.token = await v.token(); out.vault.tokenIsQUSDC = getAddress(out.vault.token) === getAddress(QUSDC); out.vault.depositCap = String(await v.depositCap());
const vcode = (await p.getCode(VAULT)).toLowerCase();
out.vault.selectorPresent = Object.fromEntries(["pay(address,address,bytes32,uint256)", "account(address)", "isUsed(address,bytes32)", "allowedMerchant(address,address)", "setPolicy(address,uint256,uint256)", "setPaused(bool)", "revokeAgent()", "payFor(address,address,bytes32,uint256)", "owner()", "upgradeTo(address)"].map((s) => [s, vcode.includes(sig(s).slice(2))]));
console.log(JSON.stringify(out, null, 2));
