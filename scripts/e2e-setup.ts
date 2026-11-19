// Deploys MockERC20 (labelled test double) and the real TurnpikeAllowance to a local chain-1990 node for browser tests.
// Usage: npx hardhat --config hardhat.e2e.config.ts node   (other terminal)   npx ts-node --transpile-only scripts/e2e-setup.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet } from "ethers";

const art = (p: string) => JSON.parse(readFileSync(join(__dirname, "../artifacts/contracts", p), "utf8"));

async function main() {
  const provider = new JsonRpcProvider("http://127.0.0.1:8545", 1990, { staticNetwork: true });
  const accounts = await provider.send("eth_accounts", []);
  // Hardhat's node holds its default accounts unlocked, so use the JSON-RPC signer for account 0.
  const signer = await provider.getSigner(accounts[0]);
  const m = art("test-helpers/MockERC20.sol/MockERC20.json");
  const v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
  const token = await new ContractFactory(m.abi, m.bytecode, signer).deploy();
  await token.waitForDeployment();
  const vault = await new ContractFactory(v.abi, v.bytecode, signer).deploy(await token.getAddress(), 5_000_000n);
  await vault.waitForDeployment();
  const block = await provider.getBlockNumber();
  for (const a of accounts.slice(0, 3)) await ((token as any).mint(a, 100_000_000n).then((t: any) => t.wait()));
  console.log(JSON.stringify({ accounts: accounts.slice(0, 4), token: await token.getAddress(), vault: await vault.getAddress(), deployBlock: block, merchant: accounts[3] }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
