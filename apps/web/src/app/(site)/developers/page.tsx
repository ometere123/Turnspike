import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { CodeBlock } from "@/components/ui/code-block";
import { Address } from "@/components/ui/address";
import { FileLink, Tariff } from "@/components/content/board";
import { ERROR_TEXT } from "@/lib/abi";
import { config, repoFile } from "@/lib/config";
import { CHALLENGE_JSON, CLIENT_SNIPPET, CLI_SNIPPET, INSTALL_SNIPPET, INTEGRATION_SNIPPET, PAY_SNIPPET, PROOF_SNIPPET } from "@/data/snippets";

export const metadata: Metadata = {
  title: "Developers",
  description: "Integrate Turnspike: middleware for API providers, the client SDK for agent builders, the turnspike CLI, the HTTP 402 protocol and the allowance contract.",
};

const TOC = [["overview", "Start here"], ["quickstart", "Quick start"], ["install", "Installation"], ["integrate", "API providers"], ["agents", "Agent builders"], ["cli", "CLI"], ["examples", "Examples"], ["flow", "Protocol"], ["trust", "Security model"], ["middleware", "Middleware API"], ["gateway", "Gateway endpoints"], ["contract", "Contract"], ["errors", "Error handling"], ["troubleshooting", "Troubleshooting"], ["source", "Source"]];

const OPTIONS: [string, string, string][] = [
  ["rpcUrls", "string[]", "QIE RPC endpoints, tried in order (failover)."],
  ["chainId", "number", "Expected chain. A receipt from another chain is rejected."],
  ["contract", "string", "TurnpikeAllowance address. Only Paid logs from this address count."],
  ["token", "string", "QUSDC address, returned in challenges."],
  ["merchant", "string", "Address that must receive the payment."],
  ["hmacSecrets", "string[]", "[current, ...previous]. Each at least 32 bytes. Extra entries allow rotation."],
  ["dbPath", "string", "SQLite file. Use a persistent volume."],
  ["prices", "Record<string, PriceRule | string | number>", "Path (relative to the mount) to price in base units. Supports :param segments."],
  ["confirmations", "number", "Default 2. Fewer confirmations answer 202 pending."],
  ["challengeTtlSeconds", "number", "Default 300."],
  ["rateLimitPerMinute", "number", "Default 60 per IP."],
  ["retryAfterSeconds", "number", "Default 4, returned with 202."],
  ["paymentGraceSeconds", "number", "Default 60. The payment must be mined by expiresAt plus this (chain time). Redeeming an in-time payment has no deadline."],
  ["retentionSeconds", "number", "Default 30 days. Unpaid challenges are deleted only after the deadline, a chain reconciliation past it, and this period."],
  ["deliveryLeaseSeconds", "number", "Default 30, minimum 2. Renewed while the handler runs and fenced by a token; after a crash the handler re-runs once it lapses."],
  ["maxResponseBytes", "number", "Default 1 MiB. Responses are buffered and stored byte-exact (binary safe); larger ones are refused and the payment stays redeemable. No streaming."],
  ["allowedOwners", "string[]", "Optional payer binding: only Paid logs funded by these owner accounts are accepted."],
  ["allowedAgents", "string[]", "Optional payer binding: only Paid logs sent by these agent keys are accepted."],
  ["store", "Store", "Optional existing store instance."],
  ["onEvent", "(e) => void", "Structured events with correlation ids. Never receives proofs, sigs or bodies."],
];

const HTTP: [string, string][] = [
  ["200", "Delivered (also the stored response on replay)."],
  ["400", "invalid_request: your validate() refused the input before any challenge was issued."],
  ["202", "Pending: no receipt, too few confirmations, a reorg in progress, or another request is delivering. Retry after retryAfter."],
  ["402", "Payment required: a new challenge, or a refused proof. reason is one of malformed_proof, unknown_request, bad_signature, integrity, no_matching_paid_log, wrong_merchant, amount_below_price, owner_not_permitted, agent_not_permitted, tx_failed, wrong_chain, paid_too_late."],
  ["403", "wrong_resource: the proof belongs to a different resource."],
  ["409", "already_redeemed: transaction already backs a different request."],
  ["429", "rate_limited."],
  ["503", "rpc_unavailable, storage_unavailable, or a failed preflight (no challenge issued, nothing charged)."],
];

