import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { CodeBlock } from "@/components/ui/code-block";
import { Address } from "@/components/ui/address";
import { ERROR_TEXT } from "@/lib/abi";
import { config, repoFile } from "@/lib/config";
import { CHALLENGE_JSON, INTEGRATION_SNIPPET, PAY_SNIPPET, PROOF_SNIPPET } from "@/data/snippets";

export const metadata: Metadata = {
  title: "Developers",
  description: "Integrate Turnpike: Express middleware API, the HTTP 402 flow, the allowance contract interface and error handling.",
};

const TOC = [["overview", "Overview"], ["quickstart", "Quick start"], ["install", "Installation"], ["integrate", "Integration"], ["flow", "Payment flow"], ["trust", "Security model"], ["middleware", "Middleware API"], ["gateway", "Gateway endpoints"], ["contract", "Contract"], ["errors", "Error handling"], ["troubleshooting", "Troubleshooting"], ["source", "Source"]];

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
  ["lateGraceSeconds", "number", "Default 86400. A payment mined this long after expiry is still honoured, so an outage cannot cost the payer."],
  ["deliveryLeaseSeconds", "number", "Default 30. After a crash mid-handler the handler re-runs only once this lease lapses."],
  ["maxResponseBytes", "number", "Default 1 MiB. Handler responses are buffered and stored; larger ones are refused."],
  ["allowedOwners", "string[]", "Optional payer binding: only Paid logs funded by these owner accounts are accepted."],
  ["allowedAgents", "string[]", "Optional payer binding: only Paid logs sent by these agent keys are accepted."],
  ["store", "Store", "Optional existing store instance."],
];

const HTTP: [string, string][] = [
  ["200", "Delivered (also the stored response on replay)."],
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
  return <h2 id={id} className="scroll-mt-24 text-2xl font-semibold tracking-tight">{children}</h2>;
}

