"use client";

import {
  AUTOMATION_EVENTS,
  type AutomationAction,
  type AutomationCondition,
  type AutomationEvent,
  automationRuleCreate,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  MAX_RULE_ACTIONS,
  MAX_RULE_CONDITIONS,
  PRIORITIES,
} from "@pinwren/core";
import { Loader2, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { KIND_META, PRIORITY_META, STATUS_META } from "@/components/feedback-meta";
import { Field } from "@/components/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ProjectDetail } from "@/lib/api";
import type { Key } from "@/lib/i18n/en";
import { useT } from "@/lib/i18n/provider";
import {
  type AutomationRule,
  errorMessage,
  useCreateAutomationRuleMutation,
  useLabelsQuery,
  useMembersQuery,
  useRoundsQuery,
  useTrackersQuery,
  useUpdateAutomationRuleMutation,
  useWebhooksQuery,
} from "@/lib/store/api";

export const EVENT_LABEL = {
  feedback_created: "automation.eventCreated",
  status_changed: "automation.eventStatus",
  label_added: "automation.eventLabel",
  comment_added: "automation.eventComment",
} as const satisfies Record<AutomationEvent, Key>;

export const CONDITION_LABEL = {
  kind: "automation.fieldKind",
  priority: "automation.fieldPriority",
  pageUrl: "automation.fieldPageUrl",
  browser: "automation.fieldBrowser",
  reporterEmailDomain: "automation.fieldDomain",
  label: "automation.fieldLabel",
  hasAttachment: "automation.fieldAttachment",
  hasReplay: "automation.fieldReplay",
} as const satisfies Record<AutomationCondition["field"], Key>;

export const ACTION_LABEL = {
  assign: "automation.actionAssign",
  add_label: "automation.actionLabel",
  set_priority: "automation.actionPriority",
  set_status: "automation.actionStatus",
  add_to_round: "automation.actionRound",
  notify_webhook: "automation.actionWebhook",
  notify_email: "automation.actionEmail",
  create_issue: "automation.actionIssue",
} as const satisfies Record<AutomationAction["type"], Key>;

export const BROWSERS = ["Chrome", "Safari", "Firefox", "Edge", "Opera", "Samsung Internet"] as const;

export type Draft = {
  name: string;
  enabled: boolean;
  trigger: {
    event: AutomationEvent;
    toStatuses: (typeof FEEDBACK_STATUSES)[number][];
    labelId: string | null;
  };
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

export const emptyDraft = (): Draft => ({
  name: "",
  enabled: true,
  trigger: { event: "feedback_created", toStatuses: [], labelId: null },
  conditions: [],
  actions: [],
});

export const draftOf = (r: AutomationRule): Draft => ({
  name: r.name,
  enabled: r.enabled,
  trigger: { ...r.trigger },
  conditions: structuredClone(r.conditions),
  actions: structuredClone(r.actions),
});

/** Names and ids the pickers offer. */
type Options = {
  labels: { id: string; name: string }[];
  members: { id: string; name: string }[];
  rounds: { id: string; name: string }[];
  webhooks: { id: string; name: string }[];
  trackers: { id: string; name: string }[];
};

export function useRuleOptions(projectId: string): Options {
  const labels = useLabelsQuery(projectId);
  const members = useMembersQuery(undefined);
  const rounds = useRoundsQuery(projectId);
  const webhooks = useWebhooksQuery(undefined);
  const trackers = useTrackersQuery(projectId);
  return {
    labels: labels.data?.labels ?? [],
    members: (members.data?.members ?? []).map((m) => ({ id: m.userId ?? m.id, name: m.name })),
    rounds: (rounds.data?.rounds ?? []).filter((r) => r.status === "active"),
    webhooks: (webhooks.data?.webhooks ?? [])
      .filter((w) => w.active && (!w.projectId || w.projectId === projectId))
      .map((w) => ({ id: w.id, name: w.name ?? w.kind })),
    trackers: (trackers.data?.integrations ?? [])
      .filter((i) => i.active)
      .map((i) => ({ id: i.id, name: `${i.provider}: ${i.repo}` })),
  };
}

function defaultCondition(field: AutomationCondition["field"], o: Options): AutomationCondition {
  switch (field) {
    case "kind":
      return { field, values: ["bug"] };
    case "priority":
      return { field, values: ["high"] };
    case "pageUrl":
      return { field, pattern: "" };
    case "browser":
      return { field, values: ["Chrome"] };
    case "reporterEmailDomain":
      return { field, values: [] };
    case "label":
      return { field, labelIds: o.labels[0] ? [o.labels[0].id] : [] };
    case "hasAttachment":
    case "hasReplay":
      return { field, value: true };
  }
}

function defaultAction(type: AutomationAction["type"], o: Options): AutomationAction {
  switch (type) {
    case "assign":
      return { type, userIds: o.members[0] ? [o.members[0].id] : [], mode: "all" };
    case "add_label":
      return { type, labelId: o.labels[0]?.id ?? "" };
    case "set_priority":
      return { type, priority: "high" };
    case "set_status":
      return { type, status: "in_progress" };
    case "add_to_round":
      return { type, roundId: o.rounds[0]?.id ?? "" };
    case "notify_webhook":
      return { type, endpointId: o.webhooks[0]?.id ?? "" };
    case "notify_email":
      return { type, userIds: o.members[0] ? [o.members[0].id] : [], emails: [] };
    case "create_issue":
      return { type, integrationId: o.trackers[0]?.id ?? "" };
  }
}

/** One-of picker on the design-system Select. */
function Pick<T extends string>({
  value,
  items,
  onChange,
  label,
  placeholder,
  className,
}: {
  value: T | "";
  items: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <Select items={items} value={value || null} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" aria-label={label} className={className}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value}>
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Several-of picker: a toggle chip per option. */
function Chips<T extends string>({
  value,
  items,
  onChange,
  label,
  empty,
}: {
  value: readonly T[];
  items: { value: T; label: string }[];
  onChange: (v: T[]) => void;
  label: string;
  empty?: string;
}) {
  if (!items.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <ToggleGroup
      multiple
      aria-label={label}
      value={[...value]}
      onValueChange={(v) => onChange(v as T[])}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {items.map((i) => (
        <ToggleGroupItem key={i.value} value={i.value}>
          {i.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

const splitList = (raw: string) => raw.split(/[\s,;]+/).filter(Boolean);

function ConditionEditor({
  c,
  o,
  onChange,
}: {
  c: AutomationCondition;
  o: Options;
  onChange: (c: AutomationCondition) => void;
}) {
  const t = useT();
  const yesNo = [
    { value: "yes", label: t("automation.yes") },
    { value: "no", label: t("automation.no") },
  ];
  const [raw, setRaw] = useState(c.field === "reporterEmailDomain" ? c.values.join(", ") : "");
  switch (c.field) {
    case "kind":
      return (
        <Chips
          label={t("automation.fieldKind")}
          value={c.values}
          items={FEEDBACK_KINDS.map((k) => ({ value: k, label: t(KIND_META[k].labelKey) }))}
          onChange={(values) => onChange({ field: "kind", values })}
        />
      );
    case "priority":
      return (
        <Chips
          label={t("automation.fieldPriority")}
          value={c.values}
          items={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_META[p].labelKey) }))}
          onChange={(values) => onChange({ field: "priority", values })}
        />
      );
    case "pageUrl":
      return (
        <Input
          value={c.pattern}
          aria-label={t("automation.fieldPageUrl")}
          placeholder="/pricing, /product/:id, /docs/*"
          maxLength={500}
          onChange={(e) => onChange({ field: "pageUrl", pattern: e.target.value })}
        />
      );
    case "browser":
      return (
        <Chips
          label={t("automation.fieldBrowser")}
          value={c.values}
          items={BROWSERS.map((b) => ({ value: b, label: b }))}
          onChange={(values) => onChange({ field: "browser", values })}
        />
      );
    case "reporterEmailDomain":
      return (
        <Input
          value={raw}
          aria-label={t("automation.fieldDomain")}
          placeholder="acme.com, example.org"
          onChange={(e) => {
            setRaw(e.target.value);
            onChange({ field: "reporterEmailDomain", values: splitList(e.target.value.toLowerCase()) });
          }}
        />
      );
    case "label":
      return (
        <Chips
          label={t("automation.fieldLabel")}
          value={c.labelIds}
          items={o.labels.map((l) => ({ value: l.id, label: l.name }))}
          empty={t("automation.noLabels")}
          onChange={(labelIds) => onChange({ field: "label", labelIds })}
        />
      );
    case "hasAttachment":
    case "hasReplay":
      return (
        <Pick
          label={t(CONDITION_LABEL[c.field])}
          value={c.value ? "yes" : "no"}
          items={yesNo}
          onChange={(v) => onChange({ field: c.field, value: v === "yes" })}
        />
      );
  }
}

function ActionEditor({
  a,
  o,
  onChange,
}: {
  a: AutomationAction;
  o: Options;
  onChange: (a: AutomationAction) => void;
}) {
  const t = useT();
  const named = (list: { id: string; name: string }[]) => list.map((x) => ({ value: x.id, label: x.name }));
  const [emails, setEmails] = useState(a.type === "notify_email" ? a.emails.join(", ") : "");
  switch (a.type) {
    case "assign":
      return (
        <div className="grid gap-2">
          <Chips
            label={t("automation.actionAssign")}
            value={a.userIds}
            items={named(o.members)}
            onChange={(userIds) => onChange({ ...a, userIds })}
          />
          <Pick
            label={t("automation.assignMode")}
            value={a.mode}
            items={[
              { value: "all", label: t("automation.assignAll") },
              { value: "round_robin", label: t("automation.assignRoundRobin") },
            ]}
            onChange={(mode) => onChange({ ...a, mode })}
          />
          {a.mode === "round_robin" && (
            <p className="text-xs text-muted-foreground">{t("automation.roundRobinHelp")}</p>
          )}
        </div>
      );
    case "add_label":
      return (
        <Pick
          label={t("automation.actionLabel")}
          value={a.labelId}
          items={named(o.labels)}
          placeholder={o.labels.length ? t("automation.choose") : t("automation.noLabels")}
          onChange={(labelId) => onChange({ ...a, labelId })}
        />
      );
    case "set_priority":
      return (
        <Pick
          label={t("automation.actionPriority")}
          value={a.priority}
          items={PRIORITIES.map((p) => ({ value: p, label: t(PRIORITY_META[p].labelKey) }))}
          onChange={(priority) => onChange({ ...a, priority })}
        />
      );
    case "set_status":
      return (
        <Pick
          label={t("automation.actionStatus")}
          value={a.status}
          items={FEEDBACK_STATUSES.map((s) => ({ value: s, label: t(STATUS_META[s].labelKey) }))}
          onChange={(status) => onChange({ ...a, status })}
        />
      );
    case "add_to_round":
      return (
        <Pick
          label={t("automation.actionRound")}
          value={a.roundId}
          items={named(o.rounds)}
          placeholder={o.rounds.length ? t("automation.choose") : t("automation.noRounds")}
          onChange={(roundId) => onChange({ ...a, roundId })}
        />
      );
    case "notify_webhook":
      return (
        <Pick
          label={t("automation.actionWebhook")}
          value={a.endpointId}
          items={named(o.webhooks)}
          placeholder={o.webhooks.length ? t("automation.choose") : t("automation.noWebhooks")}
          onChange={(endpointId) => onChange({ ...a, endpointId })}
        />
      );
    case "notify_email":
      return (
        <div className="grid gap-2">
          <Chips
            label={t("automation.emailMembers")}
            value={a.userIds}
            items={named(o.members)}
            onChange={(userIds) => onChange({ ...a, userIds })}
          />
          <Input
            value={emails}
            aria-label={t("automation.emailAddresses")}
            placeholder={t("automation.emailAddressesPlaceholder")}
            onChange={(e) => {
              setEmails(e.target.value);
              onChange({ ...a, emails: splitList(e.target.value) });
            }}
          />
        </div>
      );
    case "create_issue":
      return (
        <Pick
          label={t("automation.actionIssue")}
          value={a.integrationId}
          items={named(o.trackers)}
          placeholder={o.trackers.length ? t("automation.choose") : t("automation.noTrackers")}
          onChange={(integrationId) => onChange({ ...a, integrationId })}
        />
      );
  }
}

/** Create or edit a rule: When [event], And [conditions], Then [actions]. */
export function RuleBuilder({
  project,
  rule,
  open,
  onOpenChange,
}: {
  project: ProjectDetail;
  rule: AutomationRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const options = useRuleOptions(project.id);
  const [create, { isLoading: creating }] = useCreateAutomationRuleMutation();
  const [update, { isLoading: updating }] = useUpdateAutomationRuleMutation();
  const [draft, setDraft] = useState<Draft>(() => (rule ? draftOf(rule) : emptyDraft()));
  const [error, setError] = useState<string | null>(null);
  const busy = creating || updating;

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const setCondition = (i: number, c: AutomationCondition) =>
    patch({ conditions: draft.conditions.map((x, j) => (j === i ? c : x)) });
  const setAction = (i: number, a: AutomationAction) =>
    patch({ actions: draft.actions.map((x, j) => (j === i ? a : x)) });

  const save = async () => {
    const parsed = automationRuleCreate.safeParse(draft);
    if (!parsed.success) {
      setError(draft.name.trim() ? t("automation.incomplete") : t("automation.nameRequired"));
      return;
    }
    setError(null);
    try {
      if (rule) await update({ id: rule.id, patch: parsed.data }).unwrap();
      else await create({ projectId: project.id, rule: parsed.data }).unwrap();
      toast.success(t(rule ? "automation.ruleSaved" : "automation.ruleCreated", { name: parsed.data.name }));
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const statusItems = FEEDBACK_STATUSES.map((s) => ({ value: s, label: t(STATUS_META[s].labelKey) }));
  const unused = (Object.keys(CONDITION_LABEL) as AutomationCondition["field"][]).filter(
    (f) => !draft.conditions.some((c) => c.field === f),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="rule-builder">
        <DialogHeader>
          <DialogTitle>{rule ? t("automation.editRule") : t("automation.newRule")}</DialogTitle>
          <DialogDescription>{t("automation.builderDescription")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <Field id="rule-name" label={t("automation.ruleName")}>
            <Input
              id="rule-name"
              value={draft.name}
              maxLength={100}
              placeholder={t("automation.ruleNamePlaceholder")}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>

          <section className="grid gap-2" aria-labelledby="rule-when">
            <h3 id="rule-when" className="text-sm font-medium">
              {t("automation.when")}
            </h3>
            <Pick
              label={t("automation.when")}
              value={draft.trigger.event}
              items={AUTOMATION_EVENTS.map((e) => ({ value: e, label: t(EVENT_LABEL[e]) }))}
              onChange={(event) => patch({ trigger: { event, toStatuses: [], labelId: null } })}
              className="w-72"
            />
            {draft.trigger.event === "status_changed" && (
              <div className="grid gap-1.5">
                <span className="text-xs text-muted-foreground">{t("automation.toStatuses")}</span>
                <Chips
                  label={t("automation.toStatuses")}
                  value={draft.trigger.toStatuses}
                  items={statusItems}
                  onChange={(toStatuses) => patch({ trigger: { ...draft.trigger, toStatuses } })}
                />
              </div>
            )}
            {draft.trigger.event === "label_added" && (
              <Pick
                label={t("automation.whichLabel")}
                value={draft.trigger.labelId ?? "any"}
                items={[
                  { value: "any", label: t("automation.anyLabel") },
                  ...options.labels.map((l) => ({ value: l.id, label: l.name })),
                ]}
                onChange={(v) => patch({ trigger: { ...draft.trigger, labelId: v === "any" ? null : v } })}
                className="w-72"
              />
            )}
          </section>

          <section className="grid gap-2" aria-labelledby="rule-if">
            <h3 id="rule-if" className="text-sm font-medium">
              {t("automation.and")}
            </h3>
            {draft.conditions.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("automation.noConditions")}</p>
            )}
            <ul className="grid gap-2">
              {draft.conditions.map((c, i) => (
                <li
                  key={c.field}
                  className="grid gap-2 rounded-lg border p-2.5 sm:grid-cols-[10rem_1fr_auto]"
                  data-testid="rule-condition"
                >
                  <span className="pt-1 text-sm">{t(CONDITION_LABEL[c.field])}</span>
                  <ConditionEditor c={c} o={options} onChange={(next) => setCondition(i, next)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("automation.removeCondition", { name: t(CONDITION_LABEL[c.field]) })}
                    onClick={() => patch({ conditions: draft.conditions.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            {draft.conditions.length < MAX_RULE_CONDITIONS && unused.length > 0 && (
              <Pick
                label={t("automation.addCondition")}
                value=""
                placeholder={t("automation.addCondition")}
                items={unused.map((f) => ({ value: f, label: t(CONDITION_LABEL[f]) }))}
                onChange={(f) => patch({ conditions: [...draft.conditions, defaultCondition(f, options)] })}
                className="w-56"
              />
            )}
          </section>

          <section className="grid gap-2" aria-labelledby="rule-then">
            <h3 id="rule-then" className="text-sm font-medium">
              {t("automation.then")}
            </h3>
            {draft.actions.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("automation.noActions")}</p>
            )}
            <ul className="grid gap-2">
              {draft.actions.map((a, i) => (
                <li
                  key={`${a.type}-${i}`}
                  className="grid gap-2 rounded-lg border p-2.5 sm:grid-cols-[10rem_1fr_auto]"
                  data-testid="rule-action"
                >
                  <span className="pt-1 text-sm">{t(ACTION_LABEL[a.type])}</span>
                  <ActionEditor a={a} o={options} onChange={(next) => setAction(i, next)} />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("automation.removeAction", { name: t(ACTION_LABEL[a.type]) })}
                    onClick={() => patch({ actions: draft.actions.filter((_, j) => j !== i) })}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
            {draft.actions.length < MAX_RULE_ACTIONS && (
              <Pick
                label={t("automation.addAction")}
                value=""
                placeholder={t("automation.addAction")}
                items={(Object.keys(ACTION_LABEL) as AutomationAction["type"][]).map((x) => ({
                  value: x,
                  label: t(ACTION_LABEL[x]),
                }))}
                onChange={(type) => patch({ actions: [...draft.actions, defaultAction(type, options)] })}
                className="w-56"
              />
            )}
          </section>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.enabled} onCheckedChange={(enabled) => patch({ enabled })} />
            {t("automation.enabled")}
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive" data-testid="rule-error">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("automation.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={() => void save()} data-testid="rule-save">
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}{" "}
            {rule ? t("automation.saveRule") : t("automation.createRule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
