import { createHmac } from "node:crypto";
import type { OutboundFetch } from "../../outbound/safe-fetch";
import { safeEqualStr } from "../../crypto";
import { trackerClient } from "../sdk/http";
import {
  type AccessResult,
  type InboundEvent,
  type IssueRef,
  type IssueSource,
  type NewIssue,
  type TrackerAdapter,
  type TrackerConfig,
  TrackerError,
  type WebhookAdapter,
} from "../sdk/types";
import { asRecord, chunkText, str } from "../sdk/util";

// Notion (ADR 0029): a database is the tracker — one page per feedback item, with an internal-integration
// secret. The status is a Status, Select or Checkbox property; priority an optional Select / Status
// property. Notion's webhook subscription is created by hand in the integration's settings; Pinwren
// captures the one-time verification token it posts and uses it to verify every later delivery.

export const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

const call = trackerClient({
  name: "Notion",
  base: () => NOTION_API_URL,
  headers: (cfg) => ({
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${cfg.token}`,
    "notion-version": NOTION_VERSION,
  }),
  hint: (_cfg, status) =>
    status === 401
      ? " (check the integration secret)"
      : status === 403 || status === 404
        ? " (share the database with the integration: ••• › Connections)"
        : "",
  retries: 2,
});

const settingsOf = (cfg: TrackerConfig) => cfg.settings ?? {};
const PRIORITY_KEY: Record<string, string> = {
  low: "priorityLow",
  medium: "priorityMedium",
  high: "priorityHigh",
  urgent: "priorityUrgent",
};

/** Notion ids come with or without dashes; links compare the dashed, lower-case form. */
export function notionId(id: string): string {
  const h = id.replaceAll("-", "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(h)
    ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
    : id;
}

type Property = { id?: string; name: string; type: string; multi_select?: unknown };
type Schema = { name: string; props: Property[] };

async function schema(cfg: TrackerConfig, f: OutboundFetch): Promise<Schema> {
  const d = await call<{ title?: { plain_text?: string }[]; properties?: Record<string, Property> }>(
    cfg,
    "GET",
    `/databases/${encodeURIComponent(cfg.repo)}`,
    undefined,
    f,
  );
  const props = Object.entries(d.properties ?? {}).map(([name, p]) => ({ ...p, name }));
  const title = (d.title ?? []).map((t) => t.plain_text ?? "").join("");
  return { name: title || cfg.repo, props };
}

const titleProp = (s: Schema) => s.props.find((p) => p.type === "title");

/** The status property: the configured one, else the database's first Status property. */
function statusProp(cfg: TrackerConfig, s: Schema): Property | undefined {
  const name = settingsOf(cfg).statusProperty;
  if (name) return s.props.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return s.props.find((p) => p.type === "status");
}

const openValue = (cfg: TrackerConfig) => settingsOf(cfg).openValue ?? "Not started";
const closedValue = (cfg: TrackerConfig) => settingsOf(cfg).closedValue ?? "Done";

/** The property value that puts a page in the open or closed state, by the property's type. */
function statusValue(cfg: TrackerConfig, p: Property, state: "open" | "closed"): unknown {
  const value = state === "closed" ? closedValue(cfg) : openValue(cfg);
  if (p.type === "checkbox") return { checkbox: state === "closed" };
  if (p.type === "select") return { select: { name: value } };
  if (p.type === "status") return { status: { name: value } };
  throw new TrackerError(
    `Notion property "${p.name}" is a ${p.type}: use a Status, Select or Checkbox`,
    null,
  );
}

const text = (content: string) => ({ type: "text", text: { content } });
const richText = (content: string) => chunkText(content, 2000).map(text);

/** Page content from the structured source: the quote, the facts and a link to the item. Plain text only. */
function blocks(issue: NewIssue): object[] {
  const s: IssueSource | undefined = issue.source;
  const paragraph = (content: string) => ({
    object: "block",
    type: "paragraph",
    paragraph: { rich_text: richText(content) },
  });
  if (!s) return issue.body.split(/\r?\n/).slice(0, 90).map(paragraph);
  return [
    ...s.quote
      .split(/\r?\n/)
      .slice(0, 60)
      .map((l) => ({ object: "block", type: "quote", quote: { rich_text: richText(l) } })),
    ...s.facts.map(([k, v]) => ({
      object: "block",
      type: "bulleted_list_item",
      bulleted_list_item: { rich_text: [text(`${k}: ${v}`.slice(0, 2000))] },
    })),
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [
          { type: "text", text: { content: `Open #${s.number} in ${s.productName}`, link: { url: s.link } } },
          text(" — screenshot, console and network details are there (sign-in required)."),
        ],
      },
    },
  ];
}

function pageRef(p: { id?: unknown; url?: unknown }): IssueRef {
  const id = str(p.id);
  const url = str(p.url);
  if (!id || !url || !/^https?:\/\//.test(url)) throw new TrackerError("Notion did not return a page", null);
  return { number: null, url, externalId: notionId(id) };
}

/** Is a page's status property in the closed state? Reads the property the way Notion returns it. */
function pageState(cfg: TrackerConfig, props: Record<string, unknown>): InboundEvent["state"] | null {
  const name = settingsOf(cfg).statusProperty;
  const entry = name
    ? Object.entries(props).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1]
    : Object.values(props).find((p) => asRecord(p).type === "status");
  const p = asRecord(entry);
  if (p.type === "checkbox") return p.checkbox === true ? "closed" : "open";
  if (p.type === "status" || p.type === "select") {
    const value = str(asRecord(p[p.type as string]).name);
    if (!value) return null;
    return value.toLowerCase() === closedValue(cfg).toLowerCase() ? "closed" : "open";
  }
  return null;
}

