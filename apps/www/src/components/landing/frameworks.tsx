const STACKS = [
  "HTML",
  "React",
  "Next.js",
  "Vue",
  "Nuxt",
  "Svelte",
  "Astro",
  "Remix",
  "Angular",
  "WordPress",
  "Webflow",
  "Shopify",
  "Laravel",
  "Rails",
  "Django",
];

/** One script tag works anywhere a page can load a script; the list scrolls (paused for reduced motion). */
export function Frameworks() {
  return (
    <section aria-labelledby="frameworks-title" className="border-b py-12">
      <div className="container-page">
        <h2 id="frameworks-title" className="text-center text-sm font-medium text-muted-foreground">
          Works on any site that can load a script tag
        </h2>
        <div className="relative mt-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_12%,black_88%,transparent)]">
          <ul className="animate-marquee flex w-max gap-3 hover:[animation-play-state:paused]">
            {[...STACKS, ...STACKS].map((s, i) => (
              <li
                key={`${s}-${i < STACKS.length ? "a" : "b"}`}
                aria-hidden={i >= STACKS.length}
                className="rounded-full border bg-card px-4 py-1.5 text-sm font-medium whitespace-nowrap text-foreground/80 shadow-xs"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
