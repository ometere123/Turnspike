import { Address } from "@/components/ui/address";
import { FileLink } from "@/components/content/board";
import { repoFile } from "@/lib/config";
import { cn } from "@/lib/utils";
import type { EvidenceTx } from "@/data/evidence";

/** A strip of recorded transactions, printed like a roll of toll receipts. Refusals carry the stop stripe and the word. */
export function ReceiptRoll({ rows, label }: { rows: EvidenceTx[]; label: string }) {
  return (
    <div className="ticket overflow-hidden [--notch-y:24px]">
      <div className="hidden grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b bg-muted px-5 py-2.5 text-[13px] font-semibold md:grid sm:px-6" aria-hidden>
        <span>Step</span><span>Outcome</span><span>Transaction</span><span>Source file</span>
      </div>
      <ol aria-label={label}>
        {rows.map((r, i) => {
          const refused = r.outcome === "refused";
          return (
            <li key={r.hash + r.label} className="relative">
              {i > 0 && <div className="perforation mx-5 sm:mx-6" aria-hidden />}
              {refused && <span className="stop-stripe absolute inset-y-0 left-0 w-1.5" aria-hidden />}
              <div className="grid gap-x-4 gap-y-2 px-5 py-4 sm:px-6 md:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug">{r.label}</p>
                  {r.note && <p className="mt-0.5 text-sm text-muted-foreground">{r.note}</p>}
                </div>
                <p className={cn("inline-flex items-center gap-2 text-sm font-semibold", refused ? "text-danger" : "text-success")}>
                  <span className={cn("h-2 w-2 shrink-0", refused ? "rotate-45 bg-danger" : "rounded-full bg-success")} aria-hidden />
                  {refused ? "Refused" : "Passed"}
                  <span className="sr-only">{refused ? " (reverted on-chain)" : " (succeeded)"}</span>
                </p>
                <div className="min-w-0"><span className="sr-only">Transaction: </span><Address value={r.hash} kind="tx" /></div>
                <div className="min-w-0"><span className="sr-only">Source file: </span><FileLink href={repoFile(r.source)}>{r.source.replace("evidence/", "")}</FileLink></div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
