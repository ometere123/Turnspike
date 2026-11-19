import type { Metadata } from "next";
import Link from "next/link";
import { WalletButton } from "@/components/site/wallet-button";
import { Logo } from "@/components/site/logo";

export const metadata: Metadata = { title: "App", description: "Fund your allowance, set spending limits and manage the agent that pays for APIs.", robots: { index: false } };

/** The application shell is deliberately distinct from the marketing navigation (no footer, wallet-first header). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between gap-3">
          <div className="flex items-center gap-5">
            <Logo />
            <span className="hidden rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent sm:inline">App</span>
            <nav aria-label="App" className="hidden items-center gap-4 text-sm text-muted-foreground md:flex">
              <Link href="/playground" className="hover:text-foreground">Playground</Link>
              <Link href="/developers" className="hover:text-foreground">Docs</Link>
              <Link href="/evidence" className="hover:text-foreground">Evidence</Link>
            </nav>
          </div>
          <WalletButton />
        </div>
      </header>
      <main id="main" className="container py-8">{children}</main>
    </>
  );
}
