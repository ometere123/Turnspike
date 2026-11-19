#!/usr/bin/env bash
# M9 step 3: build the exact deployed (coverage-instrumented) contract in an isolated git worktree and run the
# clean-build contract suite against it. Nothing in the main checkout changes. Run from the repository root.
#   bash evidence/M9/prepare-instrumented-worktree.sh ../turnspike-instrumented-check
set -euo pipefail
WT="${1:-../turnspike-instrumented-check}"
git worktree add --detach "$WT" HEAD
cp evidence/M9/data/verified_source.sol.txt "$WT/contracts/TurnpikeAllowance.sol"
# The deployed build was compiled with the optimizer disabled (explorer: OptimizationUsed=false, EVM berlin).
sed -i 's/optimizer: { enabled: true, runs: 200 }/optimizer: { enabled: false, runs: 200 }/' "$WT/hardhat.config.ts"
# Local-only: lets a Hardhat fork of chain 1990 execute calls (Hardhat has no hardfork history for QIE).
sed -i 's|  networks: { qie: { url: "https://rpc1mainnet.qie.digital", chainId: 1990 } },|  networks: { qie: { url: "https://rpc1mainnet.qie.digital", chainId: 1990 }, hardhat: { hardfork: "shanghai", chains: { 1990: { hardforkHistory: { shanghai: 0 } } } } },|' "$WT/hardhat.config.ts"
cd "$WT"
npm ci --legacy-peer-deps --no-audit --no-fund
npx hardhat compile --force
node -e '
const a=require("./artifacts/contracts/TurnpikeAllowance.sol/TurnpikeAllowance.json");
const on=require("fs").readFileSync(process.argv[1]+"/evidence/M9/data/onchain_runtime.hex","utf8").trim().slice(2).split("");
for (const s of [1442,3942,6972,7212,6767,7176]) for (let i=0;i<64;i++) on[s*2+i]="0";
console.log("worktree runtime equals deployed runtime (immutables zeroed):", a.deployedBytecode.toLowerCase()==="0x"+on.join("").toLowerCase());
' "$OLDPWD"
npx hardhat test --no-compile
