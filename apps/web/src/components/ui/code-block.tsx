import { CopyButton } from "./copy-button";

export function CodeBlock({ code, lang = "ts", title }: { code: string; lang?: string; title?: string }) {
  return (
    <figure className="overflow-hidden rounded-2xl border bg-[hsl(222_20%_8%)] text-[13px] leading-relaxed text-[hsl(40_15%_90%)] shadow-soft">
      <figcaption className="flex items-center justify-between border-b border-white/10 px-4 py-2 text-xs text-white/55">
        <span>{title ?? lang}</span>
        <CopyButton value={code} label="Copy code" className="text-white/60 hover:bg-white/10 hover:text-white" />
      </figcaption>
      <pre className="overflow-x-auto p-4"><code>{code}</code></pre>
    </figure>
  );
}
