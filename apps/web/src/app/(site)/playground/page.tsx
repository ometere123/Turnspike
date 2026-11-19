import type { Metadata } from "next";
import { WalletProvider } from "@/lib/wallet";
import { Playground } from "@/components/playground/playground";

export const metadata: Metadata = {
  title: "Playground",
  description: "Run the scripted agent against the live Turnpike gateway on QIE Mainnet: pay, get refused over the cap, and watch replays rejected.",
};

export default function PlaygroundPage() {
  return (
    <WalletProvider>
      <Playground />
    </WalletProvider>
  );
}
