import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import "./globals.css";

// Archivo's width axis gives the expanded, road-sign headlines (DESIGN.md). Plex Mono is only for machine text.
// Fonts are committed (latin subsets) so a build never depends on reaching Google Fonts. Licences: src/fonts/README.md.
const sans = localFont({ src: "../fonts/archivo-latin.woff2", variable: "--font-sans", display: "swap", weight: "100 900", declarations: [{ prop: "font-stretch", value: "62% 125%" }] });
const mono = localFont({
  src: [{ path: "../fonts/plex-mono-400.woff2", weight: "400" }, { path: "../fonts/plex-mono-500.woff2", weight: "500" }, { path: "../fonts/plex-mono-600.woff2", weight: "600" }],
  variable: "--font-mono", display: "swap", adjustFontFallback: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Turnspike: a toll gate for API requests, paid in QUSDC on QIE", template: "%s | Turnspike" },
  description: "Turnspike lets any API charge per request in QUSDC on QIE Mainnet, while the payer's spending limits are enforced by the settlement contract itself.",
  openGraph: { title: "Turnspike", description: "A toll gate for API requests: agents pay per request in QUSDC, owners set the limits on chain.", type: "website" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [{ media: "(prefers-color-scheme: light)", color: "#E9EDE6" }, { media: "(prefers-color-scheme: dark)", color: "#14171B" }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:font-semibold focus:text-primary-foreground">Skip to content</a>
        {children}
        <Toaster position="bottom-right" closeButton toastOptions={{ className: "!rounded-md !border !font-sans" }} />
      </body>
    </html>
  );
}
