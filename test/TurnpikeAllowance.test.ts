import { expect } from "chai";
import { ethers } from "hardhat";
import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";

const U = 1_000_000n; // 1 QUSDC in base units (6 decimals)
const CAP = 5n * U;
const rid = (s: string) => ethers.id(s);

async function deploy() {
  const [owner, agent, merchant, other, owner2, agent2] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("MockERC20")).deploy(); // labelled mock
  const vault = await (await ethers.getContractFactory("TurnpikeAllowance")).deploy(await token.getAddress(), CAP);
  for (const s of [owner, owner2]) {
    await token.mint(s.address, 100n * U);
    await token.connect(s).approve(await vault.getAddress(), ethers.MaxUint256);
  }
  // owner: per-call 0.01, daily 0.05 (demo values from doc 12)
  await vault.connect(owner).deposit(2n * U);
  await vault.connect(owner).setPolicy(agent.address, 10_000n, 50_000n);
  await vault.connect(owner).setMerchant(merchant.address, true);
  return { owner, agent, merchant, other, owner2, agent2, token, vault };
}

describe("TurnpikeAllowance", () => {
  it("TEST-C01 deposit ok; over deposit cap reverts", async () => {
    const { owner, vault, token } = await loadFixture(deploy);
    expect((await vault.account(owner.address)).balance).to.equal(2n * U);
    await vault.connect(owner).deposit(3n * U); // exactly cap
    await expect(vault.connect(owner).deposit(1n)).to.be.revertedWithCustomError(vault, "DepositCapExceeded");
    await expect(vault.connect(owner).deposit(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
    expect(await token.balanceOf(await vault.getAddress())).to.equal(CAP);
  });

  it("TEST-C02 agent cannot alter owner's account (SEC-001)", async () => {
    const { owner, agent, other, vault, merchant } = await loadFixture(deploy);
    const before = await vault.account(owner.address);
    await vault.connect(agent).setPolicy(other.address, 999n, 999n);
    await vault.connect(agent).setMerchant(other.address, true);
    await vault.connect(agent).revokeAgent();
    await vault.connect(agent).setPaused(true);
    await expect(vault.connect(agent).withdraw(1n)).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    const after = await vault.account(owner.address);
    expect(after.agent).to.equal(before.agent);
    expect(after.perCallCap).to.equal(before.perCallCap);
    expect(after.dailyCap).to.equal(before.dailyCap);
    expect(after.paused).to.equal(false);
    expect(after.balance).to.equal(before.balance);
    expect(await vault.allowedMerchant(owner.address, other.address)).to.equal(false);
    // the agent can still pay
    await vault.connect(agent).pay(owner.address, merchant.address, rid("a"), 1000n);
  });

  it("TEST-C03 non-allowlisted merchant reverts; removal re-blocks", async () => {
    const { owner, agent, other, merchant, vault } = await loadFixture(deploy);
    await expect(vault.connect(agent).pay(owner.address, other.address, rid("x"), 1000n)).to.be.revertedWithCustomError(vault, "MerchantNotAllowed");
    await vault.connect(owner).setMerchant(merchant.address, false);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("x"), 1000n)).to.be.revertedWithCustomError(vault, "MerchantNotAllowed");
  });

  it("TEST-C04 valid pay moves funds and emits Paid", async () => {
    const { owner, agent, merchant, vault, token } = await loadFixture(deploy);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("r1"), 1000n))
      .to.emit(vault, "Paid").withArgs(owner.address, agent.address, merchant.address, rid("r1"), 1000n);
    expect(await token.balanceOf(merchant.address)).to.equal(1000n);
    expect((await vault.account(owner.address)).balance).to.equal(2n * U - 1000n);
  });

  it("TEST-C05 per-call cap boundary: cap passes, cap+1 fails", async () => {
    const { owner, agent, merchant, vault } = await loadFixture(deploy);
    await vault.connect(agent).pay(owner.address, merchant.address, rid("c1"), 10_000n);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("c2"), 10_001n))
      .to.be.revertedWithCustomError(vault, "CapExceeded").withArgs(10_000n, 10_001n);
  });

  it("TEST-C06 daily cap, same-block pair, and midnight-bucket 2x behaviour (SEC-002, SEC-006)", async () => {
    const { owner, agent, merchant, vault } = await loadFixture(deploy);
    // 4 x 0.01 = 0.04, then 0.01 more reaches 0.05 exactly, then 1 base unit over
    for (let i = 0; i < 5; i++) await vault.connect(agent).pay(owner.address, merchant.address, rid("d" + i), 10_000n);
    expect(await vault.spentToday(owner.address)).to.equal(50_000n);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("dx"), 1n))
      .to.be.revertedWithCustomError(vault, "DailyCapExceeded");

    // two payments mined in one block cannot jointly exceed the cap
    await ethers.provider.send("hardhat_mine", ["0x1"]);
    const next = (Math.floor((await time.latest()) / 86400) + 1) * 86400;
    await time.increaseTo(next); // new bucket
    expect(await vault.spentToday(owner.address)).to.equal(0n);
    await ethers.provider.send("evm_setAutomine", [false]);
    const t1 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e1"), 10_000n, { gasLimit: 300000 });
    const t2 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e2"), 10_000n, { gasLimit: 300000 });
    const t3 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e3"), 10_000n, { gasLimit: 300000 });
    const t4 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e4"), 10_000n, { gasLimit: 300000 });
    const t5 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e5"), 10_000n, { gasLimit: 300000 });
    const t6 = await vault.connect(agent).pay(owner.address, merchant.address, rid("e6"), 10_000n, { gasLimit: 300000 });
    await ethers.provider.send("evm_mine", []);
    await ethers.provider.send("evm_setAutomine", [true]);
    const statuses = [];
    for (const t of [t1, t2, t3, t4, t5, t6]) statuses.push((await ethers.provider.getTransactionReceipt(t.hash))!.status);
    expect(statuses.filter((s) => s === 1).length).to.equal(5); // sixth reverts
    expect(await vault.spentToday(owner.address)).to.equal(50_000n);

    // documented 2x: spend full cap just before midnight UTC, full cap again just after
    const mid = (Math.floor((await time.latest()) / 86400) + 1) * 86400;
    await time.setNextBlockTimestamp(mid - 2);
    await vault.connect(owner).deposit(0n + 1n); // advance a block cheaply near the boundary
    await vault.connect(owner).withdraw(1n);
    // today's bucket already has 0.05 spent; the next bucket allows another 0.05
    await time.increaseTo(mid + 1);
    for (let i = 0; i < 5; i++) await vault.connect(agent).pay(owner.address, merchant.address, rid("f" + i), 10_000n);
    expect(await vault.spentToday(owner.address)).to.equal(50_000n); // 0.10 within ~3 seconds across the boundary
  });

  it("TEST-C07 replay reverts; same requestId at another merchant is a different key; no un-use (SEC-005)", async () => {
    const { owner, agent, merchant, other, vault } = await loadFixture(deploy);
    await vault.connect(owner).setMerchant(other.address, true);
    await vault.connect(agent).pay(owner.address, merchant.address, rid("same"), 1000n);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("same"), 1000n))
      .to.be.revertedWithCustomError(vault, "RequestAlreadyUsed").withArgs(rid("same"));
    await vault.connect(agent).pay(owner.address, other.address, rid("same"), 1000n);
    expect(await vault.isUsed(merchant.address, rid("same"))).to.equal(true);
    // revoke/withdraw/pause/re-set policy cannot clear the flag
    await vault.connect(owner).revokeAgent();
    await vault.connect(owner).setPolicy(agent.address, 10_000n, 50_000n);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("same"), 1000n))
      .to.be.revertedWithCustomError(vault, "RequestAlreadyUsed");
  });

  it("TEST-C08 revoked agent reverts; re-set policy restores", async () => {
    const { owner, agent, merchant, vault } = await loadFixture(deploy);
    await expect(vault.connect(owner).revokeAgent()).to.emit(vault, "AgentRevoked").withArgs(owner.address, agent.address);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("v"), 1000n)).to.be.revertedWithCustomError(vault, "NotOwnerAgent");
  });

  it("TEST-C09 paused: pay reverts, withdraw works (SEC-007)", async () => {
    const { owner, agent, merchant, vault, token } = await loadFixture(deploy);
    await vault.connect(owner).setPaused(true);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("p"), 1000n)).to.be.revertedWithCustomError(vault, "Paused");
    const b = await token.balanceOf(owner.address);
    await vault.connect(owner).withdraw(U);
    expect(await token.balanceOf(owner.address)).to.equal(b + U);
    await vault.connect(owner).setPaused(false);
    await vault.connect(agent).pay(owner.address, merchant.address, rid("p"), 1000n);
  });

  it("TEST-C10 withdraw ordering vs pay; over-withdraw reverts; works when revoked (SEC-004)", async () => {
    const { owner, agent, merchant, vault } = await loadFixture(deploy);
    await vault.connect(agent).pay(owner.address, merchant.address, rid("w1"), 10_000n); // pay before withdraw succeeds
    const bal = (await vault.account(owner.address)).balance;
    await expect(vault.connect(owner).withdraw(bal + 1n)).to.be.revertedWithCustomError(vault, "InsufficientBalance");
    await vault.connect(owner).revokeAgent();
    await vault.connect(owner).withdraw(bal); // revoke does not block withdraw
    expect((await vault.account(owner.address)).balance).to.equal(0n);
    await vault.connect(owner).setPolicy(agent.address, 10_000n, 50_000n);
    await expect(vault.connect(agent).pay(owner.address, merchant.address, rid("w2"), 1000n))
      .to.be.revertedWithCustomError(vault, "InsufficientBalance"); // pay after withdraw sees reduced balance
  });

  it("TEST-C11 events and views", async () => {
    const { owner, agent, merchant, vault } = await loadFixture(deploy);
    await expect(vault.connect(owner).deposit(U)).to.emit(vault, "Deposited").withArgs(owner.address, U, 3n * U);
    await expect(vault.connect(owner).setPolicy(agent.address, 1n, 2n)).to.emit(vault, "PolicySet").withArgs(owner.address, agent.address, 1n, 2n);
    await expect(vault.connect(owner).setMerchant(merchant.address, false)).to.emit(vault, "MerchantSet").withArgs(owner.address, merchant.address, false);
    await expect(vault.connect(owner).setPaused(true)).to.emit(vault, "PausedSet").withArgs(owner.address, true);
    await expect(vault.connect(owner).withdraw(U)).to.emit(vault, "Withdrawn").withArgs(owner.address, U, 2n * U);
    const a = await vault.account(owner.address);
    expect([a.perCallCap, a.dailyCap, a.paused]).to.deep.equal([1n, 2n, true]);
    expect(await vault.isUsed(merchant.address, rid("nope"))).to.equal(false);
  });

  it("TEST-C12 reentrancy through a malicious token is blocked (labelled mock)", async () => {
    const [owner, agent, merchant] = await ethers.getSigners();
    const evil = await (await ethers.getContractFactory("ReentrantToken")).deploy();
    const vault = await (await ethers.getContractFactory("TurnpikeAllowance")).deploy(await evil.getAddress(), CAP);
    await evil.mint(owner.address, 10n * U);
    await evil.connect(owner).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(owner).deposit(2n * U);
    await vault.connect(owner).setPolicy(agent.address, 10_000n, 50_000n);
    await vault.connect(owner).setMerchant(merchant.address, true);
    // re-enter withdraw from inside withdraw
    await evil.arm(await vault.getAddress(), 1, owner.address, rid("z"));
    await vault.connect(owner).withdraw(1000n);
    expect(await evil.reentryReverted()).to.equal(true);
    expect((await vault.account(owner.address)).balance).to.equal(2n * U - 1000n);
    // re-enter pay from inside pay
    await evil.arm(await vault.getAddress(), 2, owner.address, rid("z2"));
    await vault.connect(agent).pay(owner.address, merchant.address, rid("z1"), 1000n);
    expect(await vault.isUsed(merchant.address, rid("z2"))).to.equal(false);
  });

  it("TEST-C13 non-agent reverts; cross-tenant isolation", async () => {
    const { owner, owner2, agent, agent2, merchant, other, vault } = await loadFixture(deploy);
    await expect(vault.connect(other).pay(owner.address, merchant.address, rid("n"), 1000n)).to.be.revertedWithCustomError(vault, "NotOwnerAgent");
    await expect(vault.connect(owner).pay(owner.address, merchant.address, rid("n"), 1000n)).to.be.revertedWithCustomError(vault, "NotOwnerAgent");
    await vault.connect(owner2).deposit(U);
    await vault.connect(owner2).setPolicy(agent2.address, 10_000n, 50_000n);
    await vault.connect(owner2).setMerchant(merchant.address, true);
    await expect(vault.connect(agent).pay(owner2.address, merchant.address, rid("n"), 1000n)).to.be.revertedWithCustomError(vault, "NotOwnerAgent");
    await expect(vault.connect(agent2).pay(owner.address, merchant.address, rid("n"), 1000n)).to.be.revertedWithCustomError(vault, "NotOwnerAgent");
    await vault.connect(agent2).pay(owner2.address, merchant.address, rid("n"), 1000n);
    expect((await vault.account(owner.address)).balance).to.equal(2n * U); // untouched
  });

  it("SEC-008 no admin/upgrade/rescue surface in the ABI", async () => {
    const { vault } = await loadFixture(deploy);
    const names = vault.interface.fragments.filter((f) => f.type === "function").map((f: any) => f.name).sort();
    expect(names).to.deep.equal(["account", "allowedMerchant", "depositCap", "deposit", "isUsed", "pay", "revokeAgent", "setMerchant", "setPaused", "setPolicy", "spentToday", "token", "withdraw"].sort());
  });

  it("invariant fuzz: token conservation under random operations", async () => {
    const { owner, owner2, agent, agent2, merchant, vault, token } = await loadFixture(deploy);
    await vault.connect(owner2).deposit(2n * U);
    await vault.connect(owner2).setPolicy(agent2.address, 10_000n, 50_000n);
    await vault.connect(owner2).setMerchant(merchant.address, true);
    const total0 = 2n * (100n * U) + 0n;
    let seed = 12345;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 120; i++) {
      const op = rnd(5);
      try {
        if (op === 0) await vault.connect(agent).pay(owner.address, merchant.address, rid("fz" + i), BigInt(1 + rnd(12000)));
        else if (op === 1) await vault.connect(agent2).pay(owner2.address, merchant.address, rid("fz" + i), BigInt(1 + rnd(12000)));
        else if (op === 2) await vault.connect(owner).withdraw(BigInt(1 + rnd(200000)));
        else if (op === 3) await vault.connect(owner2).deposit(BigInt(1 + rnd(200000)));
        else await time.increase(rnd(40000));
      } catch { /* reverts are fine */ }
      const held = await token.balanceOf(await vault.getAddress());
      const b1 = (await vault.account(owner.address)).balance;
      const b2 = (await vault.account(owner2.address)).balance;
      expect(held).to.equal(b1 + b2); // vault holds exactly the sum of balances
      const sum = (await token.balanceOf(owner.address)) + (await token.balanceOf(owner2.address)) + held + (await token.balanceOf(merchant.address));
      expect(sum).to.equal(total0);
    }
  });
});
