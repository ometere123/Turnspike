import { cn } from "@/lib/utils";

export const Skeleton = ({ className }: { className?: string }) => (
  <div aria-hidden className={cn("relative overflow-hidden rounded-lg bg-muted before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-foreground/5 before:to-transparent", className)} />
);
