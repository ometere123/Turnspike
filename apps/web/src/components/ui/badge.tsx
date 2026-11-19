import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warn: "bg-warn/15 text-warn",
  accent: "bg-accent-soft text-accent",
} as const;

export function Badge({ tone = "neutral", className, children }: { tone?: keyof typeof tones; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

/** The label carries the meaning; colour is never the only signal. */
export function StatusPill({ status }: { status: "pending" | "confirmed" | "failed" | "idle" }) {
  const map = { pending: ["warn", "Pending"], confirmed: ["success", "Confirmed"], failed: ["danger", "Failed"], idle: ["neutral", "Idle"] } as const;
  const [tone, label] = map[status];
  return <Badge tone={tone}><span className={cn("h-1.5 w-1.5 rounded-full bg-current", status === "pending" && "animate-pulseDot")} aria-hidden />{label}</Badge>;
}
