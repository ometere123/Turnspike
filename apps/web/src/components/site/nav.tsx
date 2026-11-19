"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";

export const NAV = [
  { href: "/product", label: "Product" },
  { href: "/playground", label: "Playground" },
  { href: "/developers", label: "Developers" },
  { href: "/security", label: "Security" },
  { href: "/evidence", label: "Evidence" },
  { href: "/about", label: "About" },
];

export function SiteNav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);

  return (
    <header className={cn("sticky top-0 z-40 transition-all", scrolled ? "border-b bg-background/80 backdrop-blur-xl" : "border-b border-transparent")}>
      <div className="container flex h-16 items-center justify-between">
        <Logo />
        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href ? "page" : undefined}
              className={cn("rounded-lg px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground", path === n.href && "bg-muted text-foreground")}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" className="hidden sm:inline-flex"><Link href="/app">Launch app<ArrowUpRight className="h-4 w-4" aria-hidden /></Link></Button>
          <Button size="icon" variant="secondary" className="lg:hidden" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="mobile-nav" onClick={() => setOpen(!open)}>
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-16 z-40 h-[calc(100dvh-4rem)] overflow-y-auto border-t bg-background lg:hidden">
          <nav aria-label="Mobile" className="container flex flex-col gap-1 py-4">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className={cn("rounded-xl px-4 py-3.5 text-lg font-medium", path === n.href ? "bg-muted" : "hover:bg-muted")}>{n.label}</Link>
            ))}
            <Button asChild size="lg" className="mt-4"><Link href="/app">Launch app</Link></Button>
          </nav>
        </div>
      )}
    </header>
  );
}
