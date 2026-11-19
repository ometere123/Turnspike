import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Contract, Interface, JsonRpcProvider, Wallet, getAddress, isAddress } from "ethers";
import {
  ALLOWANCE_ABI, FileJournal, QIE_MAINNET, TurnspikeClient, challengeSchema, formatUnits, parseUnits,
  type Network, type PaidFetchResult, type Quote,
} from "@turnspike-qie/client";

/** Exit codes. Scripts can rely on these. */
export const EXIT = { OK: 0, ERROR: 1, USAGE: 2, REFUSED: 3, PAID_NOT_DELIVERED: 4 } as const;
/** Client errors after which a payment may still land on chain: exit 4 and a resume hint, never "not paid". */
const UNSETTLED = new Set(["payment_pending", "tx_timeout"]); // also honoured when a result lacks the maybePaid flag
const mayHavePaid = (r: { paid: boolean; error: string; maybePaid?: boolean }) => !r.paid && (r.maybePaid === true || UNSETTLED.has(r.error));

export interface Io {
  out(s: string): void;
  err(s: string): void;
  /** Asks a yes/no question; returns false when there is no terminal. */
  confirm(q: string): Promise<boolean>;
  /** Reads a secret without echo; returns undefined when there is no terminal. */
  secret(q: string): Promise<string | undefined>;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
}

export interface CliConfig {
  network: Network;
  /** Owner whose allowance account the agent spends from. */
  owner?: string;
  /** Path to an encrypted JSON keystore (Foundry, geth or ethers format) holding the AGENT key. Never the owner key. */
  agentKeystore?: string;
  payees: { origin: string; merchant: string; maxPrice?: string }[];
  /** Per-request ceiling in QUSDC, e.g. "0.01". */
  maxPrice: string;
  journal?: string;
  gateway?: string;
  /** Confirmations to wait for before redeeming. Default 2. */
  confirmations?: number;
}

const HELP = `turnspike - inspect and pay Turnspike HTTP 402 APIs on QIE

Usage: turnspike <command> [options]

Setup
  init [--owner 0x..] [--keystore path] [--payee origin=merchant]... [--max-price 0.01]
                              Write ./turnspike.config.json (no secrets are written)
  doctor                      Check RPC, chain, contract, token, config and agent gas
  config show                 Print the resolved configuration

Chain
  network status              Head block, gas price and latency of each RPC
  account inspect <owner>     Allowance account: balance, agent, caps, spent today, paused
  merchant inspect <merchant> [--owner 0x..] [--blocks N]
                              Allowlist status and recent payments to a merchant
  api verify <tx-hash>        Decode and check a Turnspike payment transaction

Paid APIs
  api probe <url>             Request a URL and explain its 402 challenge against your policy (never pays)
  api pay <url> [--max-price 0.005] [--dry-run] [--yes] [--key k]
                              Pay and fetch. Shows the merchant, price and gas, then asks before spending
  api resume <key>            Finish the purchase recorded under a key (never pays its challenge twice)

Demo
  demo run [scenario]         Run the public demo agent (allowed | over-cap | replay | unauthorized-merchant)

Global options
  --json                      Machine-readable output
  --config <path>             Config file (default ./turnspike.config.json, then ~/.turnspike/config.json)
  --rpc <url>                 Override the RPC URL
  -h, --help                  Show help

Secrets
  The agent keystore password is read from TURNSPIKE_KEYSTORE_PASSWORD or asked without echo. It is never written to disk,
  printed or accepted as a command-line flag (flags end up in shell history).

Exit codes: 0 ok, 1 error, 2 usage, 3 refused by policy or chain, 4 paid but not yet delivered (run api resume).
`;

class UsageError extends Error {}

function loadConfig(path: string | undefined, env: Io["env"]): { cfg: CliConfig; path: string | null } {
  const candidates = path ? [resolve(path)] : [resolve("turnspike.config.json"), join(env.HOME ?? env.USERPROFILE ?? homedir(), ".turnspike", "config.json")];
  for (const p of candidates) {
    if (existsSync(p)) {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      return { cfg: { maxPrice: "0.01", payees: [], ...raw, network: { ...QIE_MAINNET, ...(raw.network ?? {}) } }, path: p };
    }
  }
  if (path) throw new UsageError(`config file not found: ${path}`);
  return { cfg: { network: QIE_MAINNET, payees: [], maxPrice: "0.01" }, path: null };
}

