"use client";

import { useState } from "react";

// "Brightline Studio": a made-up agency site for the demo. It deliberately has its own look (it is somebody
// else's page) and real flaws to report: the contact form's email field is disabled, the Vertex case study
// card goes nowhere, and "Book a call" fails with a console error and a failed request for the widget's
// diagnostics. `data-pinwren-anchor` marks the elements the seeded feedback is pinned to (lib/demo/seed.ts).

const SERVICES = [
  { name: "Product design", text: "Research, flows and interfaces your users understand on the first try." },
  { name: "Web development", text: "Fast, accessible sites and apps on a stack your team can own." },
  { name: "Brand systems", text: "Identity, tone and the design system that keeps them consistent." },
  {
    name: "Growth & analytics",
    text: "Experiments and dashboards that show what actually moves the needle.",
  },
];

const WORK = [
  {
    id: "demo-work-vertex",
    name: "Vertex SaaS",
    tag: "Product design · 2026",
    tone: "from-[#1e3a8a] to-[#3b82f6]",
  },
  { id: "demo-work-lumen", name: "Lumen Health", tag: "Web app · 2025", tone: "from-[#065f46] to-[#34d399]" },
  {
    id: "demo-work-orbit",
    name: "Orbit Logistics",
    tag: "Brand system · 2025",
    tone: "from-[#7c2d12] to-[#fb923c]",
  },
];

const STATS = [
  { value: "120+", label: "products shipped" },
  { value: "38", label: "people in 4 cities" },
  { value: "4.9/5", label: "average client rating" },
];

export function SampleSite() {
  const [callError, setCallError] = useState<string | null>(null);

  async function bookCall() {
    setCallError(null);
    try {
      const res = await fetch("/demo-api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intent: "book-call" }),
      });
      if (!res.ok) throw new Error(`Booking failed (${res.status})`);
    } catch (err) {
      // On purpose: the widget's diagnostics record this for the next bug report.
      console.error("TypeError: calendar is undefined —", err instanceof Error ? err.message : err);
      setCallError("We couldn't book that call. (It always fails here — report it as a bug!)");
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e2e6f0] bg-[#f7f8fc] text-[#141a2e] shadow-sm">
      <nav
        aria-label="Sample site"
        className="flex items-center justify-between border-b border-[#e2e6f0] bg-white/70 px-5 py-4 sm:px-8"
      >
        <span className="text-lg font-bold tracking-tight">
          Brightline<span className="text-[#2448ff]">.</span>
        </span>
        <ul className="hidden gap-6 text-sm text-[#4a5270] sm:flex">
          <li>Work</li>
          <li>Services</li>
          <li>About</li>
        </ul>
        <span className="rounded-full bg-[#2448ff] px-3.5 py-1.5 text-xs font-semibold text-white">
          Contact
        </span>
      </nav>

      <section className="relative px-5 py-14 text-center sm:px-8 md:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,#d5dbea_1px,transparent_0)] [background-size:22px_22px] opacity-60"
        />
        <div className="relative mx-auto max-w-3xl">
          <p className="text-xs font-semibold tracking-[0.2em] text-[#2448ff] uppercase">Digital agency</p>
          <h2
            data-pinwren-anchor="demo-hero-title"
            className="mt-4 text-4xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl"
          >
            We craft digital experiences <span className="text-[#2448ff]">that matter.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-[#4a5270] sm:text-lg">
            Brightline Studio is a design and development agency helping startups and established brands ship
            polished digital products. From concept to launch, we handle every pixel.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a
              href="#demo-work"
              className="rounded-lg bg-[#2448ff] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1b37cc]"
            >
              View our work
            </a>
            <a
              href="#demo-services"
              className="rounded-lg border border-[#cfd5e6] bg-white px-5 py-3 text-sm font-semibold hover:bg-[#f0f2f9]"
            >
              Our services
            </a>
          </div>
        </div>
      </section>

      <section
        id="demo-services"
        aria-labelledby="demo-services-title"
        className="bg-white px-5 py-14 sm:px-8"
      >
        <p className="text-center text-xs font-semibold tracking-[0.2em] text-[#2448ff] uppercase">
          What we do
        </p>
        <h3 id="demo-services-title" className="mt-2 text-center text-3xl font-bold tracking-tight">
          Services
        </h3>
        <div
          data-pinwren-anchor="demo-services"
          className="mx-auto mt-8 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {SERVICES.map((s) => (
            <article key={s.name} className="rounded-xl border border-[#e2e6f0] bg-[#f7f8fc] p-5">
              <h4 className="font-semibold">{s.name}</h4>
              <p className="mt-2 text-sm text-[#4a5270]">{s.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section
        data-pinwren-anchor="demo-stats"
        aria-label="Studio in numbers"
        className="grid gap-6 border-y border-[#e2e6f0] px-5 py-10 text-center sm:grid-cols-3 sm:px-8"
      >
        {STATS.map((s) => (
          <div key={s.label}>
            <p className="text-3xl font-extrabold tracking-tight text-[#2448ff]">{s.value}</p>
            <p className="mt-1 text-sm text-[#4a5270]">{s.label}</p>
          </div>
        ))}
      </section>

      <section id="demo-work" aria-labelledby="demo-work-title" className="px-5 py-14 sm:px-8">
        <h3 id="demo-work-title" className="text-center text-3xl font-bold tracking-tight">
          Selected work
        </h3>
        <div className="mx-auto mt-8 grid max-w-5xl gap-4 md:grid-cols-3">
          {WORK.map((w) => (
            <article
              key={w.id}
              data-pinwren-anchor={w.id}
              className="cursor-pointer overflow-hidden rounded-xl border border-[#e2e6f0] bg-white transition-shadow hover:shadow-md"
            >
              <div className={`aspect-[4/3] bg-gradient-to-br ${w.tone}`} aria-hidden />
              <div className="p-4">
                <h4 className="font-semibold">{w.name}</h4>
                <p className="text-sm text-[#4a5270]">{w.tag}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="demo-contact-title" className="bg-white px-5 py-14 sm:px-8">
        <form onSubmit={(e) => e.preventDefault()} className="mx-auto grid max-w-lg gap-4">
          <h3 id="demo-contact-title" className="text-center text-3xl font-bold tracking-tight">
            Start a project
          </h3>
          <label className="grid gap-1.5 text-sm font-medium">
            Name
            <input
              autoComplete="off"
              placeholder="Jane Cooper"
              className="rounded-lg border border-[#cfd5e6] px-3 py-2 font-normal focus-visible:ring-2 focus-visible:ring-[#2448ff] focus-visible:outline-none"
            />
          </label>
          <label data-pinwren-anchor="demo-contact-email" className="grid gap-1.5 text-sm font-medium">
            Work email
            {/* Disabled by mistake — one of the page's planted bugs. */}
            <input
              type="email"
              disabled
              placeholder="jane@company.com"
              className="rounded-lg border border-[#cfd5e6] bg-[#f0f2f9] px-3 py-2 font-normal"
            />
          </label>
          <button
            type="button"
            onClick={() => void bookCall()}
            className="rounded-lg bg-[#2448ff] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1b37cc]"
          >
            Book a call
          </button>
          {callError && (
            <p role="alert" className="rounded-lg bg-[#fdecec] px-3 py-2 text-sm text-[#9f1d1d]">
              {callError}
            </p>
          )}
        </form>
      </section>
      <footer className="border-t border-[#e2e6f0] px-5 py-5 text-xs text-[#4a5270] sm:px-8">
        Brightline Studio is a made-up agency for the Pinwren demo.
      </footer>
    </div>
  );
}
