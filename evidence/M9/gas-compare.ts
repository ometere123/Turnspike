// Measures pay() gas for whichever TurnpikeAllowance artifact the hardhat project compiled (run once in the clean repo,
// once in the instrumented worktree). Local in-process Hardhat network only, labelled mock token.
import { ethers } from "hardhat";

async function main() {
  const [owner, agent, merchant] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy();
  const vault = await (await ethers.getContractFactory("TurnpikeAllowance")).deploy(await token.getAddress(), 5_000_000n);
  await (await (token as any).mint(owner.address, 1_000_000n)).wait();
  await (await (token as any).approve(await vault.getAddress(), 1_000_000n)).wait();
  await (await (vault as any).deposit(100_000n)).wait();
  await (await (vault as any).setPolicy(agent.address, 10_000n, 30_000n)).wait();
  await (await (vault as any).setMerchant(merchant.address, true)).wait();
  const gas: bigint[] = [];
  for (let i = 0; i < 3; i++) {
    const rc = await (await (vault.connect(agent) as any).pay(owner.address, merchant.address, ethers.id("g" + i), 1000n)).wait();
    gas.push(rc!.gasUsed);
  }
  const code = await ethers.provider.getCode(await vault.getAddress());
  console.log(JSON.stringify({ runtimeBytes: (code.length - 2) / 2, payGas: gas.map(String) }));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
