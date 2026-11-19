import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="container flex min-h-[70vh] flex-col items-center justify-center text-center">
      <p className="text-sm font-medium text-accent">404</p>
      <h1 className="h-section mt-2">That page does not exist.</h1>
      <p className="lead mt-3">Check the address, or start from the home page.</p>
      <Button asChild className="mt-6"><Link href="/">Back to home</Link></Button>
    </main>
  );
}
