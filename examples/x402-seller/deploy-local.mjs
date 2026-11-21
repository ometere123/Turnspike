// Deploys MockERC20 (labelled test token) and TurnpikeAllowance(token, depositCap) on a LOCAL Hardhat node and sets up
// an owner account so an agent can pay the standalone seller. Refuses any chain other than 31337.
// Keys are the public Hardhat test mnemonic: owner = account 0, agent = account 1, merchant = account 2 (address only).
//   npx hardhat node                                  # terminal 1, port 8545 (repository root, after `npx hardhat compile`)
//   node examples/x402-seller/deploy-local.mjs        # terminal 2; RPC_URL overrides http://127.0.0.1:8545
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, HDNodeWallet, JsonRpcProvider, NonceManager } from "ethers";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const PHRASE = "test test test test test test test test test test test junk"; // public Hardhat test mnemonic
const art = (p) => JSON.parse(readFileSync(join(root, "artifacts/contracts", p), "utf8"));

const provider = new JsonRpcProvider(RPC);
const { chainId } = await provider.getNetwork();
if (chainId !== 31337n) { console.error(`refusing: ${RPC} is chain ${chainId}, not the local Hardhat chain 31337`); process.exit(2); }
const w = (i) => HDNodeWallet.fromPhrase(PHRASE, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
const owner = new NonceManager(w(0)), agent = w(1).address, merchant = w(2).address;
const t = art("test-helpers/MockERC20.sol/MockERC20.json"), v = art("TurnpikeAllowance.sol/TurnpikeAllowance.json");
const token = await (await new ContractFactory(t.abi, t.bytecode, owner).deploy()).waitForDeployment();
const vault = await (await new ContractFactory(v.abi, v.bytecode, owner).deploy(await token.getAddress(), 5_000_000n)).waitForDeployment();
await (await token.mint(w(0).address, 10_000_000n)).wait();
await (await token.approve(await vault.getAddress(), 10n ** 12n)).wait();
await (await vault.deposit(1_000_000n)).wait();                       // 1.0000 test tokens
await (await vault.setPolicy(agent, 10_000n, 100_000n)).wait();       // per call 0.01, daily 0.1
await (await vault.setMerchant(merchant, true)).wait();
console.log(`CONTRACT=${await vault.getAddress()}`);
console.log(`TOKEN=${await token.getAddress()}`);
console.log(`MERCHANT=${merchant}`);
console.log(`# owner ${w(0).address} deposited 1.0000; agent ${agent} per-call 0.01, daily 0.1; merchant allowlisted`);
provider.destroy();
