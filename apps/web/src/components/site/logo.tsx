import Link from "next/link";

export function LogoMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="hsl(var(--accent))" />
      <path d="M8 21h16M10 21V12m12 9V12M8 12h16M16 12V8" stroke="hsl(var(--accent-foreground))" strokeWidth="2.2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="Turnspike home">
      <LogoMark />
      <span className="text-[17px]">Turnspike</span>
    </Link>
  );
}
