export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="relative overflow-hidden border-b">
      <div className="grid-bg absolute inset-x-0 top-0 -z-10 h-80" aria-hidden />
      <div className="container py-16 sm:py-24">
        <div className="animate-fade-up"><p className="mb-3 text-sm font-medium text-accent">{eyebrow}</p></div>
        <div className="animate-fade-up" style={{ animationDelay: "50ms" }}><h1 className="h-section max-w-3xl !text-4xl sm:!text-5xl">{title}</h1></div>
        {lead && <div className="animate-fade-up" style={{ animationDelay: "100ms" }}><p className="lead mt-5 max-w-2xl">{lead}</p></div>}
        {children && <div className="animate-fade-up" style={{ animationDelay: "150ms" }}><div className="mt-8">{children}</div></div>}
      </div>
    </section>
  );
}
