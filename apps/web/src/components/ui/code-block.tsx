import { CopyButton } from "./copy-button";

// Code sits on an asphalt panel in both themes: machine text is set apart from prose.
export function CodeBlock({ code, lang = "ts", title }: { code: string; lang?: string; title?: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-[hsl(213_14%_20%)] bg-[hsl(213_14%_11%)] text-[13px] leading-[1.65] text-[hsl(96_13%_88%)]">
      <figcaption className="flex items-center justify-between border-b border-white/10 px-4 py-2 font-mono text-xs text-white/60">
        <span>{title ?? lang}</span>
        <CopyButton value={code} label="Copy code" className="text-white/70 hover:bg-white/10 hover:text-white" />
      </figcaption>
      <pre tabIndex={0} aria-label={`${title ?? lang} code`} role="region" className="overflow-x-auto p-4 font-mono focus-visible:-outline-offset-2"><code>{code}</code></pre>
    </figure>
  );
}
