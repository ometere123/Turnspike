/**
 * Formerly a scroll fade-in. The design system (DESIGN.md) has no scroll-reveal on sections, so this is now a plain
 * wrapper kept for API compatibility. The only orchestrated motion is the barrier on the live gate.
 */
export function Reveal({ children, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return <div className={className}>{children}</div>;
}
