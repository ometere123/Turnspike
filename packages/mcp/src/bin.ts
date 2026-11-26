#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { JsonRpcProvider, Wallet, getAddress, isAddress, type Signer } from "ethers";
import { FileJournal, QIE_MAINNET, parseUnits } from "@turnspike-qie/client";
import { createServer } from "./server";
import { Payer } from "./pay";
import type { Payee, ReadConfig } from "./read";

const home = join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), ".turnspike");
const die = (m: string): never => { process.stderr.write(`turnspike-mcp: ${m}\n`); process.exit(2); };

function main() {
  const env = process.env, path = env.TURNSPIKE_CONFIG ? resolve(env.TURNSPIKE_CONFIG) : join(home, "config.json");
  if (env.TURNSPIKE_CONFIG && !existsSync(path)) die(`config file not found: ${path}`);
  let raw: any = {};
  try { if (existsSync(path)) raw = JSON.parse(readFileSync(path, "utf8")); } catch { die(`config file is not valid JSON: ${path}`); }
  const cfg: ReadConfig = { network: { ...QIE_MAINNET, ...(raw.network ?? {}) }, owner: raw.owner, payees: (raw.payees ?? []) as Payee[], maxPrice: raw.maxPrice ?? "0.01" };
  try {
    parseUnits(cfg.maxPrice, cfg.network.decimals);
    if (cfg.owner) cfg.owner = getAddress(cfg.owner);
    for (const p of cfg.payees) { new URL(p.origin); if (!isAddress(p.merchant)) throw new Error(`bad merchant ${p.merchant}`); if (p.maxPrice) parseUnits(p.maxPrice, cfg.network.decimals); }
  } catch (e: any) { die(`config: ${e.message}`); }

  let payer: Payer | undefined;
  if (env.TURNSPIKE_MCP_PAYMENTS === "on") {
    const password = env.TURNSPIKE_KEYSTORE_PASSWORD;
    if (!cfg.owner || !raw.agentKeystore || !existsSync(raw.agentKeystore) || !password || !cfg.payees.length) die("payments need owner, payees and agentKeystore in the config, and TURNSPIKE_KEYSTORE_PASSWORD");
    delete env.TURNSPIKE_KEYSTORE_PASSWORD;
    let signer: Promise<Signer> | undefined;
    const open = () => (signer ??= Wallet.fromEncryptedJson(readFileSync(raw.agentKeystore, "utf8"), password!)
      .then((w) => w.connect(new JsonRpcProvider(cfg.network.rpcUrls[0], cfg.network.chainId, { staticNetwork: true, cacheTimeout: -1 })) as Signer)
      .catch(() => { signer = undefined; throw new Error("the agent keystore could not be opened"); }));
    payer = new Payer({ ...cfg, owner: cfg.owner!, signer: open, journal: new FileJournal(raw.journal ?? join(home, "journal.json")), confirmations: raw.confirmations });
  }
  serveStdio(() => createServer(cfg, payer), { onerror: (e) => process.stderr.write(`turnspike-mcp: ${e.message}\n`) });
  process.stderr.write(`turnspike-mcp: ready, payments ${payer ? "on (a person confirms each one)" : "off"}\n`);
}
main();
