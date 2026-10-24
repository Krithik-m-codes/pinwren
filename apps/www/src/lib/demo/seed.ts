import type { AnchorBundle } from "@pinwren/core";
import type { DemoItem } from "./store";

// What every new demo visitor finds on /demo: a short client review round already in progress on the sample
// agency site. Anchors use the page's `data-pinwren-anchor` attributes (the widget's most reliable strategy),
// so the markers land on the right elements at any viewport size. Shared by the server sandbox (store.ts) and
// the playground's "Local" mode, which keeps its copy in the browser — so no Node-only imports here.

export const DEMO_PATH = "/demo";
export const DEMO_PAGE_TITLE = "Brightline Studio — digital product agency";

const uuid = () => globalThis.crypto.randomUUID();

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

const HERO = "We craft digital experiences that matter.";

const SEEDS: Seed[] = [
  {
    kind: "bug",
    status: "open",
    priority: "high",
    title: null,
    body: "The email field in the contact form won't let me type anything — is it disabled on purpose?",
    anchor: anchor("demo-contact-email", "label", "Work email", { xPct: 92, yPct: 70 }),
    reporter: "Leo Brandt",
    minutesAgo: 27,
  },
  {
    kind: "idea",
    status: "open",
    priority: "medium",
    title: null,
    body: "Can we try “digital products that ship.” instead of “that matter.”? Feels more us.",
    anchor: anchor("demo-hero-title", "h1", HERO, { xPct: 78, yPct: 62 }),
    reporter: "Maya Okafor",
    minutesAgo: 120,
    replies: [
      {
        body: "Love it — we'll put both in front of the client on Thursday.",
        authorName: "Sam (Brightline)",
        team: true,
        minutesAgo: 95,
      },
    ],
  },
  {
    kind: "comment",
    status: "open",
    priority: "none",
    title: null,
    body: "No changes — just wanted to say this is looking great. Huge step up from the old site!",
    anchor: anchor("demo-hero-title", "h1", HERO, { xPct: 0, yPct: 0, wPct: 100, hPct: 100 }),
    reporter: "Priya Shah",
    minutesAgo: 180,
  },
  {
    kind: "bug",
    status: "open",
    priority: "medium",
    title: null,
    body: "Clicking the Vertex SaaS card does nothing — shouldn't it open the case study page?",
    anchor: anchor("demo-work-vertex", "article", "Vertex SaaS", { xPct: 50, yPct: 40 }),
    reporter: "Leo Brandt",
    minutesAgo: 240,
  },
  {
    kind: "question",
    status: "resolved",
    priority: "low",
    title: null,
    body: "Are these numbers live, or placeholders until launch?",
    anchor: anchor("demo-stats", "section", "120+ products shipped", { xPct: 12, yPct: 30 }),
    reporter: "Maya Okafor",
    minutesAgo: 320,
    replies: [
      {
        body: "Real numbers from our 2026 report — signed off by the client.",
        authorName: "Sam (Brightline)",
        team: true,
        minutesAgo: 300,
      },
    ],
  },
  {
    kind: "idea",
    status: "resolved",
    priority: "low",
    title: null,
    body: "The services cards would scan faster with a small icon each.",
    anchor: anchor("demo-services", "div", "Product design", { xPct: 3, yPct: 6, wPct: 94, hPct: 88 }),
    reporter: "Priya Shah",
    minutesAgo: 420,
  },
];

export function seedFor(): DemoItem[] {
  const t = Date.now();
  const at = (m: number) => new Date(t - m * 60_000).toISOString();
  return SEEDS.map((s, i) => ({
    id: uuid(),
    number: i + 1,
    clientId: uuid(),
    kind: s.kind,
    status: s.status,
    priority: s.priority,
    title: s.title,
    body: s.body,
    anchor: s.anchor,
    page: { url: `https://demo.invalid${DEMO_PATH}`, path: DEMO_PATH, title: DEMO_PAGE_TITLE },
    environment: null,
    diagnostics: { console: 0, network: 0, errors: [], failed: [] },
    reporter: { name: s.reporter, email: null },
    assets: [],
    replies: (s.replies ?? []).map((r) => ({
      id: uuid(),
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
