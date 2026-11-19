// M9 step 1 (read-only): fetch the deployed runtime from both QIE RPCs and the verified source/ABI from the explorer API.
// Run from the repository root: node evidence/M9/fetch.mjs   (writes evidence/M9/data/*; overwrites the committed copies)
import { writeFileSync } from "node:fs";
import { keccak256 } from "ethers";

const A = "0xa2f2e042861a593cc582c6d2d43a24457dcf5d9c";
const D = "evidence/M9/data";
const rpc = async (url, method, params) =>
  (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;

const code1 = await rpc("https://rpc1mainnet.qie.digital", "eth_getCode", [A, "latest"]);
const code2 = await rpc("https://rpc2mainnet.qie.digital", "eth_getCode", [A, "latest"]);
const block = parseInt(await rpc("https://rpc1mainnet.qie.digital", "eth_blockNumber", []), 16);
writeFileSync(`${D}/onchain_runtime.hex`, code1);
console.log(JSON.stringify({ block, bytes: (code1.length - 2) / 2, keccak256: keccak256(code1), rpc1EqualsRpc2: code1 === code2 }));

const src = await (await fetch(`https://mainnet.qie.digital/api?module=contract&action=getsourcecode&address=${A}`)).json();
writeFileSync(`${D}/verified_getsourcecode.json`, JSON.stringify(src, null, 2));
const r = src.result[0];
writeFileSync(`${D}/verified_source.sol.txt`, r.SourceCode);
writeFileSync(`${D}/verified_abi.json`, r.ABI);
writeFileSync(`${D}/compiler_settings.json`, JSON.stringify({
  CompilerVersion: r.CompilerVersion, OptimizationUsed: r.OptimizationUsed, EVMVersion: r.EVMVersion, ConstructorArguments: r.ConstructorArguments,
  CompilerSettings: typeof r.CompilerSettings === "string" ? JSON.parse(r.CompilerSettings) : r.CompilerSettings,
}, null, 2));
console.log(JSON.stringify({ name: r.ContractName, compiler: r.CompilerVersion, optimizer: r.OptimizationUsed, evm: r.EVMVersion, additionalSources: r.AdditionalSources.length }));
