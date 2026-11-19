import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { WalletProvider } from "@/lib/wallet";
import "./globals.css";

const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Turnpike: pay-per-request APIs with owner-limited agent spending", template: "%s | Turnpike" },
  description: "Turnpike lets any API charge per request in QUSDC on QIE Mainnet, while the payer's spending limits are enforced by the settlement contract itself.",
  openGraph: { title: "Turnpike", description: "Per-request API payments in QUSDC with on-chain spending limits.", type: "website" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#faf9f6" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow-lift">Skip to content</a>
        <WalletProvider>{children}</WalletProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
