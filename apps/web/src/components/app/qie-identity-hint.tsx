"use client";

import { useState } from "react";
import { BookOpenCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lookupQieName } from "@/lib/qie-id";
import { isHexAddress } from "@/lib/address";

type Result = { ok: true; name: string; address: string } | { ok: false; message: string };

/** An optional, untrusted directory label. It never replaces the address sent to the contract. */
export function QieIdentityHint({ address }: { address: string }) {
  const [lastChecked, setLastChecked] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const valid = isHexAddress(address);
  const current = lastChecked.toLowerCase() === address.toLowerCase();
  const display = current ? result : null;

  const inspect = async () => {
    if (!valid) return;
    setLoading(true);
    setResult(null);
    setLastChecked(address);
    try {
      const found = await lookupQieName(address);
      setResult(found);
    } catch {
      setResult({ ok: false, message: "QIE ID is unavailable. Continue using the full wallet address." });
    } finally { setLoading(false); }
  };

  return (
    <div className="rounded-md border border-dashed bg-background px-3 py-3 text-sm" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-medium">QIE ID name check <span className="font-normal text-muted-foreground">(optional)</span></p>
        <Button type="button" variant="secondary" size="sm" disabled={!valid || loading} loading={loading} onClick={inspect}>
          {!loading && <Search className="h-4 w-4" aria-hidden />}{loading ? "Checking…" : "Look up name"}
        </Button>
      </div>
      {display?.ok ? (
        <div className="mt-2">
          <p className="flex items-center gap-2 font-semibold"><BookOpenCheck className="h-4 w-4 text-success" aria-hidden />{display.name}</p>
          <p className="mt-1 break-all font-mono text-[12px] text-muted-foreground">{display.address}</p>
          <p className="mt-2 text-muted-foreground">The public QIE ID forward and reverse records currently agree. This is a directory label, not a verified business identity. The contract still receives only the address above.</p>
        </div>
      ) : display && !display.ok ? (
        <p className="mt-2 text-muted-foreground">{display.message} The address remains the payment and allowlist authority.</p>
      ) : (
        <p className="mt-2 text-muted-foreground">Check the public name directory before allowing a merchant. Names can change; verify the full address independently.</p>
      )}
    </div>
  );
}
