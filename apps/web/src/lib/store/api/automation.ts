import type {
  AiLabelBulkRequest,
  AutomationAction,
  AutomationCondition,
  AutomationRuleCreate,
  AutomationRuleUpdate,
  AutomationTestRequest,
  AutomationTrigger,
} from "@pinwren/core";
import { LIST } from "./base";
import { adminApi } from "./admin";

export type AutomationRule = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRunResult = { type: string; ok: boolean; detail: string };
export type AutomationRun = {
  id: string;
  ruleId: string;
  ruleName: string;
  feedbackId: string | null;
  feedbackNumber: number | null;
  event: string;
  depth: number;
  status: "success" | "partial" | "failed" | "skipped";
  results: AutomationRunResult[];
  error: string | null;
  createdAt: string;
};

export type AutomationTestResult = {
  triggered: boolean;
  conditions: boolean[];
  matched: boolean;
  actions: string[];
};

/** A ghost chip: a label the AI proposes for an item. `labelId` null = a new label created on accept. */
export type LabelSuggestion = {
  id: string;
  feedbackId: string;
  labelId: string | null;
  name: string;
  color: string;
  reason: string | null;
};

/** Automation rules, their run log and AI label suggestions (WP-28). */
export const automationApi = adminApi.injectEndpoints({
  endpoints: (build) => ({
    automationRules: build.query<{ rules: AutomationRule[] }, string>({
      query: (projectId) => `/projects/${projectId}/automations`,
      providesTags: (r, _e, projectId) => [
        { type: "Automation", id: LIST },
        { type: "Automation", id: projectId },
        ...(r?.rules.map((x) => ({ type: "Automation" as const, id: x.id })) ?? []),
      ],
    }),
    createAutomationRule: build.mutation<
      { rule: AutomationRule },
      { projectId: string; rule: AutomationRuleCreate }
    >({
      query: ({ projectId, rule }) => ({
        url: `/projects/${projectId}/automations`,
        method: "POST",
        body: rule,
      }),
      invalidatesTags: [{ type: "Automation", id: LIST }],
    }),
    updateAutomationRule: build.mutation<
      { rule: AutomationRule },
      { id: string; patch: AutomationRuleUpdate }
    >({
      query: ({ id, patch }) => ({ url: `/automations/${id}`, method: "PATCH", body: patch }),
      invalidatesTags: [{ type: "Automation", id: LIST }],
    }),
    deleteAutomationRule: build.mutation<unknown, string>({
      query: (id) => ({ url: `/automations/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Automation", id: LIST }],
    }),
    testAutomationRule: build.mutation<AutomationTestResult, { id: string; request: AutomationTestRequest }>({
      query: ({ id, request }) => ({ url: `/automations/${id}/test`, method: "POST", body: request }),
    }),
    automationRuns: build.query<
      { runs: AutomationRun[] },
      { projectId: string; ruleId?: string | undefined }
    >({
      query: ({ projectId, ruleId }) => ({
        url: `/projects/${projectId}/automation-runs`,
        params: { limit: 50, ...(ruleId ? { ruleId } : {}) },
      }),
      providesTags: (_r, _e, { projectId }) => [
        { type: "Automation", id: `runs:${projectId}` },
        { type: "Automation", id: LIST },
      ],
    }),

    aiLabelSuggestions: build.query<{ suggestions: LabelSuggestion[] }, string>({
      query: (feedbackId) => `/feedback/${feedbackId}/ai/labels`,
      // A realtime update of the item (the AI job finished) refreshes its chips.
      providesTags: (_r, _e, feedbackId) => [{ type: "Feedback", id: feedbackId }],
    }),
    decideLabelSuggestion: build.mutation<
      { accepted: number; dismissed: number },
      { feedbackId: string; id: string; action: "accept" | "dismiss" }
    >({
      query: ({ feedbackId, id, action }) => ({
        url: `/feedback/${feedbackId}/ai/labels/${id}/${action}`,
        method: "POST",
      }),
      invalidatesTags: (_r, _e, { feedbackId }) => [
        { type: "Feedback", id: feedbackId },
        { type: "Label", id: LIST },
      ],
    }),
    bulkAiLabels: build.mutation<{ accepted: number; dismissed: number }, AiLabelBulkRequest>({
      query: (body) => ({ url: "/ai/labels/bulk", method: "POST", body }),
      invalidatesTags: [{ type: "Feedback", id: LIST }, { type: "Label", id: LIST }, "Feedback"],
    }),
  }),
});
