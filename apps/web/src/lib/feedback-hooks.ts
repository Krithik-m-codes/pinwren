"use client";

import type { FeedbackStatus, Priority } from "@pinwren/core";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  api,
  type FeedbackDetail,
  type FeedbackList,
  isAdminRole,
  type Member,
  qk,
  screenshotOf,
} from "@/lib/api";
import { useSession } from "@/lib/auth-client";

export type FeedbackPatch = Partial<{
  status: FeedbackStatus;
  priority: Priority;
  assigneeIds: string[];
  title: string | null;
}>;

type Snapshot = { lists: [readonly unknown[], FeedbackList | undefined][]; detail?: FeedbackDetail };

function applyOptimistic(qc: QueryClient, ids: string[], patch: FeedbackPatch): Snapshot {
  const set = new Set(ids);
  const lists = qc.getQueriesData<FeedbackList>({ queryKey: qk.feedbackLists });
  for (const [key, data] of lists) {
    if (!data) continue;
    qc.setQueryData<FeedbackList>(key, {
      ...data,
      items: data.items.map((i) => (set.has(i.id) ? { ...i, ...patch } : i)),
    });
  }
  const snapshot: Snapshot = { lists };
  for (const id of ids) {
    const detail = qc.getQueryData<FeedbackDetail>(qk.feedback(id));
    if (!detail) continue;
    if (ids.length === 1) snapshot.detail = detail;
    qc.setQueryData<FeedbackDetail>(qk.feedback(id), {
      ...detail,
      feedback: { ...detail.feedback, ...patch },
    });
  }
  return snapshot;
}

function restore(qc: QueryClient, ids: string[], snap: Snapshot | undefined) {
  if (!snap) return;
  for (const [key, data] of snap.lists) qc.setQueryData(key, data);
  if (snap.detail && ids[0]) qc.setQueryData(qk.feedback(ids[0]), snap.detail);
}

/**
 * PATCH one or many items, optimistically: lists and the open detail change at once and roll back
 * if the API refuses. There is no bulk endpoint, so many ids are sent as parallel PATCHes.
 */
export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, patch }: { ids: string[]; patch: FeedbackPatch }) => {
      const results = await Promise.allSettled(
        ids.map((id) => api(`/feedback/${id}`, { method: "PATCH", json: patch })),
      );
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed.length) throw failed[0]?.reason ?? new Error("Update failed");
    },
    onMutate: async ({ ids, patch }) => {
      await qc.cancelQueries({ queryKey: ["feedback"] });
      return applyOptimistic(qc, ids, patch);
    },
    onError: (e, { ids }, snap) => {
      restore(qc, ids, snap);
      toast.error(e.message);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useDeleteFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api(`/feedback/${id}`, { method: "DELETE" })));
      return ids.length;
    },
    onSuccess: (n) => toast.success(n === 1 ? "Feedback deleted" : `${n} items deleted`),
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      void qc.invalidateQueries({ queryKey: qk.projects });
    },
  });
}

export function useMembers() {
  return useQuery({ queryKey: qk.members, queryFn: () => api<{ members: Member[] }>("/members") });
}

/** The signed-in user and whether they administer the active organisation. */
export function useMe() {
  const { data: session } = useSession();
  const members = useMembers();
  const userId = session?.user.id;
  const me = members.data?.members.find((m) => m.id === userId);
  return { userId, me, isAdmin: isAdminRole(me?.role) };
}

export function useFeedbackDetail(id: string | null) {
  return useQuery({
    queryKey: qk.feedback(id ?? ""),
    queryFn: () => api<FeedbackDetail>(`/feedback/${id}`),
    enabled: !!id,
  });
}

/**
 * Screenshot asset id for a list item. The list endpoint only says *whether* there is one, so cards
 * read it from the detail (cached for a long time, separate key so list mutations don't refetch it).
 */
export function useThumbnail(id: string, hasScreenshot: boolean) {
  return useQuery({
    queryKey: qk.thumb(id),
    queryFn: async () => {
      const d = await api<FeedbackDetail>(`/feedback/${id}`);
      return screenshotOf(d.assets)?.id ?? null;
    },
    enabled: hasScreenshot,
    staleTime: 10 * 60_000,
  });
}

export function withParam(url: string, key: string, value: string) {
  try {
    const u = new URL(url);
    u.searchParams.set(key, value);
    return u.toString();
  } catch {
    return url;
  }
}

/** Dashboard deep link to one item. */
export const itemLink = (id: string) =>
  `${typeof window === "undefined" ? "" : window.location.origin}/inbox?status=all&item=${id}`;
