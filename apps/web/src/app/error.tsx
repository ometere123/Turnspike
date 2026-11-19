"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="container flex min-h-[70vh] flex-col items-center justify-center text-center">
      <h1 className="h-section">Something went wrong.</h1>
      <p className="lead mt-3">The page failed to render. Nothing was sent to your wallet.</p>
      <Button className="mt-6" onClick={reset}>Try again</Button>
    </main>
  );
}
