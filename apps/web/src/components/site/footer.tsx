import Link from "next/link";
import { config, explorerAddr } from "@/lib/config";
import { Logo } from "./logo";

const cols = [
  { title: "Product", links: [["Overview", "/product"], ["Playground", "/playground"], ["Launch app", "/app"]] },
  { title: "Build", links: [["Developers", "/developers"], ["Security", "/security"], ["Evidence", "/evidence"]] },
  { title: "Project", links: [["About", "/about"]] },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="container grid gap-10 py-14 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">Per-request API payments in QUSDC on QIE Mainnet, with spending limits enforced by the contract.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <h2 className="text-sm font-semibold">{c.title}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              {c.links.map(([l, h]) => <li key={h}><Link className="hover:text-foreground" href={h}>{l}</Link></li>)}
              {c.title === "Project" && (
                <>
                  <li><a className="hover:text-foreground" href={config.repoUrl} target="_blank" rel="noreferrer">Source on GitHub</a></li>
                  <li><a className="hover:text-foreground" href={explorerAddr(config.allowance)} target="_blank" rel="noreferrer">Contract on explorer</a></li>
                </>
              )}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t">
        <div className="container flex flex-col gap-2 py-5 text-xs text-muted-foreground sm:flex-row sm:justify-between">
          <p>Built for QIE Hackathon 3.0. Unaudited software on QIE Mainnet. Use small amounts only.</p>
          <p>MIT licensed.</p>
        </div>
      </div>
    </footer>
  );
}
