import { gunzipSync } from "node:zlib";

// Session replay (F-007): the widget uploads a gzip of a JSON array of rrweb events. The dashboard
// plays it; here we only read it to describe what the reporter did, for `get_reproduction_context`.
// Everything in a replay comes from the visitor's browser, so it is parsed defensively and only small,
// truncated strings are taken out of it.

export const GZIP_MAGIC = [0x1f, 0x8b] as const;
const MAX_INFLATED = 64 * 1024 * 1024;
const MAX_STEPS = 80;

export type ReplayStep = { at: number; kind: string; text: string };

// rrweb's numeric enums (rrweb-snapshot / @rrweb/types), copied as plain numbers so no dependency is needed.
const EVENT = { FullSnapshot: 2, IncrementalSnapshot: 3, Meta: 4, Custom: 5 } as const;
const SOURCE = { Mutation: 0, MouseInteraction: 2, Scroll: 3, ViewportResize: 4, Input: 5 } as const;
const MOUSE = { Click: 2, DblClick: 4, ContextMenu: 3, TouchEnd: 9 } as const;
const NODE = { Element: 2, Text: 3 } as const;

type SNode = {
  id?: unknown;
  type?: unknown;
  tagName?: unknown;
  attributes?: unknown;
  childNodes?: unknown;
  textContent?: unknown;
};
type ElementInfo = { tag: string; attrs: Record<string, string>; text: string };

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown, n = 80) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Inflate and parse a replay file. null when it isn't a gzip'd JSON array of events. */
export function readReplay(bytes: Uint8Array): unknown[] | null {
  if (bytes[0] !== GZIP_MAGIC[0] || bytes[1] !== GZIP_MAGIC[1]) return null;
  try {
    const json = gunzipSync(bytes, { maxOutputLength: MAX_INFLATED }).toString("utf8");
    const events = JSON.parse(json) as unknown;
    return Array.isArray(events) ? events : null;
  } catch {
    return null;
  }
}

function indexNodes(root: unknown, into: Map<number, ElementInfo>, depth = 0): string {
  // Returns the node's visible text (for labelling its ancestors); records elements by id.
  if (depth > 200) return "";
  const n = obj(root) as SNode;
  if (n.type === NODE.Text) return str(n.textContent, 200);
  const children = Array.isArray(n.childNodes) ? (n.childNodes as unknown[]) : [];
  let text = "";
  for (const c of children) {
    if (text.length < 120) text = `${text} ${indexNodes(c, into, depth + 1)}`.trim();
    else indexNodes(c, into, depth + 1);
  }
  if (n.type === NODE.Element && typeof n.id === "number" && typeof n.tagName === "string") {
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj(n.attributes))) {
      if (["id", "name", "type", "role", "aria-label", "placeholder", "href", "title", "alt"].includes(k)) {
        attrs[k] = str(v, 120);
      }
    }
    into.set(n.id, { tag: n.tagName.toLowerCase().slice(0, 20), attrs, text: text.slice(0, 120) });
  }
  return text;
}

/** `button "Pay now"`, `input[name=email]`, `a "Pricing" (/pricing)` … */
export function describeElement(el: ElementInfo | undefined): string {
  if (!el) return "an element";
  const a = el.attrs;
  let s = el.tag;
  if (a.id) s += `#${a.id.slice(0, 40)}`;
  else if (a.name) s += `[name=${a.name.slice(0, 40)}]`;
  const label = a["aria-label"] || el.text || a.title || a.alt || a.placeholder || "";
  if (label) s += ` "${label.slice(0, 60)}"`;
  if (el.tag === "a" && a.href) s += ` (${a.href.slice(0, 80)})`;
  return s;
}

/**
 * Ordered, human-readable steps: navigation, clicks, typing (never the text — inputs are masked at
 * capture anyway), scrolling and resizes. Consecutive repeats are folded into one step.
 */
export function replaySteps(events: unknown[]): ReplayStep[] {
  const nodes = new Map<number, ElementInfo>();
  const steps: ReplayStep[] = [];
  let lastHref = "";
  const push = (at: number, kind: string, text: string) => {
    const prev = steps.at(-1);
    if (prev?.kind === kind && prev.text === text) return;
    if (prev && kind === "scroll" && prev.kind === "scroll") {
      steps[steps.length - 1] = { at, kind, text };
      return;
    }
    steps.push({ at, kind, text });
  };
  for (const raw of events) {
    const e = obj(raw);
    const at = typeof e.timestamp === "number" ? e.timestamp : 0;
    const data = obj(e.data);
    if (e.type === EVENT.Meta) {
      const href = str(data.href, 500);
      if (href && href !== lastHref) {
        push(at, "navigate", `${lastHref ? "Navigated to" : "Opened"} ${href}`);
        lastHref = href;
      }
      if (typeof data.width === "number" && typeof data.height === "number" && steps.length <= 1) {
        push(at, "viewport", `Viewport ${data.width}×${data.height}`);
      }
    } else if (e.type === EVENT.FullSnapshot) {
      indexNodes(data.node, nodes);
    } else if (e.type === EVENT.IncrementalSnapshot) {
      const id = typeof data.id === "number" ? data.id : -1;
      switch (data.source) {
        case SOURCE.Mutation:
          for (const add of Array.isArray(data.adds) ? (data.adds as unknown[]).slice(0, 500) : []) {
            indexNodes(obj(add).node, nodes);
          }
          break;
        case SOURCE.MouseInteraction:
          if (data.type === MOUSE.Click || data.type === MOUSE.TouchEnd) {
            push(at, "click", `Clicked ${describeElement(nodes.get(id))}`);
          } else if (data.type === MOUSE.DblClick) {
            push(at, "click", `Double-clicked ${describeElement(nodes.get(id))}`);
          } else if (data.type === MOUSE.ContextMenu) {
            push(at, "click", `Right-clicked ${describeElement(nodes.get(id))}`);
          }
          break;
        case SOURCE.Input:
          push(at, "input", `Typed into ${describeElement(nodes.get(id))}`);
          break;
        case SOURCE.Scroll:
          if (typeof data.y === "number") push(at, "scroll", `Scrolled to y=${Math.round(data.y)}`);
          break;
        case SOURCE.ViewportResize:
          if (typeof data.width === "number" && typeof data.height === "number") {
            push(at, "viewport", `Resized the window to ${data.width}×${data.height}`);
          }
          break;
        default:
          break;
      }
    } else if (e.type === EVENT.Custom) {
      const tag = str(data.tag, 60);
      if (tag) push(at, "custom", `Event “${tag}”`);
    }
  }
  return steps.slice(-MAX_STEPS);
}
