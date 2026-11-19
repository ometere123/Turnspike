import type { Metadata } from "next";
import Link from "next/link";
import { WalletProvider } from "@/lib/wallet";
import { WalletButton } from "@/components/site/wallet-button";
import { Logo } from "@/components/site/logo";

export const metadata: Metadata = { title: "App", description: "Fund your allowance, set spending limits and manage the agent that pays for APIs.", robots: { index: false } };

const NAV = [
  { href: "/playground", label: "Playground" },
  { href: "/developers", label: "Docs" },
  { href: "/evidence", label: "Evidence" },
];

/** The application shell is deliberately distinct from the marketing navigation (no footer, wallet-first header). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <header className="sticky top-0 z-40 border-b bg-background">
        <div className="container flex h-16 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-4">
            <Logo />
            <span className="hidden border-l pl-4 text-sm font-semibold sm:inline">Owner console</span>
            <nav aria-label="App" className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="inline-flex h-10 items-center rounded-md px-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(hover:hover)]:hover:text-foreground">{n.label}</Link>
              ))}
            </nav>
          </div>
          <WalletButton />
        </div>
      </header>
      <main id="main" className="container py-8 sm:py-10">{children}</main>
    </WalletProvider>
  );
}
