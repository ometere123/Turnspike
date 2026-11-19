import Link from "next/link";
import { config, explorerAddr } from "@/lib/config";
import { LogoMark } from "./logo";

const cols = [
  { title: "Product", links: [["How it works", "/product"], ["Live demo", "/playground"], ["Owner console", "/app"]] },
  { title: "Build", links: [["Developer guide", "/developers"], ["Security notes", "/security"], ["Mainnet evidence", "/evidence"]] },
  { title: "Project", links: [["About", "/about"]] },
] as const;

/** Closing band in asphalt: the posted facts of the gate, then the links. */
export function SiteFooter() {
  return (
    <footer className="mt-24 bg-[hsl(213_14%_11%)] text-[hsl(96_13%_88%)]">
      <div className="barrier-stripe h-2" aria-hidden />
      <div className="container grid gap-12 py-16 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9" />
            <span className="text-2xl font-bold [font-stretch:118%]">Turnspike</span>
          </div>
          <dl className="mt-8 grid gap-4 text-sm">
            <div><dt className="text-white/55">Network</dt><dd className="mt-0.5">QIE Mainnet, chain {config.chainId}</dd></div>
            <div><dt className="text-white/55">Settlement contract</dt><dd className="mt-0.5"><a className="break-all font-mono text-[13px] underline decoration-white/30 underline-offset-4 hover:decoration-white" href={explorerAddr(config.allowance)} target="_blank" rel="noreferrer">{config.allowance}</a></dd></div>
            <div><dt className="text-white/55">Currency</dt><dd className="mt-0.5">QUSDC, 6 decimals</dd></div>
          </dl>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="text-sm font-semibold text-white/55">{c.title}</h2>
            <ul className="mt-4 space-y-3">
              {c.links.map(([l, h]) => <li key={h}><Link className="text-[15px] hover:text-[hsl(var(--primary))]" href={h}>{l}</Link></li>)}
              {c.title === "Project" && (
                <li><a className="text-[15px] hover:text-[hsl(var(--primary))]" href={config.repoUrl} target="_blank" rel="noreferrer">Source on GitHub</a></li>
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="container flex flex-col gap-2 py-6 text-sm text-white/55 sm:flex-row sm:justify-between">
          <p>Unaudited software on QIE Mainnet. Use small amounts only.</p>
          <p>Built for QIE Hackathon 3.0. MIT licence.</p>
        </div>
      </div>
    </footer>
  );
}
