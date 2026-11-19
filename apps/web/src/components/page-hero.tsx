/** Inner-page header: left-aligned, a plain kicker, an expanded-width headline, and a lane line under it. */
export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: React.ReactNode; lead?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section className="border-b">
      <div className="container pb-12 pt-14 sm:pb-16 sm:pt-20">
        <p className="kicker">{eyebrow}</p>
        <h1 className="h-display mt-3 max-w-4xl !text-[2.4rem] sm:!text-[3.4rem]">{title}</h1>
        {lead && <p className="lead mt-5">{lead}</p>}
        {children && <div className="mt-8">{children}</div>}
      </div>
    </section>
  );
}
