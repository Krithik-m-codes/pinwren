import { kindLabel, SLACK_ACTIONS, SLACK_CALLBACKS, SLACK_STATUS_CHOICES } from "@pinwren/core";
import { statusLabel } from "../email/templates";
import { httpLink, plain, slackEscape, truncate, type FeedbackPayload } from "../webhooks/format";

// Block Kit for the feedback card and the capture modal. Everything that came from a visitor (title, text,
// names, page URL, label names) is entity-escaped or placed in plain_text, exactly like the incoming-webhook
// formatter, so it can never form a Slack link or mention.

type Option = { text: { type: "plain_text"; text: string; emoji: false }; value: string };
const option = (text: string, value: string): Option => ({
  text: { type: "plain_text", text: truncate(text, 75), emoji: false },
  value,
});

/** Slack allows 100 options in a static select; the card shows the first 100 labels of the project. */
const MAX_OPTIONS = 100;

export const cardBlockId = (feedbackId: string) => `pw:${feedbackId}`;
export const feedbackIdOfBlock = (blockId: unknown): string | null => {
  if (typeof blockId !== "string" || !blockId.startsWith("pw:")) return null;
  const id = blockId.slice(3);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
};

export type CardInput = {
  feedback: FeedbackPayload;
  /** "New feedback", "Status changed → resolved": the card's first line. */
  headline: string;
  assigneeNames: string[];
  labelNames: string[];
  /** Labels the "Add label" menu offers (the item's project). */
  projectLabels: { id: string; name: string }[];
  /** Hide the buttons (the item is in the trash). */
  readOnly?: boolean;
};

export function feedbackCard(c: CardInput): { text: string; blocks: object[] } {
  const f = c.feedback;
  const ref = `${f.projectName} #${f.number}`;
  const link = httpLink(f.url);
  const what = f.title?.trim() || truncate(f.body.replace(/\s+/g, " "), 80);
  const context = [
    `${kindLabel(f.kind)} · ${statusLabel(f.status)} · ${f.priority}`,
    c.assigneeNames.length ? `assigned to ${c.assigneeNames.join(", ")}` : "unassigned",
    c.labelNames.length ? `labels: ${c.labelNames.join(", ")}` : null,
    f.reporterName ? `from ${f.reporterName}` : null,
    f.pageUrl,
  ].filter(Boolean) as string[];

  const blocks: object[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${slackEscape(c.headline)}* · ${link ? `<${link}|${slackEscape(ref)}>` : slackEscape(ref)}`,
      },
    },
    ...(f.title ? [{ type: "section", text: plain(truncate(f.title, 300)) }] : []),
    { type: "section", text: plain(truncate(f.body || " ", 1200)) },
    { type: "context", elements: [plain(truncate(context.join(" · "), 1900))] },
  ];

  if (!c.readOnly) {
    const status = SLACK_STATUS_CHOICES.map((s) => option(statusLabel(s), s));
    const current = status.find((o) => o.value === f.status);
    const labels = c.projectLabels.slice(0, MAX_OPTIONS).map((l) => option(l.name, l.id));
    blocks.push({
      type: "actions",
      block_id: cardBlockId(f.id),
      elements: [
        {
          type: "button",
          action_id: SLACK_ACTIONS.assignMe,
          text: { type: "plain_text", text: "Assign to me", emoji: false },
          value: f.id,
        },
        {
          type: "static_select",
          action_id: SLACK_ACTIONS.setStatus,
          placeholder: { type: "plain_text", text: "Set status", emoji: false },
          options: status,
          ...(current ? { initial_option: current } : {}),
        },
        ...(labels.length
          ? [
              {
                type: "static_select",
                action_id: SLACK_ACTIONS.addLabel,
                placeholder: { type: "plain_text", text: "Add label", emoji: false },
                options: labels,
              },
            ]
          : []),
        ...(link
          ? [
              {
                type: "button",
                action_id: SLACK_ACTIONS.open,
                text: { type: "plain_text", text: "Open", emoji: false },
                url: link,
              },
            ]
          : []),
      ],
    });
  }
  return { text: slackEscape(`${c.headline}: ${ref} ${what}`), blocks };
}

export type ModalInput = {
  projects: { id: string; name: string }[];
  kinds: readonly string[];
  initial: { title?: string; body?: string; projectId?: string | undefined; kind?: string };
  /** Round-tripped through Slack to the submission (channel and message ts: the permalink is rebuilt from them). */
  metadata: ModalMetadata;
};

export type ModalMetadata = { c?: string; ts?: string };

export const MODAL_BLOCKS = { title: "title", body: "body", project: "project", kind: "kind" } as const;
export const MODAL_ACTION = "v";

export function feedbackModal(m: ModalInput): object {
  const project = m.projects.find((p) => p.id === m.initial.projectId) ?? m.projects[0];
  const projects = m.projects.slice(0, MAX_OPTIONS).map((p) => option(p.name, p.id));
  const kinds = m.kinds.map((k) => option(kindLabel(k), k));
  const initialKind = kinds.find((k) => k.value === (m.initial.kind ?? "bug")) ?? kinds[0];
  const input = (
    block: string,
    label: string,
    element: object,
    optional = false,
  ): Record<string, unknown> => ({
    type: "input",
    block_id: block,
    optional,
    label: { type: "plain_text", text: label, emoji: false },
    element: { action_id: MODAL_ACTION, ...element },
  });
  return {
    type: "modal",
    callback_id: SLACK_CALLBACKS.modal,
    private_metadata: JSON.stringify(m.metadata),
    title: { type: "plain_text", text: "New feedback", emoji: false },
    submit: { type: "plain_text", text: "Create", emoji: false },
    close: { type: "plain_text", text: "Cancel", emoji: false },
    blocks: [
      input(
        MODAL_BLOCKS.title,
        "Title",
        {
          type: "plain_text_input",
          max_length: 200,
          ...(m.initial.title ? { initial_value: truncate(m.initial.title, 200) } : {}),
        },
        true,
      ),
      input(
        MODAL_BLOCKS.body,
        "Details",
        {
          type: "plain_text_input",
          multiline: true,
          max_length: 3000,
          ...(m.initial.body ? { initial_value: truncate(m.initial.body, 3000) } : {}),
        },
        true,
      ),
      input(MODAL_BLOCKS.project, "Project", {
        type: "static_select",
        options: projects,
        ...(project ? { initial_option: option(project.name, project.id) } : {}),
      }),
      input(MODAL_BLOCKS.kind, "Type", {
        type: "static_select",
        options: kinds,
        ...(initialKind ? { initial_option: initialKind } : {}),
      }),
      ...(m.metadata.ts
        ? [
            {
              type: "context",
              elements: [{ type: "mrkdwn", text: "The Slack message is linked to the new item." }],
            },
          ]
        : []),
    ],
  };
}

/** The ephemeral help for `/pinwren`. */
export const HELP_TEXT = [
  "*Pinwren in Slack*",
  "`/pinwren new [title]` opens the form to file feedback.",
  "`/pinwren link` links your Slack account to your Pinwren account.",
  "`/pinwren help` shows this message.",
  "On any message, open its menu, choose More message shortcuts, then *Create feedback from message*.",
].join("\n");
