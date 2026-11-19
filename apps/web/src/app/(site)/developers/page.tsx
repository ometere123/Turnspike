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

const TOC = [["overview", "Overview"], ["quickstart", "Quick start"], ["install", "Installation"], ["integrate", "Integration"], ["flow", "Payment flow"], ["middleware", "Middleware API"], ["gateway", "Gateway endpoints"], ["contract", "Contract"], ["errors", "Error handling"], ["source", "Source"]];

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
  ["store", "Store", "Optional existing store instance."],
];

const HTTP: [string, string][] = [
  ["200", "Delivered (also the stored response on replay)."],
  ["202", "Pending: no receipt yet or too few confirmations. Retry after retryAfter."],
  ["402", "Payment required: new challenge, or an invalid or rejected proof (reason field)."],
  ["403", "wrong_resource: the proof belongs to a different resource."],
  ["409", "already_redeemed: transaction already backs a different request."],
  ["410", "expired: challenge TTL passed before payment."],
  ["429", "rate_limited."],
  ["503", "rpc_unavailable (or a failed preflight, with no challenge issued)."],
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
            <CodeBlock lang="bash" title="terminal" code={`git clone ${config.repoUrl}.git\ncd Turnspike\nnpm ci --legacy-peer-deps\nnpx hardhat test     # contract tests\nnpx vitest run       # gateway and middleware tests`} />
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
              {[["GET /healthz", "Liveness."], ["GET /v1/config", "Chain, contract, token, merchant, price, confirmations, demoEnabled."], ["GET /v1/stats", "Delivered counts, split into addresses the operator controls and others."], ["GET /v1/payments/:requestId", "State only. Never returns the resource."], ["GET /v1/block-summary", "Paid endpoint: live QIE block data, 0.001 QUSDC."], ["POST /demo/run/:scenario", "Scripted agent (allowed, over-cap, replay). Spends real funds from a demo account."]].map(([e, d]) => <tr key={e}><td className="p-3 font-mono text-[13px]">{e}</td><td className="p-3 text-muted-foreground">{d}</td></tr>)}
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
            <H id="source">Source</H>
            <ul className="space-y-2 text-sm">
              {[["contracts/TurnpikeAllowance.sol", "Allowance contract"], ["packages/middleware/src/index.ts", "Express middleware"], ["packages/middleware/src/verify.ts", "Receipt verification"], ["apps/gateway/src/server.ts", "Gateway server"], ["apps/gateway/src/agent.ts", "Scripted agent"]].map(([p, d]) => (
                <li key={p}><a className="inline-flex items-center gap-1.5 font-mono text-[13px] text-accent hover:underline" href={repoFile(p)} target="_blank" rel="noreferrer">{p}<ExternalLink className="h-3.5 w-3.5" aria-hidden /></a><span className="ml-2 text-muted-foreground">{d}</span></li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
