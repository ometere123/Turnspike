// M9 step 2 (local): compile the verified sources with the explorer's recorded settings and compare the runtime with the
// on-chain bytecode, filling the immutables at their immutableReferences offsets. Also compares the ABI with the clean
// build and the verified source with contracts/TurnpikeAllowance.sol after removing coverage probes.
// Run from the repository root after `npx hardhat compile` (for the clean ABI):
//   SOLC=<path to solc 0.8.20+commit.a1b79de6 native binary> node evidence/M9/reproduce.mjs
// Hardhat caches that binary, for example on Windows:
//   %LOCALAPPDATA%\hardhat-nodejs\Cache\compilers-v3\windows-amd64\solc-windows-amd64-v0.8.20+commit.a1b79de6.exe
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { keccak256 } from "ethers";

const D = "evidence/M9/data";
const j = JSON.parse(readFileSync(`${D}/verified_getsourcecode.json`, "utf8")).result[0];
const out = {};

// Compile with the recorded settings.
const sources = { [j.FileName]: { content: j.SourceCode } };
for (const a of j.AdditionalSources) sources[a.Filename] = { content: a.SourceCode };
const settings = typeof j.CompilerSettings === "string" ? JSON.parse(j.CompilerSettings) : j.CompilerSettings;
settings.outputSelection = { "*": { "*": ["evm.deployedBytecode.object", "evm.deployedBytecode.immutableReferences"] } };
if (!process.env.SOLC) throw new Error("set SOLC to the solc 0.8.20+commit.a1b79de6 binary");
const res = JSON.parse(execFileSync(process.env.SOLC, ["--standard-json"], { input: JSON.stringify({ language: "Solidity", sources, settings }), maxBuffer: 1 << 28 }).toString());
const errs = (res.errors ?? []).filter((e) => e.severity === "error");
if (errs.length) throw new Error(errs.map((e) => e.formattedMessage).join("\n"));
const c = res.contracts[j.FileName].TurnpikeAllowance;
const compiled = c.evm.deployedBytecode.object;
const onchain = readFileSync(`${D}/onchain_runtime.hex`, "utf8").trim().replace(/^0x/, "");
const refs = Object.values(c.evm.deployedBytecode.immutableReferences).flat();
const filled = compiled.split("");
for (const r of refs) for (let i = 0; i < r.length * 2; i++) filled[r.start * 2 + i] = onchain[r.start * 2 + i];
out.compiledRuntimeBytes = compiled.length / 2;
out.onchainRuntimeBytes = onchain.length / 2;
out.onchainKeccak256 = keccak256("0x" + onchain);
out.exactMatchAfterFillingImmutables = filled.join("").toLowerCase() === onchain.toLowerCase();
out.immutableOffsets = c.evm.deployedBytecode.immutableReferences;
const word = (s) => onchain.slice(s * 2, s * 2 + 64);
out.immutableValues = { token: "0x" + word(refs[0].start).slice(24), depositCap: BigInt("0x" + word(c.evm.deployedBytecode.immutableReferences[Object.keys(c.evm.deployedBytecode.immutableReferences)[1]][0].start)).toString() };

// ABI comparison with the clean build.
const clean = JSON.parse(readFileSync("artifacts/contracts/TurnpikeAllowance.sol/TurnpikeAllowance.json", "utf8")).abi;
const verified = JSON.parse(j.ABI);
const sig = (x) => `${x.type} ${x.name ?? ""}(${(x.inputs ?? []).map((i) => i.type).join(",")})${x.stateMutability ? " " + x.stateMutability : ""}`;
const vs = new Set(verified.map(sig)), cs = new Set(clean.map(sig));
out.abi = { verifiedEntries: verified.length, cleanEntries: clean.length, onlyInVerified: [...vs].filter((x) => !cs.has(x)), onlyInClean: [...cs].filter((x) => !vs.has(x)) };

// Probe inventory and source comparison after removing probes.
const v = j.SourceCode.split("\r").join("");
out.probes = {
  statement: (v.match(/c_[0-9a-f]{8}\(0x/g) ?? []).length,
  cTrue: (v.match(/c_true[0-9a-f]{8}\(0x/g) ?? []).length,
  cFalse: (v.match(/c_false[0-9a-f]{8}\(0x/g) ?? []).length,
  coverageModifiers: (v.match(/modifier c_mod\w+/g) ?? []).length,
  probeFunctionDeclarations: [...v.matchAll(/function c_\w+\([^)]*\)[^{]*/g)].map((m) => m[0].trim()),
};
const strip = (x) => x
  .replace(/function c_\w+\([^)]*\)[^{]*\{[^}]*\}\n?/g, "")
  .replace(/modifier c_mod\w+\{[^}]*\n\s*_;\s*\}\n?/g, "")
  .replace(/c_\w+\(0x[0-9a-f]+\);\s*(\/\*[^*]*\*\/)?\s*/g, "")
  .replace(/\s*c_mod\w+/g, "");
const norm = (x) => x.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\s*(revert [^;]+;)\s*\}\s*else\s*\{\s*\}/g, "$1").replace(/\{\s*(return [^;]+;)\s*\}\s*else\s*\{\s*\}/g, "$1")
  .replace(/&&\s*c_true\w+\(0x[0-9a-f]+\)/g, "").replace(/c_true\w+\(0x[0-9a-f]+\)\s*&&/g, "")
  .replace(/\|\|\s*c_false\w+\(0x[0-9a-f]+\)/g, "").replace(/c_false\w+\(0x[0-9a-f]+\)\s*\|\|/g, "");
const tok = (x) => norm(x).match(/[A-Za-z_][A-Za-z0-9_]*|0x[0-9a-fA-F]+|\d+|\S/g).filter((t) => t !== "(" && t !== ")");
const a = tok(readFileSync("contracts/TurnpikeAllowance.sol", "utf8").split("\r").join("")), b = tok(strip(v));
let i = 0; while (i < a.length && a[i] === b[i]) i++;
out.sourceAfterRemovingProbes = { cleanTokens: a.length, strippedTokens: b.length, tokenIdenticalIgnoringParentheses: i === a.length && a.length === b.length };

writeFileSync("evidence/M9/outputs/reproduce.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
