import { cn } from "@/lib/utils";

export type GateState = "idle" | "working" | "lifted" | "refused";

/**
 * The toll barrier. The arm lifts (rotates about its post, 600ms ease-out) only when a real run returned "delivered".
 * Under prefers-reduced-motion the arm does not rotate; the caption carries the state in words.
 */
export function Barrier({ state, caption }: { state: GateState; caption: React.ReactNode }) {
  const lifted = state === "lifted";
  return (
    <div className="flex flex-col gap-3">
      {/* The arm is 168px long; the box reserves its full raised height so a lifted arm never covers the steps. */}
      <div className="relative h-[200px] w-[200px] overflow-hidden" aria-hidden>
        {/* road surface */}
        <div className="absolute inset-x-0 bottom-0 h-px bg-border" />
        {/* post */}
        <div className="absolute bottom-0 left-2 h-12 w-4 rounded-t-sm bg-foreground" />
        <div className={cn("absolute bottom-[44px] left-[13px] h-2 w-2 rounded-full", lifted ? "bg-success" : state === "refused" ? "bg-danger" : "bg-primary")} />
        {/* arm, pivoting at the post */}
        <div
          className={cn(
            "absolute bottom-6 left-4 h-3.5 w-[168px] origin-[0%_50%] rounded-sm border border-foreground/60 barrier-stripe",
            "transition-transform duration-[600ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none motion-reduce:!transform-none",
            lifted ? "-rotate-[78deg] motion-reduce:opacity-25" : "rotate-0",
          )}
        />
        {state === "refused" && <div className="absolute bottom-0 left-8 right-0 h-3 stop-stripe" />}
      </div>
      <p role="status" aria-live="polite" className="text-sm">{caption}</p>
    </div>
  );
}
