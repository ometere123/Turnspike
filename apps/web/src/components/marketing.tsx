import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SectionHeader({ eyebrow, title, lead, center = false }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn("max-w-3xl", center && "mx-auto")}>
      {eyebrow && <p className="kicker mb-3">{eyebrow}</p>}
      <h2 className="h-section">{title}</h2>
      {lead && <p className="lead mt-4">{lead}</p>}
    </div>
  );
}

/* ------------------------------------------------------------ three parties, one booth each */

const PARTIES = [
  { who: "Owner", does: "Deposits QUSDC into their own account on the contract and posts the rules for one agent key: a per-call cap, a daily cap, which merchants may be paid.", holds: "the money and the rules" },
  { who: "Agent", does: "Meets a 402 at an API, checks the quote against its own payee list and price ceiling, then calls pay on the contract. It can only spend inside the owner's rules.", holds: "a key that can pay, nothing more" },
  { who: "Seller", does: "Mounts the middleware, names a price per route, verifies the Paid event on QIE, stores the response, then sends it. A retry returns the stored copy.", holds: "the resource and the merchant address" },
];

export function HowItWorks() {
  return (
    <section className="container py-24">
      <SectionHeader title="Three parties. The contract is the only one that decides." lead="Nobody has to trust the agent. The owner's rules live in the settlement contract, so a compromised agent can still only spend what the owner already allowed." />
      <div className="mt-14 grid border-t-2 border-foreground lg:grid-cols-3">
        {PARTIES.map((p, k) => (
          <div key={p.who} className={cn("border-b py-8 lg:border-b-0 lg:px-8 lg:first:pl-0 lg:last:pr-0", k > 0 && "lg:border-l")}>
            <h3 className="text-[1.6rem] font-bold leading-none [font-stretch:118%]">{p.who}</h3>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">{p.does}</p>
            <p className="mt-5 text-sm"><span className="text-muted-foreground">Holds </span><span className="font-semibold">{p.holds}</span></p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the posted tariff board */

const RULES: [string, string, string][] = [
  ["Per-call cap", "One payment above the cap is refused.", "CapExceeded"],
  ["Daily cap", "Spend is counted per UTC day inside the same transaction that debits. Up to 2x can pass across midnight UTC; this is documented.", "DailyCapExceeded"],
  ["Merchant allowlist", "Paying an address the owner has not allowed is refused.", "MerchantNotAllowed"],
  ["Revoke", "Clears the agent. Its next payment is refused.", "NotOwnerAgent"],
  ["Pause", "Blocks payments for this account. Withdrawals keep working.", "Paused"],
  ["Single use", "Each (merchant, requestId) pair can be paid once, forever.", "RequestAlreadyUsed"],
  ["Balance", "An agent cannot spend more than the owner deposited.", "InsufficientBalance"],
];

export function SpendingControls() {
  return (
    <section className="bg-[hsl(213_14%_11%)] py-24 text-[hsl(96_13%_88%)]">
      <div className="container">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.5fr] [&>*]:min-w-0">
          <div>
            <h2 className="h-section">The owner posts the rules. The contract enforces them.</h2>
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/70">Each rule is checked inside the pay transaction itself. If one fails, the transaction reverts with a named error and no QUSDC moves. The owner can always withdraw: there is no admin key, upgrade path or rescue function.</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/15">
            <div className="barrier-stripe h-1.5" aria-hidden />
            <table className="w-full text-left text-[15px]">
              <caption className="sr-only">Spending rules enforced by the settlement contract, and the error each one returns</caption>
              <thead className="border-b border-white/15 text-sm text-white/60">
                <tr><th scope="col" className="px-5 py-3 font-medium">Rule</th><th scope="col" className="hidden px-5 py-3 font-medium sm:table-cell">What happens</th><th scope="col" className="px-5 py-3 text-right font-medium">Refused with</th></tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {RULES.map(([r, d, e]) => (
                  <tr key={r} className="align-top">
                    <th scope="row" className="px-5 py-4 font-semibold">{r}<span className="mt-1 block text-sm font-normal text-white/65 sm:hidden">{d}</span></th>
                    <td className="hidden px-5 py-4 text-white/70 sm:table-cell">{d}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-mono text-[13px] text-[hsl(var(--primary))]">{e}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the lane: request to delivery */

const LANE: [string, string, string][] = [
  ["Request", "The agent asks for a protected resource.", "GET /v1/block-summary"],
  ["Quote", "The seller answers with a signed, expiring challenge bound to one resource and price.", "402 Payment Required"],
  ["Pay", "The agent calls pay on the contract. The owner's rules are checked on chain.", "Paid(owner, agent, merchant, requestId, amount)"],
  ["Verify", "The seller reads the receipt from QIE and waits for confirmations.", "202 pending"],
  ["Pass", "The response is stored, then sent. The same proof returns the stored copy.", "200 OK"],
];

export function WorkflowTimeline() {
  return (
    <section className="container py-24">
      <SectionHeader title="One lane, five stops, from request to resource." lead="Every stop is a real HTTP status or a real contract event. Refusals happen at the pay stop and cost the agent nothing but gas." />
      <ol className="relative mt-14 grid gap-10 lg:grid-cols-5 lg:gap-6">
        <li className="lane-line absolute left-0 right-0 top-[18px] hidden lg:block" aria-hidden />
        <li className="lane-line-v absolute bottom-0 left-[17px] top-0 lg:hidden" aria-hidden />
        {LANE.map(([t, d, code], k) => (
          <li key={t} className="relative pl-14 lg:pl-0">
            <span className={cn("absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-md border-2 border-foreground text-sm font-bold lg:relative", k === 4 ? "bg-primary text-primary-foreground" : "bg-card")} aria-hidden>{k + 1}</span>
            <h3 className="text-xl font-bold [font-stretch:115%] lg:mt-5">{t}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{d}</p>
            <p className="mt-3 break-words font-mono text-[12.5px] text-foreground">{code}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------ closing band */

export function CtaBand({ title = "Watch the barrier lift on mainnet.", lead = "Run the scripted agent against the live gateway, or fund an allowance of your own." }: { title?: string; lead?: string }) {
  return (
    <section className="mt-12 bg-primary text-primary-foreground">
      <div className="container flex flex-col gap-8 py-16 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="h-section max-w-2xl">{title}</h2>
          <p className="mt-3 max-w-xl text-[17px] leading-relaxed text-primary-foreground/85">{lead}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg" variant="ink"><Link href="/playground">Run the live demo</Link></Button>
          <Button asChild size="lg" variant="secondary" className="border-foreground/60 bg-transparent"><Link href="/app">Open the console</Link></Button>
        </div>
      </div>
    </section>
  );
}
