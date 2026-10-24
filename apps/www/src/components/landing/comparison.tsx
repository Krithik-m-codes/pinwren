import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// From the README comparison and blueprint 00/13 (vendors' public docs and pricing pages, October 2026).
// "Partial" = exists with notable limits or only on some plans.
const PRODUCTS = ["Pinwren", "Marker.io", "BugHerd", "Userback", "BugPin", "SitePing"] as const;

type Cell = true | false | string;
const ROWS: { label: string; cells: Cell[] }[] = [
  { label: "Open source", cells: ["AGPL-3.0, widget MIT", false, false, false, "Open core, AGPL", "MIT"] },
  { label: "Self-hosted", cells: ["Docker + Postgres", false, false, false, true, "Inside your own app"] },
  { label: "Comments pinned to page elements", cells: [true, false, true, "Partial", false, true] },
  {
    label: "Annotated screenshot bug reports",
    cells: [true, true, true, true, true, "Partial (area capture)"],
  },
  { label: "Console and network capture", cells: [true, true, "Partial", true, true, true] },
  { label: "Session replay", cells: ["New in 0.1", true, false, true, false, false] },
  { label: "Triage dashboard", cells: ["Built in", true, true, true, true, "React component"] },
  { label: "GitHub / GitLab issue sync", cells: ["Two-way", true, true, true, "GitHub", true] },
  {
    label: "Jira, Linear and other trackers",
    cells: ["Linear; Jira (Enterprise)", true, true, true, "Via webhooks", false],
  },
  {
    label: "Price (approx.)",
    cells: ["Free to self-host", "~$39–199/mo", "~$50–150/mo", "~$7–23/seat", "Free to self-host", "Free"],
  },
];

const SOURCES = [
  {
    label: "Feedbucket: Marker.io alternatives",
    href: "https://feedbucket.app/alternatives/marker-io-alternatives",
  },
  {
    label: "Feedbucket: BugHerd alternatives",
    href: "https://feedbucket.app/alternatives/bugherd-alternatives",
  },
  {
    label: "Feedbucket: Userback alternatives",
    href: "https://feedbucket.app/alternatives/userback-alternatives",
  },
  { label: "BugPin docs", href: "https://docs.bugpin.io/" },
  { label: "SitePing on GitHub", href: "https://github.com/NeosiaNexus/SitePing" },
];

function Value({ v, highlight }: { v: Cell; highlight: boolean }) {
  if (v === true)
    return (
      <>
        <Check className={cn("mx-auto size-4", highlight ? "text-brand" : "text-success")} aria-hidden />
        <span className="sr-only">Yes</span>
      </>
    );
  if (v === false)
    return (
      <>
        <Minus className="mx-auto size-4 text-muted-foreground/60" aria-hidden />
        <span className="sr-only">No</span>
      </>
    );
  return <span className={cn("text-xs", highlight ? "font-medium" : "text-muted-foreground")}>{v}</span>;
}

export function Comparison() {
  return (
    <section id="compare" className="scroll-mt-20 border-b py-24">
      <div className="container-page">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold text-brand">Compare</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Why pay per seat for features you can run yourself?
          </h2>
          <p className="mt-4 text-pretty text-muted-foreground">
            An honest look at where Pinwren fits. Every product here is good at something — if a cell is
            wrong,{" "}
            <a
              href="https://github.com/Krithik-m-codes/pinwren/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              tell us
            </a>
            .
          </p>
        </div>
        <div className="relative mt-12 overflow-x-auto rounded-2xl border bg-card shadow-xs">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">
              Pinwren compared with Marker.io, BugHerd, Userback, BugPin and SitePing
            </caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className="w-56 px-4 py-3 text-left font-medium text-muted-foreground">
                  Feature
                </th>
                {PRODUCTS.map((p, i) => (
                  <th
                    key={p}
                    scope="col"
                    className={cn(
                      "px-3 py-3 text-center font-semibold",
                      i === 0 && "bg-brand-soft text-brand-ink",
                    )}
                  >
                    {p}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {row.label}
                  </th>
                  {row.cells.map((c, i) => (
                    <td
                      key={PRODUCTS[i]}
                      className={cn("px-3 py-3 text-center", i === 0 && "bg-brand-soft/60")}
                    >
                      <Value v={c} highlight={i === 0} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mx-auto mt-5 max-w-3xl text-center text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            Based on each product’s public documentation and pricing as of October 2026. Prices are
            approximate list prices and change often. Sources
          </summary>
          <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
            {SOURCES.map((s) => (
              <li key={s.href}>
                <a
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
