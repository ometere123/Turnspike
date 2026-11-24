import { ExternalLink } from "lucide-react";
import { explorerAddr, explorerTx } from "@/lib/config";
import { short } from "@/lib/utils";
import { CopyButton } from "./copy-button";

export function Address({ value, kind = "address", full = false }: { value: string; kind?: "address" | "tx"; full?: boolean }) {
  const href = kind === "tx" ? explorerTx(value) : explorerAddr(value);
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 font-mono text-[13px]">
      <span className={full ? "min-w-0 break-all" : ""} title={value}>{full ? value : short(value)}</span>
      <CopyButton value={value} label={kind === "tx" ? "Copy transaction hash" : "Copy address"} />
      <a href={href} target="_blank" rel="noreferrer" aria-label={`Open ${kind === "tx" ? "transaction" : "address"} on the QIE explorer`} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </span>
  );
}