export default function DevelopersPage() {
  return (
    <>
      <PageHero eyebrow="Developers" title="Charge per request in two lines of middleware." lead="Everything here matches the code in the repository. The package is not published to npm yet, so you import it from source." />
      <div className="container grid gap-12 py-14 lg:grid-cols-[200px_1fr]">
        <aside className="hidden lg:block">
          <nav aria-label="On this page" className="sticky top-24 space-y-1 text-sm">
            {TOC.map(([id, l]) => <a key={id} href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">{l}</a>)}
          </nav>
        </aside>

        <div className="min-w-0 space-y-14">
          <section className="space-y-4">
            <H id="overview">Overview</H>
            <p className="text-muted-foreground">An unpaid request gets an HTTP 402 challenge. The caller pays through the allowance contract, then retries with an <code className="font-mono text-sm">X-Payment</code> header. The gateway verifies the receipt on QIE, binds the payment to one resource and price, and delivers once. Unlike x402, this is a Turnpike-specific format and is not x402-compatible.</p>
          </section>

          <section className="space-y-4">
            <H id="quickstart">Quick start</H>
            <p className="text-muted-foreground">Try the live gateway from a terminal. This returns the real 402 challenge and sends no transaction:</p>
            <CodeBlock lang="bash" title="terminal" code={`curl -i ${config.gatewayUrl}/v1/block-summary`} />
          </section>

          <section className="space-y-4">
            <H id="install">Installation</H>
            <CodeBlock lang="bash" title="terminal" code={`git clone ${config.repoUrl}.git\ncd Turnspike\nnpm ci --legacy-peer-deps\nnpx hardhat test     # contract tests\nnpx vitest run       # gateway and middleware tests\n\n# build the middleware package and run the example API\ncd packages/middleware && npm install && npm run build && cd ../..\ncd examples/express-api && npm install && npm run build`} />
            <p className="text-muted-foreground">Requires Node.js 22. The middleware depends on express, ethers v6 and better-sqlite3. Set <code className="font-mono text-sm">HMAC_SECRET</code> in your environment and never commit it.</p>
          </section>

          <section className="space-y-4">
            <H id="integrate">Integration</H>
            <CodeBlock title="server.ts" code={INTEGRATION_SNIPPET} />
            <p className="text-muted-foreground">Routes with no price rule pass through unchanged. The handler behind a priced route runs once per paid request and its 2xx response is stored for replay.</p>
          </section>

          <section className="space-y-4">
            <H id="flow">Payment flow</H>
            <CodeBlock lang="http" title="1. challenge" code={CHALLENGE_JSON} />
            <CodeBlock title="2. pay (agent)" code={PAY_SNIPPET} />
            <CodeBlock title="3. proof and result" code={PROOF_SNIPPET} />
          </section>

          <section className="space-y-4">
            <H id="trust">Security model</H>
            <ul className="list-disc space-y-2 pl-5 text-muted-foreground">
              <li><b className="text-foreground">The proof is a capability.</b> Whoever presents <code className="font-mono text-sm">{"{ requestId, txHash, sig }"}</code> gets the paid response. requestId and txHash become public on-chain; <code className="font-mono text-sm">sig</code> is shown only in the 402 response, so it is the secret half. It is required on every redemption, including replays.</li>
              <li><b className="text-foreground">Payment, not identity.</b> Turnpike proves a resource was paid for. It does not prove who the caller is. If a route returns private per-customer data, authenticate callers yourself before <code className="font-mono text-sm">turnpike()</code>, or bind payers with <code className="font-mono text-sm">allowedOwners</code> and <code className="font-mono text-sm">allowedAgents</code>.</li>
              <li><b className="text-foreground">One resource per proof.</b> The challenge binds merchant, resource, price, chain and contract. A proof for <code className="font-mono text-sm">/address/A</code> is refused on <code className="font-mono text-sm">/address/B</code> with 403.</li>
              <li><b className="text-foreground">Delivery is durable and at-least-once for handlers.</b> The response is written to SQLite before it is sent. If the process dies mid-handler, the handler runs again after the lease lapses, so handlers should be idempotent. The gateway never charges twice, and never stores more than one response per payment.</li>
              <li><b className="text-foreground">Late proofs are honoured.</b> Expiry is judged on the payment&apos;s block time, not on when the proof arrives, with a configurable grace window.</li>
              <li><b className="text-foreground">Replay key.</b> On-chain the key is (merchant, requestId). Request IDs are random per challenge; an attacker who sees a pending ID could consume it and force the payer to request a new challenge, but cannot obtain the resource without the sig.</li>
            </ul>
          </section>

          <section className="space-y-4">
            <H id="middleware">Middleware API</H>
            <p className="text-muted-foreground"><code className="font-mono text-sm">turnpike(config)</code> returns an Express handler with <code className="font-mono text-sm">.store</code> and <code className="font-mono text-sm">.close()</code>. A price rule can also be an object <code className="font-mono text-sm">{"{ resourceId?, priceBase, preflight? }"}</code>; a preflight that returns a string makes the gateway answer 503 before issuing any challenge, so nothing is charged.</p>
            <div className="overflow-x-auto rounded-2xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Option</th><th className="p-3">Type</th><th className="p-3">Notes</th></tr></thead>
                <tbody className="divide-y">{OPTIONS.map(([n, t, d]) => <tr key={n}><td className="p-3 font-mono text-[13px]">{n}</td><td className="p-3 font-mono text-xs text-muted-foreground">{t}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}</tbody>
              </table>
            </div>
            <h3 className="pt-2 font-semibold">Responses</h3>
            <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><tbody className="divide-y">{HTTP.map(([c, d]) => <tr key={c}><td className="w-16 p-3 font-mono text-[13px]">{c}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}</tbody></table></div>
          </section>

          <section className="space-y-4">
            <H id="gateway">Gateway endpoints</H>
            <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><tbody className="divide-y">
              {[["GET /healthz", "Liveness."], ["GET /v1/config", "Chain, contract, token, merchant, price, confirmations, demoEnabled."], ["GET /v1/stats", "Delivered counts, split into addresses the operator controls and others."], ["GET /v1/payments/:requestId", "State only. Never returns the resource."], ["GET /v1/block-summary", "Paid endpoint: live QIE block data, 0.001 QUSDC."], ["GET /v1/address/:address", "Paid endpoint: live QIE and QUSDC balances, nonce and code flag for any address, 0.001 QUSDC. Each address is its own resource."], ["GET /demo/status", "Public demo budget and limits."], ["GET /demo/challenge", "Proof-of-work puzzle needed to run the demo agent."], ["POST /demo/run/:scenario", "Scripted agent (allowed, replay, over-cap, unauthorized-merchant). Needs a solved puzzle (x-demo-pow header) and is quota-limited."]].map(([e, d]) => <tr key={e}><td className="p-3 font-mono text-[13px]">{e}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}
            </tbody></table></div>
          </section>

          <section className="space-y-4">
            <H id="contract">Contract</H>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-muted-foreground">TurnpikeAllowance (chain {config.chainId})</dt><dd className="mt-1"><Address value={config.allowance} full /></dd></div>
              <div><dt className="text-muted-foreground">QUSDC (6 decimals)</dt><dd className="mt-1"><Address value={config.qusdc} full /></dd></div>
            </dl>
            <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="p-3">Function</th><th className="p-3">Caller</th><th className="p-3">Effect</th></tr></thead><tbody className="divide-y">
              {CONTRACT.map(([f, c, d]) => <tr key={f}><td className="p-3 font-mono text-[12.5px]">{f}</td><td className="p-3">{c}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}
            </tbody></table></div>
            <p className="text-muted-foreground">Events: Deposited, Withdrawn, PolicySet, MerchantSet, AgentRevoked, PausedSet, Paid. There is no admin, upgrade or rescue function.</p>
          </section>

          <section className="space-y-4">
            <H id="errors">Error handling</H>
            <p className="text-muted-foreground">Contract custom errors, as returned by a reverted <code className="font-mono text-sm">pay</code> or owner call:</p>
            <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><tbody className="divide-y">
              {Object.entries(ERROR_TEXT).map(([n, d]) => <tr key={n}><td className="p-3 font-mono text-[13px]">{n}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}
            </tbody></table></div>
            <p className="text-muted-foreground">Reverted transactions on QIE were charged exactly half their gas limit in all 5 samples (a hypothesis, not a confirmed rule), and eth_estimateGas fails for a call that reverts. Set the gas limit deliberately when you need a refusal on-chain.</p>
          </section>

          <section className="space-y-4">
            <H id="troubleshooting">Troubleshooting</H>
            <div className="overflow-x-auto rounded-2xl border"><table className="w-full text-left text-sm"><tbody className="divide-y">
              {[
                ["402 bad_signature or malformed_proof", "The proof must include the sig from the same 402 response, plus requestId and txHash, base64-encoded JSON with no extra fields."],
                ["202 pending, no_receipt", "The transaction is not mined yet, or the hash is wrong. Retry after retryAfter. If it never appears, the transaction was dropped."],
                ["202 pending, confirmations", "Waiting for the configured depth (default 2 blocks, about 8 s)."],
                ["402 no_matching_paid_log", "The transaction did not emit Paid from the configured contract for this requestId."],
                ["pay reverts with MerchantNotAllowed", "The owner has not allowlisted the merchant. Use setMerchant, or the app."],
                ["pay reverts with NotOwnerAgent", "The signer is not the owner's configured agent, or the agent was revoked."],
                ["pay reverts with RequestAlreadyUsed", "That requestId was already paid. Request a new challenge."],
                ["402 paid_too_late", "The payment was mined more than lateGraceSeconds after the challenge expired. It is recorded as paid but undelivered; there is no automatic refund."],
                ["503 storage_unavailable", "The gateway could not read or write its SQLite file. Nothing was delivered or charged again."],
              ].map(([k, v]) => <tr key={k}><td className="p-3 font-mono text-[12.5px]">{k}</td><td className="p-3 text-muted-foreground">{v}</td></tr>)}
            </tbody></table></div>
          </section>

          <section className="space-y-4">
            <H id="source">Source</H>
            <ul className="space-y-2 text-sm">
              {[["contracts/TurnpikeAllowance.sol", "Allowance contract"], ["packages/middleware/src/index.ts", "Express middleware"], ["packages/middleware/src/verify.ts", "Receipt verification"], ["packages/middleware/test/middleware.test.ts", "Middleware tests"], ["examples/express-api/src/server.ts", "Runnable example API"], ["apps/gateway/src/server.ts", "Gateway server"], ["apps/gateway/src/demo-guard.ts", "Demo abuse controls"], ["apps/gateway/src/agent.ts", "Scripted agent"]].map(([p, d]) => (
                <li key={p}><a className="inline-flex items-center gap-1.5 font-mono text-[13px] text-accent hover:underline" href={repoFile(p)} target="_blank" rel="noreferrer">{p}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a><span className="ml-2 text-muted-foreground">{d}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
