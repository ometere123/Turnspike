import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1.25rem", screens: { "2xl": "1180px" } },
    extend: {
      colors: {
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--foreground))" },
        border: "hsl(var(--border))", ring: "hsl(var(--ring))",
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))", soft: "hsl(var(--accent-soft))" },
        success: "hsl(var(--success))", danger: "hsl(var(--danger))", warn: "hsl(var(--warn))",
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["var(--font-mono)", "ui-monospace", "monospace"] },
      borderRadius: { xl: "14px", "2xl": "20px", "3xl": "28px" },
      boxShadow: {
        soft: "0 1px 2px hsl(var(--shadow) / .05), 0 8px 24px -8px hsl(var(--shadow) / .10)",
        lift: "0 2px 4px hsl(var(--shadow) / .06), 0 24px 48px -16px hsl(var(--shadow) / .18)",
      },
      keyframes: { shimmer: { "100%": { transform: "translateX(100%)" } }, pulseDot: { "0%,100%": { opacity: ".35" }, "50%": { opacity: "1" } } },
      animation: { shimmer: "shimmer 1.6s infinite", pulseDot: "pulseDot 1.6s ease-in-out infinite" },
    },
  },
  plugins: [],
};
export default config;
