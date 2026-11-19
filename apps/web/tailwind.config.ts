import type { Config } from "tailwindcss";

// Toll plaza design system. Tokens live in globals.css; see DESIGN.md.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: { DEFAULT: "1.25rem", lg: "2rem" }, screens: { "2xl": "1200px" } },
    extend: {
      colors: {
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--foreground))" },
        border: "hsl(var(--border))", ring: "hsl(var(--ring))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        route: "hsl(var(--route))",
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))", soft: "hsl(var(--accent-soft))" },
        success: "hsl(var(--success))", danger: "hsl(var(--danger))", warn: "hsl(var(--warn))",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "ui-monospace", "monospace"] },
      // Industrial radii: controls and tickets 6px, large panels 10px.
      borderRadius: { md: "6px", lg: "6px", xl: "8px", "2xl": "10px", "3xl": "12px" },
      boxShadow: {
        soft: "0 1px 0 hsl(var(--shadow) / .04)",
        lift: "0 1px 0 hsl(var(--shadow) / .06), 0 18px 40px -18px hsl(var(--shadow) / .35)",
      },
      transitionTimingFunction: { out: "cubic-bezier(0.23,1,0.32,1)", "in-out": "cubic-bezier(0.77,0,0.175,1)" },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        pulseDot: { "0%,100%": { opacity: ".35" }, "50%": { opacity: "1" } },
        barrierDown: { from: { transform: "rotate(-72deg)" }, to: { transform: "rotate(0deg)" } },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        "barrier-down": "barrierDown 900ms cubic-bezier(0.23,1,0.32,1) both",
      },
    },
  },
  plugins: [],
};
export default config;