const webhooks: WebhookAdapter = {
  mode: "handshake",
  /** The one-time `{ "verification_token": "…" }` Notion posts when the subscription is created. */
  handshake(req) {
    const token = req.body.verification_token;
    return typeof token === "string" && token.length >= 8 && token.length <= 200 ? { secret: token } : null;
  },
  /** `X-Notion-Signature`: `sha256=` + hex HMAC-SHA256 of the raw body, keyed by the verification token. */
  verify(secret, req) {
    const sig = req.headers.get("x-notion-signature") ?? "";
    return (
      /^sha256=[0-9a-f]{64}$/.test(sig) &&
      safeEqualStr(`sha256=${createHmac("sha256", secret).update(req.raw).digest("hex")}`, sig)
    );
  },
  deliveryId: (req) => str(req.body.id),
  async events(cfg, req, f) {
    if (req.body.type !== "page.properties_updated") return [];
    const entity = asRecord(req.body.entity);
    const id = str(entity.id);
    if (!id || entity.type !== "page") return [];
    const parent = str(asRecord(asRecord(req.body.data).parent).id);
    if (parent && notionId(parent) !== notionId(cfg.repo)) return [];
    const page = await call<{ properties?: Record<string, unknown> }>(
      cfg,
      "GET",
      `/pages/${encodeURIComponent(id)}`,
      undefined,
      f,
    );
    const state = pageState(cfg, page.properties ?? {});
    return state ? [{ number: null, externalId: notionId(id), state }] : [];
  },
};

export const notion: TrackerAdapter = {
  provider: "notion",
  name: "Notion",
  async createIssue(cfg, issue, f) {
    const s = await schema(cfg, f);
    const title = titleProp(s);
    if (!title) throw new TrackerError("The Notion database has no title property", null);
    const properties: Record<string, unknown> = { [title.name]: { title: richText(issue.title) } };
    const status = statusProp(cfg, s);
    if (status) properties[status.name] = statusValue(cfg, status, "open");
    const pName = settingsOf(cfg).priorityProperty;
    const pValue = issue.priority ? settingsOf(cfg)[PRIORITY_KEY[issue.priority] ?? ""] : undefined;
    const prio = pName ? s.props.find((p) => p.name.toLowerCase() === pName.toLowerCase()) : undefined;
    if (prio && pValue) {
      if (prio.type === "select") properties[prio.name] = { select: { name: pValue } };
      else if (prio.type === "status") properties[prio.name] = { status: { name: pValue } };
    }
    // Labels go to a multi-select called Labels or Tags, when the database has one.
    const labels = s.props.find((p) => p.type === "multi_select" && /^(labels?|tags?)$/i.test(p.name));
    if (labels && issue.labels.length) {
      properties[labels.name] = {
        multi_select: issue.labels.map((name) => ({ name: name.replaceAll(",", " ") })),
      };
    }
    const p = await call<{ id?: unknown; url?: unknown }>(
      cfg,
      "POST",
      "/pages",
      { parent: { database_id: cfg.repo }, properties, children: blocks(issue).slice(0, 100) },
      f,
    );
    return pageRef(p);
  },
  async setIssueState(cfg, target, state, f) {
    if (!target.externalId) throw new TrackerError("Notion page id missing", null);
    const s = await schema(cfg, f);
    const status = statusProp(cfg, s);
    if (!status) {
      throw new TrackerError(
        "The Notion database has no status property — name one in the settings (statusProperty)",
        null,
      );
    }
    await call(
      cfg,
      "PATCH",
      `/pages/${encodeURIComponent(target.externalId)}`,
      { properties: { [status.name]: statusValue(cfg, status, state) } },
      f,
    );
  },
  async checkAccess(cfg, f): Promise<AccessResult> {
    try {
      const s = await schema(cfg, f);
      if (!titleProp(s)) return { ok: false, message: "The database has no title property" };
      const configured = settingsOf(cfg).statusProperty;
      const status = statusProp(cfg, s);
      if (configured && !status) {
        return { ok: false, message: `The database has no property called "${configured}"` };
      }
      if (status && !["status", "select", "checkbox"].includes(status.type)) {
        return {
          ok: false,
          message: `"${status.name}" is a ${status.type}: use a Status, Select or Checkbox`,
        };
      }
      return { ok: true, name: s.name };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : "failed" };
    }
  },
  async findExisting(cfg, issue, f) {
    const s = await schema(cfg, f);
    const title = titleProp(s);
    if (!title) return null;
    const r = await call<{ results?: { id?: unknown; url?: unknown }[] }>(
      cfg,
      "POST",
      `/databases/${encodeURIComponent(cfg.repo)}/query`,
      { filter: { property: title.name, title: { equals: issue.title } }, page_size: 1 },
      f,
    );
    const hit = r.results?.[0];
    return hit ? pageRef(hit) : null;
  },
  webhooks,
};
