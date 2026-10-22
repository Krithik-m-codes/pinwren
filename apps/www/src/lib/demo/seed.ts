import { randomUUID } from "node:crypto";
import type { AnchorBundle } from "@pinwren/core";
import type { DemoItem } from "./store";

// What every new demo visitor finds on /demo: a short client review round already in progress. Anchors use
// the sample page's `data-pinwren-anchor` attributes (the widget's most reliable strategy), so the pins land
// on the right elements at any viewport size.

export const DEMO_PATH = "/demo";

function anchor(
  id: string,
  tag: string,
  text: string,
  pin: { xPct: number; yPct: number; wPct?: number; hPct?: number },
): AnchorBundle {
  return {
    v: 1,
    attrs: { pinwrenAnchor: id },
    css: `[data-pinwren-anchor="${id}"]`,
    xpath: "",
    text: { content: text, prefix: "", suffix: "" },
    tag,
    structure: { depth: 8, siblingIndex: 0, childTagsHash: "" },
    rect: { x: 0, y: 0, w: 0, h: 0, vw: 1440, vh: 900, scrollY: 0 },
    pin,
  };
}

type Seed = Pick<DemoItem, "kind" | "status" | "priority" | "title" | "body"> & {
  anchor: AnchorBundle;
  reporter: string;
  minutesAgo: number;
  replies?: { body: string; authorName: string; team: boolean; minutesAgo: number }[];
};

const SEEDS: Seed[] = [
  {
    kind: "comment",
    status: "open",
    priority: "medium",
    title: null,
    body: "Can we try a shorter headline? On my laptop this wraps onto three lines.",
    anchor: anchor("demo-hero-title", "h1", "Gear for the long way round", {
      xPct: 2,
      yPct: 4,
      wPct: 70,
      hPct: 92,
    }),
    reporter: "Maya Okafor",
    minutesAgo: 95,
    replies: [
      {
        body: "Good catch — we'll test “Built for the long way round” next round.",
        authorName: "Sam (Studio)",
        team: true,
        minutesAgo: 80,
      },
    ],
  },
  {
    kind: "comment",
    status: "open",
    priority: "low",
    title: null,
    body: "Please swap this for the autumn shot from the shoot — this one feels too summery for the launch.",
    anchor: anchor("demo-hero-image", "div", "", { xPct: 18, yPct: 20, wPct: 62, hPct: 55 }),
    reporter: "Maya Okafor",
    minutesAgo: 70,
  },
  {
    kind: "bug",
    status: "in_progress",
    priority: "high",
    title: "Price flickers to $0.00",
    body: "When I switch the currency to EUR the price on this card shows $0.00 for a second.",
    anchor: anchor("demo-product-pack", "article", "Ridgeline 38L pack", {
      xPct: 6,
      yPct: 62,
      wPct: 60,
      hPct: 20,
    }),
    reporter: "Leo Brandt",
    minutesAgo: 42,
  },
  {
    kind: "question",
    status: "open",
    priority: "none",
    title: null,
    body: "Do we need a short privacy note under the sign-up field?",
    anchor: anchor("demo-newsletter", "form", "Get trail notes", { xPct: 50, yPct: 70 }),
    reporter: "Priya Shah",
    minutesAgo: 18,
  },
];

export function seedFor(): DemoItem[] {
  const t = Date.now();
  const at = (m: number) => new Date(t - m * 60_000).toISOString();
  return SEEDS.map((s, i) => ({
    id: randomUUID(),
    number: i + 1,
    clientId: randomUUID(),
    kind: s.kind,
    status: s.status,
    priority: s.priority,
    title: s.title,
    body: s.body,
    anchor: s.anchor,
    page: { url: `https://demo.invalid${DEMO_PATH}`, path: DEMO_PATH, title: "Harbor & Pine — outdoor gear" },
    environment: null,
    diagnostics: { console: 0, network: 0, errors: [], failed: [] },
    reporter: { name: s.reporter, email: null },
    assets: [],
    replies: (s.replies ?? []).map((r) => ({
      id: randomUUID(),
      body: r.body,
      createdAt: at(r.minutesAgo),
      authorName: r.authorName,
      team: r.team,
    })),
    createdAt: at(s.minutesAgo),
    updatedAt: at(s.minutesAgo),
    reporterTokenHash: null,
    seeded: true,
  }));
}
