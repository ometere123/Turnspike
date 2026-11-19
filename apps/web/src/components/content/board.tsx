import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

/** Posted tariff board: a ruled table with a heavy top rule, sentence-case headers, scrolls inside itself on narrow screens. */
export function Tariff({ head, rows, caption, colClass = [], minWidth = "min-w-[560px]" }: {
  head?: string[];
  rows: React.ReactNode[][];
  caption?: string;
  colClass?: string[];
  minWidth?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-t-2 border-t-foreground bg-card">
      <table className={cn("w-full text-left text-sm", minWidth)}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {head && (
          <thead className="border-b bg-muted text-[13px] font-semibold">
            <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5">{h}</th>)}</tr>
          </thead>
        )}
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => <td key={j} className={cn("px-4 py-3", j > 0 && "text-muted-foreground", colClass[j])}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Posted notice: a titled board with a plain list of rules. Each rule has a short heading and a sentence or two. */
export function Notice({ id, kicker, title, lead, rules, tone = "plain", headingLevel = "h2" }: {
  id?: string;
  kicker: string;
  title: string;
  lead?: React.ReactNode;
  rules: [string, React.ReactNode][];
  tone?: "plain" | "warn";
  headingLevel?: "h2";
}) {
  const Heading = headingLevel;
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-2xl border-2 border-foreground bg-card">
      <header className={cn("border-b-2 border-foreground px-5 py-5 sm:px-8 sm:py-6", tone === "warn" && "bg-primary text-primary-foreground")}>
        <p className={cn("text-sm font-medium", tone === "warn" ? "text-primary-foreground" : "text-muted-foreground")}>{kicker}</p>
        <Heading id={id ? `${id}-title` : undefined} className="h-section mt-2 !text-[1.6rem] sm:!text-[2rem]">{title}</Heading>
        {lead && <p className={cn("mt-3 max-w-[64ch] text-[15px] leading-relaxed", tone === "warn" ? "text-primary-foreground" : "text-muted-foreground")}>{lead}</p>}
      </header>
      <ul className="divide-y">
        {rules.map(([t, d]) => (
          <li key={t} className="grid gap-x-8 gap-y-1 px-5 py-4 md:grid-cols-[minmax(0,15rem)_1fr] sm:px-8">
            <h3 className="font-semibold leading-snug">{t}</h3>
            <p className="max-w-[72ch] text-[15px] leading-relaxed text-muted-foreground">{d}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Repository or external link in mono, for file paths. */
export function FileLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="link inline-flex items-center gap-1 break-all font-mono text-[13px]" href={href} target="_blank" rel="noreferrer">
      {children}
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
}
