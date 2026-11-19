// TEST-E01: full demo sequence on QIE mainnet (allowed, over-cap, replay, revoke, withdraw). Small amounts only.
// Env: OWNER_KEYSTORE, AGENT_KEYSTORE, PW_FILE (path to a temp password file). Output: JSON to stdout.
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Contract, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { createGateway } from "../apps/gateway/src/server";
import { DemoAgent, VAULT_ABI } from "../apps/gateway/src/agent";

const RPC = "https://rpc1mainnet.qie.digital";
const VAULT = "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c";
const TOKEN = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";
const MERCHANT = "0xceeFC1Cf07984D823Db90FaC317069F8BDCDB761";
const EXTRA = ["function revokeAgent()", "function setPolicy(address,uint256,uint256)", "function withdraw(uint256)"];

async function main() {
  const provider = new JsonRpcProvider(RPC, 1990, { staticNetwork: true, cacheTimeout: -1 });
  const pw = readFileSync(process.env.PW_FILE!, "utf8").trim();
  const load = async (p: string) => new NonceManager((await Wallet.fromEncryptedJson(readFileSync(p, "utf8"), pw)).connect(provider));
  const owner = await load(process.env.OWNER_KEYSTORE!), agent = await load(process.env.AGENT_KEYSTORE!);
  const ownerAddr = await owner.getAddress(), agentAddr = await agent.getAddress();
  const ov = new Contract(VAULT, [...VAULT_ABI, ...EXTRA], owner);

  const gw = createGateway({ RPC_URL_1: RPC, RPC_URL_2: "https://rpc2mainnet.qie.digital", CHAIN_ID: "1990", QUSDC_ADDRESS: TOKEN, ALLOWANCE_ADDRESS: VAULT, MERCHANT_ADDRESS: MERCHANT,
    HMAC_SECRET: "demo-run-secret-not-for-production-0123456789abcdef", DB_PATH: join(mkdtempSync(join(tmpdir(), "demo-")), "d.sqlite"), CONFIRMATIONS: "2", OWN_ADDRESSES: `${ownerAddr},${agentAddr}` });
  const server = await new Promise<any>((r) => { const s = gw.app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = new DemoAgent({ baseUrl: base, resourcePath: "/v1/block-summary", signer: agent, provider, vault: VAULT, owner: ownerAddr });
  const out: Record<string, unknown> = {};

  out["1_allowed"] = await a.paidCall();
  out["2_over_cap"] = await a.overCap();
  out["3_replay"] = await a.replay();
  const rv = await ov.revokeAgent(); await rv.wait(); out["4_owner_revoke_tx"] = rv.hash;
  out["5_agent_after_revoke"] = await a.paidCall();
  const ps = await ov.setPolicy(agentAddr, 10000n, 30000n); await ps.wait(); out["6_owner_restores_policy_tx"] = ps.hash;
  const wd = await ov.withdraw(1000n); await wd.wait(); out["7_owner_withdraw_1000_tx"] = wd.hash;
  out["8_stats"] = await (await fetch(base + "/v1/stats")).json();
  out["9_account"] = String(await new Contract(VAULT, VAULT_ABI, provider).account(ownerAddr));
  server.close(); gw.close(); provider.destroy();
  console.log(JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
