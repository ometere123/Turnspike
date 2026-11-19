import { cn } from "@/lib/utils";

// Rectangular status labels. The word always carries the meaning; the marker only reinforces it.
const tones = {
  neutral: "border-border text-muted-foreground",
  success: "border-success/40 text-success",
  danger: "border-danger/45 text-danger",
  warn: "border-warn/45 text-warn",
  accent: "border-route/40 text-route",
} as const;

export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-[4px] border bg-card px-2 py-0.5 text-xs font-semibold", tones[tone], className)}>{children}</span>;
}

export function StatusPill({ status }: { status: "pending" | "confirmed" | "failed" | "idle" }) {
  const map = { pending: ["warn", "Pending"], confirmed: ["success", "Confirmed"], failed: ["danger", "Failed"], idle: ["neutral", "Idle"] } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}><span className={cn("h-1.5 w-1.5 rounded-full bg-current", status === "pending" && "animate-pulseDot")} aria-hidden />{label}</Badge>;
}
