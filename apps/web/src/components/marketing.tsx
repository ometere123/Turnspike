import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn, short } from "@/lib/utils";
import { explorerTx } from "@/lib/config";
import { LIVE_DEMO_V2 } from "@/data/evidence";

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
  { who: "Owner", does: "Deposits QUSDC and posts the rules for one agent key.", holds: "the money and the rules" },
  { who: "Agent", does: "Meets a 402, checks the quote, and pays inside the owner's rules.", holds: "a key that can pay, nothing more" },
  { who: "Seller", does: "Names a price, verifies the payment on QIE, delivers the response.", holds: "the resource and the merchant address" },
];

export function HowItWorks() {
  return (
    <section className="container py-24">
      <SectionHeader title="Three parties. The contract is the only one that decides." lead="A compromised agent can still only spend what the owner already allowed." />
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
  ["Daily cap", "Counted per UTC day. Up to 2x can pass across midnight UTC.", "DailyCapExceeded"],
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
            <p className="mt-4 max-w-md text-[17px] leading-relaxed text-white/70">Every rule is checked inside the payment. If one fails, no QUSDC moves. No admin key, no upgrade, no rescue function.</p>
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
  ["Quote", "Signed, expiring, bound to one resource.", "402 Payment Required"],
  ["Pay", "The contract checks the owner's rules.", "Paid(owner, agent, merchant, requestId, amount)"],
  ["Verify", "The seller reads the receipt from QIE.", "202 pending"],
  ["Pass", "Stored, then sent. The same proof replays it.", "200 OK"],
];

export function WorkflowTimeline() {
  return (
    <section className="container py-24">
      <SectionHeader title="One lane, five stops, from request to resource." lead="Every stop is a real HTTP status or contract event." />
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

/* Closes a page on a real artefact rather than a slogan: the recorded over-limit payment the contract refused on
 * QIE Mainnet (evidence M7), as a stopped ticket with its explorer link. */
const REFUSAL = LIVE_DEMO_V2.find((t) => t.note === "CapExceeded")!;

export function CtaBand({ title = "The last word belongs to the contract.", lead = "An agent tried to pay one base unit over its owner's per-call limit. The payment never left the vault." }: { title?: string; lead?: string }) {
  return (
    <section className="mt-12 border-t bg-muted/40">
      <div className="container grid gap-10 py-16 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-center">
        <div>
          <h2 className="h-section max-w-2xl">{title}</h2>
          <p className="lead mt-4">{lead}</p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg"><Link href="/operations">Inspect a real payment</Link></Button>
            <Button asChild size="lg" variant="secondary"><Link href="/app">Open the console</Link></Button>
          </div>
        </div>
        <a href={explorerTx(REFUSAL.hash)} target="_blank" rel="noreferrer" className="ticket shadow-ticket group block focus-visible:outline-offset-4" style={{ ["--notch-y" as string]: "72px" }}>
          <div className="stop-stripe h-2 rounded-t-[var(--radius)]" aria-hidden />
          <div className="px-6 pb-4 pt-4">
            <p className="kicker">Refused on QIE Mainnet</p>
            <p className="mt-1 font-mono text-[1.6rem] font-semibold leading-tight text-danger">{REFUSAL.note}</p>
          </div>
          <div className="perforation mx-6" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 px-6 py-4 text-sm">
            <dt className="text-muted-foreground">Transaction</dt>
            <dd className="font-mono text-[13px]">{short(REFUSAL.hash, 10, 6)}</dd>
            <dt className="text-muted-foreground">Moved</dt>
            <dd className="num">0 QUSDC</dd>
          </dl>
          <p className="border-t px-6 py-3 text-sm text-route [@media(hover:hover)]:group-hover:underline">Open it on the explorer</p>
        </a>
      </div>
    </section>
  );
}