const CONTRACT: [string, string, string][] = [
  ["deposit(amount)", "Owner", "Pulls QUSDC via transferFrom. Reverts above the deposit cap."],
  ["withdraw(amount)", "Owner", "Never blocked by pause or revoke."],
  ["setPolicy(agent, perCallCap, dailyCap)", "Owner", "Sets the single authorised agent and limits."],
  ["setMerchant(merchant, allowed)", "Owner", "Allowlist."],
  ["revokeAgent()", "Owner", "Clears the agent."],
  ["setPaused(paused)", "Owner", "Blocks pay for this account only."],
  ["pay(owner, merchant, requestId, amount)", "Agent", "Checks limits, consumes (merchant, requestId), transfers, emits Paid."],
  ["account(owner), spentToday(owner), isUsed(merchant, id), allowedMerchant(owner, merchant)", "Anyone", "Views."],
];

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="h-section scroll-mt-24 !text-[1.6rem] sm:!text-[1.9rem]">{children}</h2>;
}

export default function DevelopersPage() {
  return (
    <>
      <PageHero eyebrow="Developers" title="Sell an API, or let an agent buy one." lead="API providers add one middleware. Agent builders use the client SDK or the CLI. Everything here matches the code in the repository. All three packages are on npm under @turnspike-qie." />
      <div className="container grid gap-12 py-14 lg:grid-cols-[180px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 border-l-2 border-foreground text-sm">
            <p className="px-3 pb-2 font-semibold">On this page</p>
            {TOC.map(([id, l]) => <a key={id} href={`#${id}`} className="-ml-0.5 block border-l-2 border-transparent px-3 py-1 text-muted-foreground [@media(hover:hover)]:hover:border-route [@media(hover:hover)]:hover:text-foreground">{l}</a>)}
          </nav>
        </aside>

        <div className="min-w-0 max-w-[880px] space-y-14">
          <section className="space-y-4">
            <H id="overview">Overview</H>
            <p className="text-muted-foreground">An unpaid request gets an HTTP 402 challenge. The agent pays through the allowance contract on QIE Mainnet (chain {config.chainId}) in QUSDC, then retries with an <code className="font-mono text-sm">X-Payment</code> header. The seller verifies the receipt on chain, binds the payment to one resource, stores the response and sends it. The owner&apos;s limits are enforced by the contract, not by the agent. This is a Turnspike-specific format and is not x402-compatible.</p>
            <ul className="divide-y rounded-md border border-t-2 border-t-foreground bg-card">
              {[["API providers", "#integrate", "Protect a route with @turnspike-qie/middleware, set a price, receive QUSDC."], ["Agent builders", "#agents", "Pay for APIs automatically with @turnspike-qie/client, inside a policy you set."], ["Owners", "/app", "Fund an allowance, set caps and merchants, pause or revoke, in the web console."]].map(([t, h, d]) => (
                <li key={t} className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-[10rem_1fr]">
                  {h.startsWith("#") ? <a className="link font-semibold" href={h}>{t}</a> : <Link className="link font-semibold" href={h}>{t}</Link>}
                  <p className="text-sm text-muted-foreground">{d}</p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">Requirements: Node.js 20 or later. Agents need an agent key with a little QIE for gas (one payment used 92,159 gas, 0.000104 QIE) and an owner who has set that agent&apos;s limits. Sellers need a merchant address and a persistent disk.</p>
          </section>

          <section className="space-y-4">
            <H id="quickstart">Quick start</H>
            <p className="text-muted-foreground">Try the live gateway from a terminal. This returns the real 402 challenge and sends no transaction:</p>
            <CodeBlock lang="bash" title="terminal" code={`curl -i ${config.gatewayUrl}/v1/block-summary`} />
          </section>

          <section className="space-y-4">
            <H id="install">Installation</H>
            <CodeBlock lang="bash" title="terminal" code={INSTALL_SNIPPET} />
            <p className="text-muted-foreground">Requires Node.js 22. The middleware depends on express, ethers v6 and better-sqlite3. Set <code className="font-mono text-sm">HMAC_SECRET</code> in your environment and never commit it.</p>
          </section>

          <section className="space-y-4">
            <H id="integrate">Integration</H>
            <CodeBlock title="server.ts" code={INTEGRATION_SNIPPET} />
            <p className="text-muted-foreground">Routes with no price rule pass through unchanged. A payment is bound to the method, path and sorted query string; add <code className="font-mono text-sm">{"binding: { body: true }"}</code> or <code className="font-mono text-sm">{"binding: { identity: (req) => apiKeyId }"}</code> when those define the resource. The handler&apos;s 2xx response is stored before it is sent and replayed for the same proof. Handlers run at least once, so keep them idempotent. Deployment, backups and secret rotation: <a className="link" href={repoFile("docs/OPERATIONS.md")} target="_blank" rel="noreferrer">docs/OPERATIONS.md</a>.</p>
          </section>

          <section className="space-y-4">
            <H id="agents">Agent builders</H>
            <p className="text-muted-foreground"><code className="font-mono text-sm">@turnspike-qie/client</code> never pays an arbitrary 402. The request origin and the merchant must be on your payee list, the chain, contract and token must match, and the price must be under your ceiling. It then checks the owner&apos;s on-chain caps, allowlist and balance and the agent&apos;s gas before broadcasting, so a refusal costs nothing. A payment on chain cannot be reversed if the API later fails; the journal lets <code className="font-mono text-sm">resume()</code> collect it without paying twice.</p>
            <CodeBlock title="agent.ts" code={CLIENT_SNIPPET} />
            <p className="text-sm text-muted-foreground">Errors are typed (<code className="font-mono text-sm">untrusted_destination</code>, <code className="font-mono text-sm">price_above_max</code>, <code className="font-mono text-sm">over_daily_cap</code>, <code className="font-mono text-sm">insufficient_gas</code>, <code className="font-mono text-sm">redeem_timeout</code> and more) and say whether money moved (<code className="font-mono text-sm">paid</code>). Use <code className="font-mono text-sm">dryRun: true</code> to inspect a quote. Full reference: <a className="link" href={repoFile("packages/client/README.md")} target="_blank" rel="noreferrer">packages/client</a>.</p>
          </section>

          <section className="space-y-4">
            <H id="cli">CLI</H>
            <p className="text-muted-foreground">The <code className="font-mono text-sm">turnspike</code> command uses the same client, so it has the same safety rules. It asks before spending, shows the network, merchant, price and gas, prints explorer links, and supports <code className="font-mono text-sm">--json</code>. The keystore password comes from <code className="font-mono text-sm">TURNSPIKE_KEYSTORE_PASSWORD</code> or a hidden prompt, never a flag. Owner operations stay in the web console.</p>
            <CodeBlock lang="bash" title="terminal" code={CLI_SNIPPET} />
          </section>

          <section className="space-y-4">
            <H id="examples">Examples</H>
            <ul className="space-y-2.5 text-sm">
              {[["examples/express-api", "A seller: two priced routes with validation and reconciliation."], ["examples/node-agent", "A buyer: pays a Turnspike API with the client SDK. This program bought from the hosted gateway on mainnet (evidence M8)."], ["examples/end-to-end", "Seller and agent together on a local chain, using the built packages. Runs in CI."]].map(([p, d]) => (
                <li key={p}><FileLink href={repoFile(p)}>{p}</FileLink><span className="ml-2 text-muted-foreground">{d}</span></li>
              ))}
            </ul>
          </section>

          <section className="space-y-4">
            <H id="flow">Payment flow</H>
            <CodeBlock lang="http" title="1. challenge" code={CHALLENGE_JSON} />
            <CodeBlock title="2. pay (agent)" code={PAY_SNIPPET} />
            <CodeBlock title="3. proof and result" code={PROOF_SNIPPET} />
          </section>

          <section className="space-y-4">
            <H id="trust">Security model</H>
            <ul className="divide-y border-y text-muted-foreground [&>li]:py-3">
              <li><b className="text-foreground">The proof is a capability.</b> Whoever presents <code className="font-mono text-sm">{"{ requestId, txHash, sig }"}</code> gets the paid response. requestId and txHash become public on-chain; <code className="font-mono text-sm">sig</code> is shown only in the 402 response, so it is the secret half. It is required on every redemption, including replays.</li>
              <li><b className="text-foreground">Payment, not identity.</b> Turnspike proves a resource was paid for. It does not prove who the caller is. If a route returns private per-customer data, authenticate callers yourself before <code className="font-mono text-sm">turnspike()</code>, or bind payers with <code className="font-mono text-sm">allowedOwners</code> and <code className="font-mono text-sm">allowedAgents</code>.</li>
              <li><b className="text-foreground">One resource per proof.</b> The challenge binds merchant, resource, price, chain and contract. A proof for <code className="font-mono text-sm">/address/A</code> is refused on <code className="font-mono text-sm">/address/B</code> with 403, and invalid input is refused with 400 before any price is quoted.</li>
              <li><b className="text-foreground">Delivery is durable and at-least-once for handlers.</b> The response is written to SQLite before it is sent. If the process dies mid-handler, the handler runs again after the lease lapses, so handlers should be idempotent. The gateway never charges twice, and never stores more than one response per payment.</li>
              <li><b className="text-foreground">A payment deadline, then no redemption deadline.</b> The payment must be mined within 60 seconds of expiry (chain time). Once paid in time, the proof can be redeemed later, and the seller&apos;s reconciliation finds payments made while it was down.</li>
              <li><b className="text-foreground">Replay key.</b> On-chain the key is (merchant, requestId). Request IDs are random per challenge; an attacker who sees a pending ID could consume it and force the payer to request a new challenge, but cannot obtain the resource without the sig.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H id="middleware">Middleware API</H>
            <p className="text-muted-foreground"><code className="font-mono text-sm">turnspike(config)</code> returns an Express handler with <code className="font-mono text-sm">.store</code>, <code className="font-mono text-sm">.reconcile()</code>, <code className="font-mono text-sm">.purge()</code> and <code className="font-mono text-sm">.close()</code>. A price rule can also be an object <code className="font-mono text-sm">{"{ resourceId?, priceBase, binding?, validate?, preflight? }"}</code>; a preflight that returns a string makes the gateway answer 503 before issuing any challenge, so nothing is charged.</p>
            <Tariff caption="Middleware options" head={["Option", "Type", "Notes"]} minWidth="min-w-[640px]" colClass={["font-mono text-[13px]", "font-mono text-xs", ""]} rows={OPTIONS.map(([n, t, d]) => [n, t, d])} />
            <h3 className="h-card pt-2">Responses</h3>
            <Tariff caption="Middleware HTTP responses" head={["Status", "Meaning"]} minWidth="min-w-[480px]" colClass={["w-20 font-mono text-[13px] num", ""]} rows={HTTP.map(([c, d]) => [c, d])} />
          </section>

          <section className="space-y-4">
            <H id="gateway">Gateway endpoints</H>
            <Tariff caption="Gateway endpoints" head={["Endpoint", "Behaviour"]} colClass={["font-mono text-[13px] md:whitespace-nowrap", ""]} rows={[["GET /healthz", "Liveness."], ["GET /v1/config", "Chain, contract, token, merchant, price, confirmations, demoEnabled."], ["GET /v1/stats", "Delivered counts, split into addresses the operator controls and others."], ["GET /v1/payments/:requestId", "State only. Never returns the resource."], ["GET /v1/block-summary", "Paid endpoint: live QIE block data, 0.001 QUSDC."], ["GET /v1/address/:address", "Paid endpoint: live QIE and QUSDC balances, nonce and code flag for any address, 0.001 QUSDC. Each address is its own resource."], ["GET /v1/qusdc-activity/:address?blocks=N", "Paid endpoint: QUSDC flows for an address over the last N blocks (100 to 50,000; default 20,000) from Transfer logs: totals in and out, net, counts, top counterparties. 0.002 QUSDC; the window is part of the paid resource."], ["GET /demo/status", "Public demo budget and limits."], ["GET /demo/challenge", "Proof-of-work puzzle needed to run the demo agent."], ["POST /demo/run/:scenario", "Scripted agent (allowed, replay, over-cap, unauthorized-merchant). Needs a solved puzzle (x-demo-pow header) and is quota-limited."]]} />
          </section>

          <section className="space-y-4">
            <H id="contract">Contract</H>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">TurnpikeAllowance (chain {config.chainId})</dt><dd className="mt-1"><Address value={config.allowance} full /></dd></div>
              <div><dt className="text-muted-foreground">QUSDC (6 decimals)</dt><dd className="mt-1"><Address value={config.qusdc} full /></dd></div>
            </dl>
            <Tariff caption="Contract functions" head={["Function", "Caller", "Effect"]} minWidth="min-w-[640px]" colClass={["font-mono text-[12.5px]", "!text-foreground", ""]} rows={CONTRACT.map(([f, c, d]) => [f, c, d])} />
            <p className="text-muted-foreground">Events: Deposited, Withdrawn, PolicySet, MerchantSet, AgentRevoked, PausedSet, Paid. There is no admin, upgrade or rescue function.</p>
          </section>

          <section className="space-y-4">
            <H id="errors">Error handling</H>
            <p className="text-muted-foreground">Contract custom errors, as returned by a reverted <code className="font-mono text-sm">pay</code> or owner call:</p>
            <Tariff caption="Contract custom errors" head={["Error", "Meaning"]} minWidth="min-w-[480px]" colClass={["font-mono text-[13px]", ""]} rows={Object.entries(ERROR_TEXT).map(([n, d]) => [n, d])} />
            <p className="text-muted-foreground">Reverted transactions on QIE were charged exactly half their gas limit in all 5 samples (a hypothesis, not a confirmed rule), and eth_estimateGas fails for a call that reverts. Set the gas limit deliberately when you need a refusal on-chain.</p>
          </section>

          <section className="space-y-4">
            <H id="troubleshooting">Troubleshooting</H>
            <Tariff caption="Troubleshooting" head={["Symptom", "Cause and fix"]} colClass={["font-mono text-[12.5px]", ""]} rows={[
                ["402 bad_signature or malformed_proof", "The proof must include the sig from the same 402 response, plus requestId and txHash, base64-encoded JSON with no extra fields."],
                ["202 pending, no_receipt", "The transaction is not mined yet, or the hash is wrong. Retry after retryAfter. If it never appears, the transaction was dropped."],
                ["202 pending, confirmations", "Waiting for the configured depth (default 2 blocks, about 8 s)."],
                ["402 no_matching_paid_log", "The transaction did not emit Paid from the configured contract for this requestId."],
                ["pay reverts with MerchantNotAllowed", "The owner has not allowlisted the merchant. Use setMerchant, or the app."],
                ["pay reverts with NotOwnerAgent", "The signer is not the owner's configured agent, or the agent was revoked."],
                ["pay reverts with RequestAlreadyUsed", "That requestId was already paid. Request a new challenge."],
                ["402 paid_too_late", "The payment was mined after the payment deadline (expiresAt + paymentGraceSeconds). It is recorded as paid but undelivered; there is no automatic refund."],
                ["client: untrusted_destination", "The 402 came from an origin, or named a merchant, that is not on your payee list. Nothing was paid."],
                ["client: paid true with redeem_timeout", "The payment is on chain. Call resume(key), or turnspike api resume key, later. It never pays twice."],
                ["503 storage_unavailable", "The gateway could not read or write its SQLite file. Nothing was delivered or charged again."],
              ]} />
          </section>

          <section className="space-y-4">
            <H id="source">Source</H>
            <ul className="space-y-2.5 text-sm">
              {[["contracts/TurnpikeAllowance.sol", "Allowance contract"], ["packages/middleware/src/index.ts", "Express middleware"], ["packages/middleware/src/verify.ts", "Receipt verification"], ["packages/middleware/test/middleware.test.ts", "Middleware tests"], ["packages/client/src/client.ts", "Agent client SDK"], ["packages/cli/src/cli.ts", "CLI"], ["docs/PROTOCOL.md", "Protocol specification"], ["docs/INTEROPERABILITY.md", "x402 evaluation"], ["examples/express-api/src/server.ts", "Runnable example API"], ["apps/gateway/src/server.ts", "Gateway server"], ["apps/gateway/src/demo-guard.ts", "Demo abuse controls"], ["apps/gateway/src/agent.ts", "Scripted agent"]].map(([p, d]) => (
                <li key={p}><FileLink href={repoFile(p)}>{p}</FileLink><span className="ml-2 text-muted-foreground">{d}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
