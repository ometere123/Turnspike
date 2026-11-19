import { Reveal } from "@/components/ui/reveal";

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="grid-bg absolute inset-x-0 top-0 -z-10 h-80" aria-hidden />
      <div className="container py-16 sm:py-24">
        <Reveal><p className="mb-3 text-sm font-medium text-accent">{eyebrow}</p></Reveal>
        <Reveal delay={0.05}><h1 className="h-section max-w-3xl !text-4xl sm:!text-5xl">{title}</h1></Reveal>
        {lead && <Reveal delay={0.1}><p className="lead mt-5 max-w-2xl">{lead}</p></Reveal>}
        {children && <Reveal delay={0.15}><div className="mt-8">{children}</div></Reveal>}
      </div>
    </section>
  );
}
