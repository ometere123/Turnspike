import Link from "next/link";

/** A gate post with a lowered barrier arm: the product in one mark. */
export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="6" fill="hsl(var(--foreground))" />
      <rect x="6" y="9" width="4" height="17" rx="1" fill="hsl(var(--background))" />
      <g>
        <rect x="8" y="12" width="19" height="5" rx="1" fill="hsl(var(--primary))" />
        <path d="M13 12l-3 5h3l3-5zM19 12l-3 5h3l3-5zM25 12l-3 5h3l2-3.3V12z" fill="hsl(var(--foreground))" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Turnspike home">
      <LogoMark />
      <span className="text-[18px] font-bold [font-stretch:115%] tracking-tight">Turnspike</span>
    </Link>
  );
}
