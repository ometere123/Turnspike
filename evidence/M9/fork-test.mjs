// M9 step 4 (local fork only): run from the repository root with a Hardhat fork node listening on 127.0.0.1:8690:
//   node evidence/M9/fork-test.mjs
// Exercises the DEPLOYED TurnpikeAllowance (instrumented runtime, real mainnet state) on a LOCAL Hardhat fork of QIE
// Mainnet. Owner and agent are impersonated on the fork only; nothing here is signed with a real key or broadcast to
// mainnet. Every check compares the observed result with what the clean build's tests require.
import { JsonRpcProvider, Contract, Interface, keccak256, toUtf8Bytes, parseEther } from "ethers";
import { readFileSync, writeFileSync } from "node:fs";

const p = new JsonRpcProvider("http://127.0.0.1:8690", undefined, { staticNetwork: false, cacheTimeout: -1 });
const VAULT = "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c";
const QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const OWNER = "0x77918289D518303DDE4f84098B507bdB1dc73E4C";
const AGENT = "0xF35F4facb4c9e0ceb836bF350203F67F290F6433";
const MERCHANT = "0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761";
const STRANGER = "0x000000000000000000000000000000000000bEEF";
const abi = JSON.parse(readFileSync("evidence/M9/data/verified_abi.json", "utf8"));
const iface = new Interface(abi);
const erc20 = new Interface(["function balanceOf(address) view returns (uint256)", "event Transfer(address indexed,address indexed,uint256)"]);
const results = [];
const log = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail ?? ""}`); };

for (let i = 0; i < 60; i++) { try { await p.getBlockNumber(); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
await p.send("evm_mine", []);
const forkBlock = await p.getBlockNumber();
const code = await p.getCode(VAULT);
const onchain = readFileSync("evidence/M9/data/onchain_runtime.hex", "utf8").trim();
log("fork serves the deployed runtime", code.toLowerCase() === onchain.toLowerCase(), `block ${forkBlock}, ${(code.length - 2) / 2} bytes`);

for (const a of [OWNER, AGENT, STRANGER]) {
  await p.send("hardhat_impersonateAccount", [a]);
  await p.send("hardhat_setBalance", [a, "0x" + parseEther("10").toString(16)]);
}

const send = async (from, fn, args) => {
  const data = iface.encodeFunctionData(fn, args);
  try {
    const hash = await p.send("eth_sendTransaction", [{ from, to: VAULT, data, gas: "0x7a120" }]);
    const rc = await p.waitForTransaction(hash);
    return { ok: rc.status === 1, rc };
  } catch (e) {
    const d = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
    let name = null; try { name = iface.parseError(typeof d === "string" ? d : d?.data)?.name; } catch {}
    return { ok: false, err: name ?? (e?.shortMessage ?? e?.message ?? String(e)).slice(0, 120) };
  }
};
const read = async (fn, args) => iface.decodeFunctionResult(fn, await p.call({ to: VAULT, data: iface.encodeFunctionData(fn, args) }));
const bal = async (a) => erc20.decodeFunctionResult("balanceOf", await p.call({ to: QUSDC, data: erc20.encodeFunctionData("balanceOf", [a]) }))[0];

const acct = (await read("account", [OWNER]))[0];
log("owner account readable on fork", true, `balance ${acct.balance}, perCall ${acct.perCallCap}, daily ${acct.dailyCap}, agent ${acct.agent}, paused ${acct.paused}`);
const agentNow = acct.agent.toLowerCase() === AGENT.toLowerCase();
if (!agentNow) { const r = await send(OWNER, "setPolicy", [AGENT, acct.perCallCap, acct.dailyCap]); log("(fork setup) owner re-authorises agent", r.ok, r.err); }

// 1. Owner authorization: a stranger and the agent cannot change the owner's account.
let r = await send(STRANGER, "pay", [OWNER, MERCHANT, keccak256(toUtf8Bytes("fork-stranger")), 1000n]);
log("stranger cannot pay from owner's account", !r.ok, r.err);
r = await send(AGENT, "setPolicy", [AGENT, 10n ** 12n, 10n ** 12n]);
const afterAgentSet = (await read("account", [OWNER]))[0];
log("agent's setPolicy only touches the agent's own account, owner's caps unchanged", afterAgentSet.perCallCap === acct.perCallCap && afterAgentSet.dailyCap === acct.dailyCap, r.ok ? "call succeeded on agent's own (empty) account" : r.err);
{
  const agentTokBefore = await bal(AGENT), vaultTokBefore = await bal(VAULT);
  const ownerAcctBefore = (await read("account", [OWNER]))[0].balance;
  r = await send(AGENT, "withdraw", [1n]);
  const agentTokAfter = await bal(AGENT), vaultTokAfter = await bal(VAULT);
  const ownerAcctAfter = (await read("account", [OWNER]))[0].balance;
  log("agent cannot withdraw the owner's funds", !r.ok && agentTokAfter === agentTokBefore && vaultTokAfter === vaultTokBefore && ownerAcctAfter === ownerAcctBefore,
    `${r.ok ? "withdraw unexpectedly succeeded" : r.err}; agent QUSDC ${agentTokBefore}->${agentTokAfter}, vault QUSDC ${vaultTokBefore}->${vaultTokAfter}, owner account ${ownerAcctBefore}->${ownerAcctAfter}`);
}

// 2. Spending limits.
const per = acct.perCallCap;
r = await send(AGENT, "pay", [OWNER, MERCHANT, keccak256(toUtf8Bytes("fork-overcap")), per + 1n]);
log("per-call cap + 1 is refused", !r.ok && /CapExceeded/.test(r.err ?? ""), r.err);

// 3. Merchant restriction.
r = await send(AGENT, "pay", [OWNER, STRANGER, keccak256(toUtf8Bytes("fork-unlisted")), 1000n]);
log("unlisted merchant is refused", !r.ok && /MerchantNotAllowed/.test(r.err ?? ""), r.err);

// 4. Replay protection: the requestId paid on 19 Nov 2026 cannot be paid again.
const used = "0x489a99f1290bb8195fadb743476735a1e3c8330e0a0f91c377c1bc1704d374fa";
log("19 Nov requestId is recorded as used", (await read("isUsed", [MERCHANT, used]))[0] === true);
r = await send(AGENT, "pay", [OWNER, MERCHANT, used, 1000n]);
log("replay of a paid requestId is refused", !r.ok && /RequestAlreadyUsed/.test(r.err ?? ""), r.err);

// 5. A valid payment moves exactly the amount and emits Paid; no other side effects.
const before = { vault: await bal(VAULT), merchant: await bal(MERCHANT), owner: (await read("account", [OWNER]))[0].balance, spent: (await read("spentToday", [OWNER]))[0] };
const rid = keccak256(toUtf8Bytes("fork-valid-" + forkBlock));
r = await send(AGENT, "pay", [OWNER, MERCHANT, rid, 1000n]);
const after = { vault: await bal(VAULT), merchant: await bal(MERCHANT), owner: (await read("account", [OWNER]))[0].balance, spent: (await read("spentToday", [OWNER]))[0] };
const paidLogs = r.rc?.logs?.filter((l) => l.address.toLowerCase() === VAULT).map((l) => { try { return iface.parseLog(l)?.name; } catch { return "?"; } }) ?? [];
const tokLogs = r.rc?.logs?.filter((l) => l.address.toLowerCase() === QUSDC.toLowerCase()).length ?? 0;
log("valid pay succeeds", r.ok, r.err ?? `gas ${r.rc?.gasUsed}`);
log("exactly 1000 base units move vault -> merchant", before.vault - after.vault === 1000n && after.merchant - before.merchant === 1000n);
log("owner balance and spentToday change by exactly 1000", before.owner - after.owner === 1000n && after.spent - before.spent === 1000n);
log("events: one Paid from the vault, one QUSDC Transfer, nothing else", paidLogs.join(",") === "Paid" && tokLogs === 1, `vault events [${paidLogs}], token logs ${tokLogs}`);
r = await send(AGENT, "pay", [OWNER, MERCHANT, rid, 1000n]);
log("same requestId again is refused", !r.ok && /RequestAlreadyUsed/.test(r.err ?? ""), r.err);

// 6. Pause and revoke.
r = await send(OWNER, "setPaused", [true]);
r = await send(AGENT, "pay", [OWNER, MERCHANT, keccak256(toUtf8Bytes("fork-paused")), 1000n]);
log("paused account refuses pay", !r.ok && /Paused/.test(r.err ?? ""), r.err);
await send(OWNER, "setPaused", [false]);
await send(OWNER, "revokeAgent", []);
r = await send(AGENT, "pay", [OWNER, MERCHANT, keccak256(toUtf8Bytes("fork-revoked")), 1000n]);
log("revoked agent is refused", !r.ok && /NotOwnerAgent/.test(r.err ?? ""), r.err);

// 7. Withdrawals: owner can withdraw while revoked and paused; over-withdraw refused.
await send(OWNER, "setPaused", [true]);
const ob = (await read("account", [OWNER]))[0].balance;
const wb = await bal(OWNER);
r = await send(OWNER, "withdraw", [ob]);
log("owner withdraws full balance while paused and revoked", r.ok && (await bal(OWNER)) - wb === ob && (await read("account", [OWNER]))[0].balance === 0n, r.err ?? `${ob} base units`);
r = await send(OWNER, "withdraw", [1n]);
log("over-withdraw is refused", !r.ok, r.err);

writeFileSync("evidence/M9/outputs/fork-results.json", JSON.stringify({ forkBlock, results }, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
console.log(`\n${results.filter((x) => x.ok).length}/${results.length} checks passed`);