const explorerTx = (n: Network, h: string) => `${n.explorer}/tx/${h}`;
const q = (base: bigint, n: Network) => `${formatUnits(base, n.decimals)} QUSDC`;
const qie = (wei: bigint) => `${formatUnits(wei, 18)} QIE`;

function printQuote(io: Io, x: Quote, n: Network) {
  io.out(`  network      ${n.name} (chain ${x.chainId})`);
  io.out(`  endpoint     ${x.method} ${x.url}`);
  io.out(`  merchant     ${x.merchant}`);
  io.out(`  price        ${x.price} QUSDC (${x.priceBase} base units)`);
  io.out(`  gas          ~${qie(x.gasCostWei)} (estimate ${x.gasEstimate} at ${x.gasPriceWei} wei)`);
  io.out(`  owner        ${x.owner}  balance ${q(x.ownerBalanceBase, n)}, left today ${q(x.remainingTodayBase, n)}`);
  io.out(`  agent        ${x.agent}  gas balance ${qie(x.agentGasBalanceWei)}`);
  io.out(`  expires      ${new Date(x.expiresAt * 1000).toISOString()}`);
}

const jsonable = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export async function run(argv: string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        json: { type: "boolean" }, config: { type: "string" }, rpc: { type: "string" }, help: { type: "boolean", short: "h" },
        owner: { type: "string" }, keystore: { type: "string" }, payee: { type: "string", multiple: true }, "max-price": { type: "string" },
        "dry-run": { type: "boolean" }, yes: { type: "boolean", short: "y" }, key: { type: "string" }, blocks: { type: "string" },
        gateway: { type: "string" }, force: { type: "boolean" },
      },
    });
  } catch (e: any) {
    io.err(`error: ${e.message}\nRun turnspike --help for usage.`);
    return EXIT.USAGE;
  }
  const { values: o, positionals: pos } = parsed;
  const json = !!o.json;
  const emit = (human: () => void, data: unknown) => (json ? io.out(JSON.stringify(jsonable(data), null, 2)) : human());
  if (o.help || pos.length === 0) { io.out(HELP); return pos.length === 0 && !o.help ? EXIT.USAGE : EXIT.OK; }

  try {
    const cmd = pos.slice(0, 2).join(" ");
    const { cfg, path: cfgPath } = pos[0] === "init" ? { cfg: loadConfig(undefined, {}).cfg, path: null } : loadConfig(o.config, io.env);
    const net: Network = { ...cfg.network, rpcUrls: o.rpc ? [o.rpc] : cfg.network.rpcUrls };
    const provider = () => new JsonRpcProvider(net.rpcUrls[0], net.chainId, { staticNetwork: true, cacheTimeout: -1 });
    const vault = (p: JsonRpcProvider) => new Contract(net.contract, ALLOWANCE_ABI as unknown as string[], p);
    const addrArg = (i: number, what: string) => {
      const a = pos[i];
      if (!a || !isAddress(a)) throw new UsageError(`${what} must be a 0x address`);
      return getAddress(a);
    };

    switch (pos[0] === "init" || pos[0] === "doctor" ? pos[0] : cmd) {
      case "init": {
        const target = resolve(o.config ?? "turnspike.config.json");
        if (existsSync(target) && !o.force) throw new UsageError(`${target} exists; pass --force to overwrite`);
        const payees = (o.payee ?? []).map((s) => {
          const i = s.lastIndexOf("=");
          const origin = s.slice(0, i), merchant = s.slice(i + 1);
          if (i < 0 || !isAddress(merchant)) throw new UsageError(`--payee must be origin=0xMerchant, got ${s}`);
          return { origin: new URL(origin).origin, merchant: getAddress(merchant) };
        });
        if (o.owner && !isAddress(o.owner)) throw new UsageError("--owner must be a 0x address");
        const out: CliConfig = {
          network: QIE_MAINNET, owner: o.owner ? getAddress(o.owner) : undefined, agentKeystore: o.keystore, payees,
          maxPrice: o["max-price"] ?? "0.01", journal: join(dirname(target), ".turnspike", "journal.json"), gateway: o.gateway ?? "https://turnspike-qie.fly.dev",
        };
        parseUnits(out.maxPrice, net.decimals);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
        emit(() => io.out(`wrote ${target}\nNo secrets were written. Next: turnspike doctor`), { wrote: target, config: out });
        return EXIT.OK;
      }

      case "config show":
        emit(() => io.out(`${cfgPath ?? "(defaults, no config file)"}\n${JSON.stringify(cfg, null, 2)}`), { path: cfgPath, config: cfg });
        return EXIT.OK;

      case "doctor": {
        const checks: { name: string; ok: boolean; detail: string }[] = [];
        const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });
        const p = provider();
        try {
          const id = (await p.send("eth_chainId", [])) as string;
          add("rpc reachable", true, net.rpcUrls[0]);
          add("chain id", Number(id) === net.chainId, `rpc says ${Number(id)}, config ${net.chainId}`);
          const code = await p.getCode(net.contract);
          add("settlement contract deployed", code !== "0x", net.contract);
          if (code !== "0x") {
            const tok = (await vault(p).token()) as string;
            add("contract token matches config", tok.toLowerCase() === net.token.toLowerCase(), `${tok}`);
          }
          if (cfg.owner) {
            const a = await vault(p).account(cfg.owner);
            add("owner account funded", (a.balance as bigint) > 0n, `${q(a.balance, net)}`);
            add("owner not paused", !a.paused, a.paused ? "paused" : "active");
            add("owner has an agent", (a.agent as string) !== "0x0000000000000000000000000000000000000000", a.agent);
            const gas = await p.getBalance(a.agent);
            add("agent has gas", gas > 0n, qie(gas));
          } else add("owner configured", false, "set owner with turnspike init --owner");
        } catch (e: any) {
          add("rpc reachable", false, String(e?.shortMessage ?? e?.message ?? e));
        } finally { p.destroy(); }
        add("payees configured", cfg.payees.length > 0, `${cfg.payees.length} payee(s)`);
        add("agent keystore present", !!cfg.agentKeystore && existsSync(cfg.agentKeystore), cfg.agentKeystore ?? "not set (needed only for api pay)");
        const ok = checks.filter((c) => c.name !== "agent keystore present").every((c) => c.ok);
        emit(() => { for (const c of checks) io.out(`${c.ok ? "ok  " : "FAIL"}  ${c.name.padEnd(32)} ${c.detail}`); }, { ok, checks });
        return ok ? EXIT.OK : EXIT.ERROR;
      }

      case "network status": {
        const rows: any[] = [];
        for (const url of net.rpcUrls) {
          const p = new JsonRpcProvider(url, net.chainId, { staticNetwork: true, cacheTimeout: -1 });
          const t0 = Date.now();
          try {
            const [block, fee] = await Promise.all([p.getBlock("latest"), p.getFeeData()]);
            rows.push({ rpc: url, ok: true, block: block!.number, blockTime: new Date(block!.timestamp * 1000).toISOString(), gasPriceWei: fee.gasPrice, latencyMs: Date.now() - t0 });
          } catch (e: any) { rows.push({ rpc: url, ok: false, error: String(e?.shortMessage ?? e?.message ?? e) }); } finally { p.destroy(); }
        }
        emit(() => { io.out(`${net.name} (chain ${net.chainId})`); for (const r of rows as any[]) io.out(r.ok ? `  ${r.rpc}  block ${r.block}  ${r.blockTime}  gas ${r.gasPriceWei} wei  ${r.latencyMs} ms` : `  ${r.rpc}  DOWN  ${r.error}`); }, { network: net.name, chainId: net.chainId, rpcs: rows });
        return (rows as any[]).some((r) => r.ok) ? EXIT.OK : EXIT.ERROR;
      }

      case "account inspect": {
        const owner = addrArg(2, "owner");
        const p = provider();
        try {
          const v = vault(p);
          const [a, spent] = await Promise.all([v.account(owner), v.spentToday(owner)]);
          const token = new Contract(net.token, ["function balanceOf(address) view returns (uint256)"], p);
          const wallet = (await token.balanceOf(owner)) as bigint;
          const remaining = (a.dailyCap as bigint) > (spent as bigint) ? (a.dailyCap as bigint) - (spent as bigint) : 0n;
          const data = { owner, allowanceBalanceBase: a.balance, walletQusdcBase: wallet, paused: a.paused, agent: a.agent, perCallCapBase: a.perCallCap, dailyCapBase: a.dailyCap, spentTodayBase: spent, remainingTodayBase: remaining };
          emit(() => {
            io.out(`owner         ${owner}`);
            io.out(`allowance     ${q(a.balance, net)}   (wallet holds ${q(wallet, net)})`);
            io.out(`status        ${a.paused ? "PAUSED" : "active"}`);
            io.out(`agent         ${a.agent}`);
            io.out(`per call cap  ${q(a.perCallCap, net)}`);
            io.out(`daily cap     ${q(a.dailyCap, net)}   spent today ${q(spent, net)}, left ${q(remaining, net)}`);
          }, data);
          return EXIT.OK;
        } finally { p.destroy(); }
      }

      case "merchant inspect": {
        const merchant = addrArg(2, "merchant");
        const p = provider();
        try {
          const v = vault(p);
          const head = await p.getBlockNumber();
          const span = Number(o.blocks ?? 5000);
          const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
          const topic = iface.getEvent("Paid")!.topicHash;
          const logs = await p.getLogs({ address: net.contract, topics: [topic, null, null, "0x" + merchant.slice(2).toLowerCase().padStart(64, "0")], fromBlock: Math.max(0, head - span), toBlock: head });
          let total = 0n;
          const payments = logs.map((l) => { const x = iface.parseLog({ topics: [...l.topics], data: l.data })!; total += x.args.amount as bigint; return { txHash: l.transactionHash, block: l.blockNumber, owner: x.args.owner, agent: x.args.agent, amountBase: x.args.amount }; });
          const allowed = o.owner ? ((await v.allowedMerchant(getAddress(o.owner), merchant)) as boolean) : undefined;
          emit(() => {
            io.out(`merchant      ${merchant}`);
            if (allowed !== undefined) io.out(`allowlisted   ${allowed ? "yes" : "no"} for owner ${o.owner}`);
            io.out(`payments      ${payments.length} in the last ${span} blocks, total ${q(total, net)}`);
            for (const x of payments.slice(-10)) io.out(`  block ${x.block}  ${q(x.amountBase, net)}  ${explorerTx(net, x.txHash)}`);
          }, { merchant, allowlistedForOwner: allowed, blocks: span, count: payments.length, totalBase: total, payments });
          return EXIT.OK;
        } finally { p.destroy(); }
      }

      case "api verify": {
        const h = pos[2];
        if (!h || !/^0x[0-9a-fA-F]{64}$/.test(h)) throw new UsageError("tx-hash must be 0x + 64 hex");
        const p = provider();
        try {
          const [r, head] = await Promise.all([p.getTransactionReceipt(h), p.getBlockNumber()]);
          if (!r) { emit(() => io.out("not found (not mined, or wrong network)"), { found: false }); return EXIT.ERROR; }
          const iface = new Interface(ALLOWANCE_ABI as unknown as string[]);
          const paid = r.logs.filter((l) => l.address.toLowerCase() === net.contract.toLowerCase()).map((l) => { try { return iface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } }).find((x) => x?.name === "Paid");
          const data = { txHash: h, status: r.status === 1 ? "success" : "reverted", block: r.blockNumber, confirmations: head - r.blockNumber + 1, gasUsed: r.gasUsed, gasPriceWei: r.gasPrice, gasCostWei: r.gasUsed * r.gasPrice,
            payment: paid ? { owner: paid.args.owner, agent: paid.args.agent, merchant: paid.args.merchant, requestId: paid.args.requestId, amountBase: paid.args.amount } : null, explorer: explorerTx(net, h) };
          emit(() => {
            io.out(`status        ${data.status} in block ${data.block} (${data.confirmations} confirmations)`);
            io.out(`gas           ${data.gasUsed} used, ${qie(data.gasCostWei)}`);
            if (paid) { io.out(`payment       ${q(paid.args.amount, net)} from owner ${paid.args.owner}`); io.out(`              agent ${paid.args.agent} -> merchant ${paid.args.merchant}`); io.out(`              requestId ${paid.args.requestId}`); }
            else io.out("payment       no Turnspike Paid event from the configured contract in this transaction");
            io.out(`explorer      ${data.explorer}`);
          }, data);
          return paid && r.status === 1 ? EXIT.OK : EXIT.REFUSED;
        } finally { p.destroy(); }
      }

      case "api probe": {
        const url = pos[2];
        if (!url) throw new UsageError("url required");
        const res = await (io.fetch ?? fetch)(url);
        if (res.status !== 402) { emit(() => io.out(`${res.status}: not a paid endpoint (no 402)`), { status: res.status, paid: false }); return EXIT.OK; }
        const body = await res.json().catch(() => null);
        const c = challengeSchema.safeParse(body);
        if (!c.success) { emit(() => io.out("402, but the body is not a Turnspike challenge"), { status: 402, turnspike: false }); return EXIT.REFUSED; }
        const ch = c.data;
        const origin = new URL(url).origin;
        const trusted = cfg.payees.some((t) => new URL(t.origin).origin === origin && t.merchant.toLowerCase() === ch.merchant.toLowerCase());
        const max = parseUnits(cfg.maxPrice, net.decimals);
        const checks = {
          protocol: ch.protocol ?? "legacy (no version field)",
          networkMatches: ch.chainId === net.chainId && ch.contract.toLowerCase() === net.contract.toLowerCase() && ch.token.toLowerCase() === net.token.toLowerCase(),
          payeeTrusted: trusted, withinMaxPrice: BigInt(ch.priceBase) <= max,
        };
        emit(() => {
          io.out(`402 Payment Required (${checks.protocol})`);
          io.out(`  resource     ${ch.resourceId}`);
          io.out(`  price        ${q(BigInt(ch.priceBase), net)}`);
          io.out(`  merchant     ${ch.merchant}`);
          io.out(`  chain        ${ch.chainId}  contract ${ch.contract}`);
          io.out(`  expires      ${new Date(ch.expiresAt * 1000).toISOString()}`);
          io.out(`policy`);
          io.out(`  network      ${checks.networkMatches ? "matches" : "DOES NOT MATCH your config"}`);
          io.out(`  payee        ${trusted ? "trusted" : "NOT on your payee list (api pay would refuse)"}`);
          io.out(`  price        ${checks.withinMaxPrice ? "within" : "ABOVE"} your max ${cfg.maxPrice} QUSDC`);
        }, { status: 402, challenge: { ...ch, sig: undefined }, checks });
        return checks.networkMatches && trusted && checks.withinMaxPrice ? EXIT.OK : EXIT.REFUSED;
      }

      case "api pay":
      case "api resume": {
        if (!cfg.owner) throw new UsageError("no owner configured (turnspike init --owner 0x..)");
        if (!cfg.agentKeystore) throw new UsageError("no agentKeystore configured (turnspike init --keystore path)");
        const password = io.env.TURNSPIKE_KEYSTORE_PASSWORD ?? (await io.secret("agent keystore password: "));
        if (!password) throw new UsageError("keystore password required: set TURNSPIKE_KEYSTORE_PASSWORD or run in a terminal");
        const p = provider();
        try {
          const signer = (await Wallet.fromEncryptedJson(readFileSync(cfg.agentKeystore, "utf8"), password)).connect(p);
          const journal = new FileJournal(cfg.journal ?? join(io.env.HOME ?? io.env.USERPROFILE ?? homedir(), ".turnspike", "journal.json"), { lockWaitMs: Number(io.env.TURNSPIKE_JOURNAL_LOCK_WAIT_MS) || undefined });
          const max = o["max-price"] ? parseUnits(o["max-price"], net.decimals) : parseUnits(cfg.maxPrice, net.decimals);
          const confirm = async (x: Quote) => {
            if (json && !o.yes) return false;
            if (!json) { io.out("About to pay:"); printQuote(io, x, net); io.out("A blockchain payment cannot be reversed if the API later fails."); }
            return o.yes ? true : io.confirm("Pay? [y/N] ");
          };
          const client = new TurnspikeClient({
            signer, owner: cfg.owner, network: net, journal, fetch: io.fetch, confirmations: cfg.confirmations ?? 2,
            policy: { payees: cfg.payees.map((t) => ({ origin: t.origin, merchant: t.merchant, maxPriceBase: t.maxPrice ? parseUnits(t.maxPrice, net.decimals) : undefined })), maxPriceBase: max },
            approve: confirm,
          });
          let r: PaidFetchResult;
          const key = cmd === "api resume" ? pos[2] : o.key ?? createHash("sha256").update(`GET ${pos[2]} ${Date.now()}`).digest("hex").slice(0, 16);
          if (!pos[2]) throw new UsageError(cmd === "api resume" ? "key required" : "url required");
          try {
            r = cmd === "api resume" ? await client.resume(key) : await client.fetch(pos[2], {}, { dryRun: !!o["dry-run"], idempotencyKey: key });
          } catch (e: any) {
            // The client threw mid-purchase (journal unavailable, lock held, process-level failure). A payment may already
            // have been sent, so this is never reported as "not paid".
            r = { ok: false, error: "payment_pending", paid: false, maybePaid: true, message: `the purchase stopped unexpectedly (${e?.shortMessage ?? e?.message ?? e}); its outcome is unknown` };
          }
          if (!r.ok && (r.paid || mayHavePaid(r)) && !json) io.err(`resume later with: turnspike api resume ${key}`);
          if (r.ok && r.kind === "dry_run") { emit(() => { io.out("Dry run, nothing was sent:"); printQuote(io, r.quote, net); }, { dryRun: true, quote: r.quote }); return EXIT.OK; }
          if (r.ok) {
            const text = await r.response.text();
            const pay = r.kind === "paid" ? r.payment : null;
            emit(() => { if (pay) io.err(`paid ${q(pay.priceBase, net)}  tx ${pay.explorerUrl ?? pay.txHash}${r.kind === "paid" && r.replayed ? "  (stored response replayed)" : ""}`); io.out(text); }, { status: r.response.status, payment: pay, body: text });
            return EXIT.OK;
          }
          // A sent-but-unconfirmed or uncertain submission may still charge the owner: report it with the paid exit code.
          const unsettled = mayHavePaid(r);
          emit(() => io.err(`${r.paid ? "PAID, NOT DELIVERED" : unsettled ? "PAYMENT MAY HAVE BEEN SENT" : "not paid"}: ${r.error}: ${r.message}${r.payment?.explorerUrl ? `\n  tx ${r.payment.explorerUrl}` : ""}`), r);
          return r.paid || unsettled ? EXIT.PAID_NOT_DELIVERED : EXIT.REFUSED;
        } finally { p.destroy(); }
      }

      case "demo run": {
        const base = (o.gateway ?? cfg.gateway ?? "https://turnspike-qie.fly.dev").replace(/\/$/, "");
        const scenario = pos[2] ?? "allowed";
        const f = io.fetch ?? fetch;
        const ch: any = await (await f(`${base}/demo/challenge`)).json();
        if (!ch.token) { emit(() => io.err(`demo unavailable: ${ch.error ?? "unknown"}`), ch); return EXIT.ERROR; }
        const salt = String(ch.token).split(".")[0];
        let n = 0;
        for (;; n++) {
          const d = createHash("sha256").update(`${salt}:${n}`).digest();
          let z = 0;
          for (const b of d) { if (b === 0) { z += 8; continue; } z += Math.clz32(b) - 24; break; }
          if (z >= ch.bits) break;
        }
        const r = await f(`${base}/demo/run/${scenario}`, { method: "POST", headers: { "x-demo-pow": `${ch.token}.${n}` } });
        const body: any = await r.json();
        emit(() => {
          if (r.status !== 200) { io.err(`${r.status} ${body.error ?? ""}${body.retryAfterSeconds ? ` (retry in ${body.retryAfterSeconds}s)` : ""}`); return; }
          for (const s of body.steps ?? []) io.out(`${s.ok ? "ok  " : "no  "} ${s.step}${s.txHash ? `  ${explorerTx(net, s.txHash)}` : ""}${s.detail?.name ? `  ${s.detail.name}` : ""}`);
          if (body.data) io.out(JSON.stringify(body.data));
        }, { status: r.status, ...body });
        return r.status === 200 ? EXIT.OK : EXIT.ERROR;
      }

      default:
        throw new UsageError(`unknown command: ${pos.join(" ")}`);
    }
  } catch (e: any) {
    if (e instanceof UsageError) { io.err(`error: ${e.message}`); return EXIT.USAGE; }
    io.err(`error: ${e?.shortMessage ?? e?.message ?? e}`);
    return EXIT.ERROR;
  }
}
