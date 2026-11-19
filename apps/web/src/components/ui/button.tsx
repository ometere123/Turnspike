import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Fixed sizes on the 4px grid: 32 / 40 / 48. Primary is the barrier yellow with asphalt text.
const variants = cva(
  "press inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-[15px] font-semibold transition-[background-color,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground [box-shadow:inset_0_-2px_0_hsl(var(--foreground)/.18)] [@media(hover:hover)]:hover:bg-[hsl(45_96%_44%)]",
        secondary: "border border-foreground/25 bg-card text-foreground [@media(hover:hover)]:hover:border-foreground/60",
        ink: "bg-foreground text-background [@media(hover:hover)]:hover:bg-foreground/90",
        ghost: "text-muted-foreground [@media(hover:hover)]:hover:bg-muted [@media(hover:hover)]:hover:text-foreground",
        danger: "border border-danger/50 bg-card text-danger [@media(hover:hover)]:hover:bg-danger/10",
      },
      size: { sm: "h-8 px-3 text-sm", md: "h-10 px-4", lg: "h-12 px-5 text-base", icon: "h-10 w-10" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, loading, children, disabled, ...p }, ref) => {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp ref={ref} className={cn(variants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...p}>
      {asChild ? children : (<>{loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}{children}</>)}
    </Comp>
  );
});
Button.displayName = "Button";
