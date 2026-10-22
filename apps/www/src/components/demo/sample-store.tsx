"use client";

import { useState } from "react";

// "Harbor & Pine": a made-up client site for the demo. It deliberately has its own look (it is somebody
// else's page) and a broken "Add to cart" so bug reports pick up a real console error and failed request.
// `data-pinwren-anchor` marks the elements the seeded comments are pinned to.

const PRODUCTS = [
  {
    id: "demo-product-jacket",
    name: "Tidewater shell jacket",
    price: "$249",
    tone: "from-[#2f4858] to-[#5c7d8a]",
  },
  { id: "demo-product-pack", name: "Ridgeline 38L pack", price: "$189", tone: "from-[#7a5c3e] to-[#c08b5c]" },
  {
    id: "demo-product-flask",
    name: "Cairn insulated flask",
    price: "$42",
    tone: "from-[#3e5a3a] to-[#7f9c6b]",
  },
];

export function SampleStore() {
  const [cartError, setCartError] = useState<string | null>(null);

  async function addToCart(name: string) {
    setCartError(null);
    try {
      const res = await fetch("/demo-api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item: name, quantity: 1 }),
      });
      if (!res.ok) throw new Error(`Checkout failed (${res.status})`);
    } catch (err) {
      // On purpose: the widget's diagnostics record this for the next bug report.
      console.error("TypeError: cart is undefined —", err instanceof Error ? err.message : err);
      setCartError(
        "Something went wrong adding that to your cart. (It always does here — report it as a bug!)",
      );
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e7e1d8] bg-[#fbf8f3] text-[#2b2620] shadow-sm">
      <nav
        aria-label="Sample store"
        className="flex items-center justify-between border-b border-[#e7e1d8] px-5 py-4 sm:px-8"
      >
        <span className="font-serif text-lg font-semibold tracking-tight">Harbor &amp; Pine</span>
        <ul className="hidden gap-6 text-sm text-[#5d554b] sm:flex">
          <li>Shop</li>
          <li>Journal</li>
          <li>Stores</li>
        </ul>
        <span className="rounded-full bg-[#2b2620] px-3 py-1 text-xs font-medium text-[#fbf8f3]">
          Cart · 0
        </span>
      </nav>

      <section className="grid items-center gap-8 px-5 py-10 sm:px-8 md:grid-cols-2 md:py-14">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#8a5a2b] uppercase">Autumn collection</p>
          <h2
            data-pinwren-anchor="demo-hero-title"
            className="mt-3 font-serif text-4xl leading-tight font-semibold sm:text-5xl"
          >
            Gear for the long way round
          </h2>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-[#5d554b]">
            Packs, shells and flasks made to be repaired, not replaced. Free returns for 60 days, and free
            repairs for life.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="#demo-products"
              className="rounded-full bg-[#2b2620] px-5 py-2.5 text-sm font-medium whitespace-nowrap text-[#fbf8f3]"
            >
              Shop the collection
            </a>
            <span className="rounded-full border border-[#cfc5b8] px-5 py-2.5 text-sm font-medium whitespace-nowrap">
              Our repair promise
            </span>
          </div>
        </div>
        <div
          data-pinwren-anchor="demo-hero-image"
          role="img"
          aria-label="A hiker on a ridge at sunset"
          className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-[linear-gradient(160deg,#f3c58f_0%,#e0895a_40%,#7d5a8c_100%)]"
        >
          <svg
            viewBox="0 0 400 300"
            className="absolute inset-0 size-full"
            aria-hidden
            preserveAspectRatio="none"
          >
            <path
              d="M0 220 L90 150 L150 190 L230 110 L300 170 L400 120 L400 300 L0 300 Z"
              fill="#3b2f3f"
              opacity="0.55"
            />
            <path
              d="M0 250 L70 210 L160 240 L250 180 L330 230 L400 200 L400 300 L0 300 Z"
              fill="#2b2230"
              opacity="0.8"
            />
            <circle cx="300" cy="80" r="26" fill="#fde7c4" opacity="0.9" />
          </svg>
        </div>
      </section>

      <section
        id="demo-products"
        aria-label="Products"
        className="border-t border-[#e7e1d8] px-5 py-10 sm:px-8"
      >
        <h3 className="font-serif text-2xl font-semibold">Bestsellers</h3>
        <div className="mt-6 grid gap-5 sm:grid-cols-3">
          {PRODUCTS.map((p) => (
            <article
              key={p.id}
              data-pinwren-anchor={p.id}
              className="rounded-xl border border-[#e7e1d8] bg-white p-3"
            >
              <div className={`aspect-[4/3] rounded-lg bg-gradient-to-br ${p.tone}`} />
              <h4 className="mt-3 font-medium">{p.name}</h4>
              <p className="text-sm text-[#5d554b]">{p.price}</p>
              <button
                type="button"
                onClick={() => void addToCart(p.name)}
                className="mt-3 w-full rounded-full border border-[#2b2620] py-1.5 text-sm font-medium transition-colors hover:bg-[#2b2620] hover:text-[#fbf8f3] focus-visible:ring-2 focus-visible:ring-[#8a5a2b] focus-visible:outline-none"
              >
                Add to cart
              </button>
            </article>
          ))}
        </div>
        {cartError && (
          <p role="alert" className="mt-4 rounded-lg bg-[#fbe9e4] px-3 py-2 text-sm text-[#8f2d1c]">
            {cartError}
          </p>
        )}
      </section>

      <section className="border-t border-[#e7e1d8] px-5 py-10 sm:px-8">
        <form
          data-pinwren-anchor="demo-newsletter"
          onSubmit={(e) => e.preventDefault()}
          className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center"
        >
          <h3 className="font-serif text-2xl font-semibold">Get trail notes</h3>
          <p className="text-sm text-[#5d554b]">One email a month: new routes, repair tips, no spam.</p>
          <div className="flex w-full max-w-sm gap-2">
            <label htmlFor="demo-email" className="sr-only">
              Email address
            </label>
            <input
              id="demo-email"
              type="email"
              placeholder="you@example.com"
              autoComplete="off"
              className="min-w-0 flex-1 rounded-full border border-[#cfc5b8] bg-white px-4 py-2 text-sm placeholder:text-[#7a7064] focus-visible:ring-2 focus-visible:ring-[#8a5a2b] focus-visible:outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-[#2b2620] px-4 py-2 text-sm font-medium text-[#fbf8f3]"
            >
              Sign up
            </button>
          </div>
        </form>
      </section>
      <footer className="border-t border-[#e7e1d8] px-5 py-5 text-xs text-[#5d554b] sm:px-8">
        Harbor &amp; Pine is a made-up store for the Pinwren demo.
      </footer>
    </div>
  );
}
