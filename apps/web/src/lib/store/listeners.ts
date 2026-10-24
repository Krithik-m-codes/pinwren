import {
  PRESENCE_HEARTBEAT_MS,
  STREAM_EVENTS,
  streamCommentChanged,
  streamCommentCreated,
  streamFeedbackCreated,
  streamFeedbackDeleted,
  streamFeedbackUpdated,
  streamNotificationCreated,
  streamPresence,
} from "@pinwren/core";
import {
  createListenerMiddleware,
  type ListenerEffectAPI,
  type ThunkDispatch,
  type UnknownAction,
} from "@reduxjs/toolkit";
import { showDesktopNotification } from "@/lib/desktop-notifications";
import { notificationHref, notificationSubject, notificationText } from "@/lib/notification-text";
import type { NotificationItem } from "@/lib/api";
import { api } from "./api";
import type { FeedbackListArgs } from "@/lib/inbox-filters";
import type { StoreExtra } from "./api/base";
import { type FeedbackFields, patchCachedFeedback, removeCachedFeedback } from "./api/feedback";
import { onboardingApi } from "./api/onboarding";
import { densityChanged, type InboxState } from "./slices/inbox";
import {
  eventIdSeen,
  followChanged,
  itemGone,
  itemsArrived,
  newItemQueued,
  newItemsShown,
  presenceChanged,
  presenceWatched,
  type RealtimeState,
  realtimeStarted,
  realtimeStopped,
  statusChanged,
  streamReceived,
} from "./slices/realtime";

// Side effects of the store, in one place: the real-time stream (SSE → RTK Query cache), the presence
// heartbeat, and per-device preferences. Everything here is plain Redux, so it is unit-tested with a fake
// EventSource and a mocked fetch (listeners.test.ts).

type State = { realtime: RealtimeState; inbox: InboxState; api: ReturnType<typeof api.reducer> };
type Dispatch = ThunkDispatch<State, StoreExtra, UnknownAction>;
type Listener = ListenerEffectAPI<State, Dispatch, StoreExtra>;

export const PREFS_KEY = "pinwren:inbox-prefs";
const EventSourceClosed = 2;
const MAX_BACKOFF_MS = 30_000;

/** `/api/stream` with the filters and (when reopening by hand) the last event id. */
export function streamUrl(
  apiBase: string,
  projectIds: string[] | undefined,
  lastEventId: string | null,
): string {
  const sp = new URLSearchParams();
  if (projectIds?.length) sp.set("projectIds", projectIds.join(","));
  if (lastEventId) sp.set("lastEventId", lastEventId);
  const qs = sp.toString();
  return `${apiBase}/stream${qs ? `?${qs}` : ""}`;
}

export const backoffMs = (attempt: number) => Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt, 5));

/**
 * Keep one EventSource open until `realtimeStopped`. The browser reconnects by itself after a dropped
 * connection (and sends `Last-Event-ID`); when the stream is closed for good (an HTTP error, a server
 * restart) it is reopened here with backoff and `?lastEventId=`. Every reopen also refetches the lists:
 * the server can replay only what its own worker saw (best effort, wave-4 §9).
 */
async function runStream(l: Listener, projectIds: string[] | undefined, signal: AbortSignal) {
  const open = l.extra.eventSource;
  if (!open) return;
  // Mutated from the EventSource callbacks.
  const run = { attempt: 0, opened: false };
  while (!signal.aborted) {
    l.dispatch(statusChanged(run.opened ? "reconnecting" : "connecting"));
    const url = streamUrl(l.extra.apiBase, projectIds, l.getState().realtime.lastEventId);
    const outcome = await new Promise<"closed" | "aborted">((resolve) => {
      const es = open(url);
      const onAbort = () => {
        es.close();
        resolve("aborted");
      };
      signal.addEventListener("abort", onAbort, { once: true });
      es.onopen = () => {
        run.attempt = 0;
        l.dispatch(statusChanged("open"));
        if (run.opened) resync(l);
        run.opened = true;
      };
      es.onerror = () => {
        if (es.readyState !== EventSourceClosed) {
          l.dispatch(statusChanged("reconnecting"));
          return;
        }
        es.close();
        signal.removeEventListener("abort", onAbort);
        resolve("closed");
      };
      for (const event of STREAM_EVENTS) {
        if (event === "ping") continue;
        es.addEventListener(event, (ev) => {
          if (ev.lastEventId) l.dispatch(eventIdSeen(ev.lastEventId));
          let data: unknown = null;
          try {
            data = JSON.parse(ev.data);
          } catch {
            return;
          }
          l.dispatch(streamReceived({ event, data, id: ev.lastEventId || null }));
        });
      }
    });
    if (outcome === "aborted") return;
    await l.delay(backoffMs(run.attempt++));
  }
}

/** After a gap in the stream, anything may have changed: refetch what's on screen. */
function resync(l: Listener) {
  l.dispatch(
    api.util.invalidateTags([
      { type: "Feedback", id: "LIST" },
      { type: "Project", id: "LIST" },
      { type: "Round", id: "LIST" },
      "Notification",
    ]),
  );
}

/** Refetch an item's detail if someone has it open (comments and the timeline changed). */
function refreshDetail(l: Listener, id: string) {
  const cached = api.endpoints.feedbackDetail.select(id)(l.getState());
  if (cached.isUninitialized) return;
  void l.dispatch(api.endpoints.feedbackDetail.initiate(id, { subscribe: false, forceRefetch: true }));
}

const PATCHABLE = ["status", "priority", "assigneeIds", "title", "roundId", "kind", "dueAt"] as const;

/** `changes` is field → `{ from, to }` (values dropped above the size cap, `truncated: true`). */
export function fieldsFromChanges(changes: Record<string, unknown>): FeedbackFields {
  const out: Record<string, unknown> = {};
  for (const k of PATCHABLE) {
    const c = changes[k];
    if (c && typeof c === "object" && "to" in c) out[k] = c.to;
  }
  return out;
}

/**
 * Whether a change to `fields` can move an item into or out of a list with these filters, or reorder it
 * (e.g. a status change on the "Active" tab, an assignment on "My work", any change when sorted by update).
 */
export function listDependsOn(args: FeedbackListArgs, fields: readonly string[]): boolean {
  const f = new Set(fields);
  return (
    args.sort === "updated" ||
    (f.has("status") && args.status !== "all") ||
    (f.has("assigneeIds") && !!args.assigneeId) ||
    (f.has("roundId") && !!args.roundId) ||
    (f.has("priority") && (!!args.priority || args.sort === "priority")) ||
    (f.has("kind") && !!args.kind) ||
    (f.has("labelIds") && !!args.labelId) ||
    (f.has("title") && !!args.q) ||
    f.has("deletedAt")
  );
}

/** Refetch the cached lists a remote change can reshape; patching rows in place can't add or drop rows. */
function refreshListsFor(l: Listener, fields: readonly string[]) {
  const affected = Object.values(l.getState().api.queries).some(
    (q) =>
      q?.endpointName === "listFeedback" &&
      listDependsOn(q.originalArgs as unknown as FeedbackListArgs, fields),
  );
  if (affected) l.dispatch(api.util.invalidateTags([{ type: "Feedback", id: "LIST" }]));
}

/** One stream event → RTK Query cache updates and real-time state. */
export function applyStreamEvent(l: Listener, event: string, data: unknown) {
  switch (event) {
    case "feedback.created": {
      const p = streamFeedbackCreated.safeParse(data);
      if (!p.success) return;
      const f = p.data;
      l.dispatch(
        api.util.invalidateTags([
          { type: "Project", id: "LIST" },
          { type: "Round", id: "LIST" },
        ]),
      );
      // "Widget connected" and "First report received" on the inbox's setup checklist.
      l.dispatch(onboardingApi.util.invalidateTags(["SetupChecklist"]));
      if (l.getState().realtime.follow) {
        l.dispatch(api.util.invalidateTags([{ type: "Feedback", id: "LIST" }]));
        l.dispatch(itemsArrived([f.id]));
      } else {
        l.dispatch(newItemQueued({ id: f.id, projectId: f.projectId, number: f.number, title: f.title }));
      }
      return;
    }
    case "feedback.updated": {
      const p = streamFeedbackUpdated.safeParse(data);
      if (!p.success) return;
      const fields = fieldsFromChanges(p.data.changes);
      if (Object.keys(fields).length)
        patchCachedFeedback(l.dispatch, () => l.getState(), [p.data.id], fields);
      // Labels travel as ids (the rows show names and colours): refetch what shows the item.
      if ("labelIds" in p.data.changes) {
        l.dispatch(api.util.invalidateTags([{ type: "Feedback", id: p.data.id }]));
      }
      refreshListsFor(l, Object.keys(p.data.changes));
      refreshDetail(l, p.data.id);
      if ("status" in fields || "roundId" in fields) {
        l.dispatch(
          api.util.invalidateTags([
            { type: "Project", id: "LIST" },
            { type: "Round", id: "LIST" },
          ]),
        );
      }
      return;
    }
    case "feedback.deleted": {
      const p = streamFeedbackDeleted.safeParse(data);
      if (!p.success) return;
      removeCachedFeedback(l.dispatch, () => l.getState(), [p.data.id]);
      l.dispatch(itemGone(p.data.id));
      l.dispatch(
        api.util.invalidateTags([
          { type: "Project", id: "LIST" },
          { type: "Round", id: "LIST" },
        ]),
      );
      return;
    }
    case "comment.created": {
      const p = streamCommentCreated.safeParse(data);
      if (!p.success) return;
      patchCachedFeedback(
        l.dispatch,
        () => l.getState(),
        [p.data.feedbackId],
        (row) => {
          row.commentCount += 1;
        },
      );
      refreshDetail(l, p.data.feedbackId);
      return;
    }
    case "comment.updated":
    case "comment.deleted": {
      const p = streamCommentChanged.safeParse(data);
      if (!p.success) return;
      if (event === "comment.deleted") {
        patchCachedFeedback(
          l.dispatch,
          () => l.getState(),
          [p.data.feedbackId],
          (row) => {
            row.commentCount = Math.max(0, row.commentCount - 1);
          },
        );
      }
      refreshDetail(l, p.data.feedbackId);
      return;
    }
    case "notification.created": {
      // Sent per person by the dispatch job after the row exists (no race with the insert); the bell and the
      // notifications page refetch, and a background tab may show a desktop notification.
      const p = streamNotificationCreated.safeParse(data);
      if (!p.success) return;
      l.dispatch(api.util.invalidateTags(["Notification"]));
      const n = { type: p.data.type, feedbackId: p.data.feedbackId, data: p.data.data } as Pick<
        NotificationItem,
        "type" | "feedbackId" | "data"
      >;
      const project = typeof n.data.projectName === "string" ? ` · ${n.data.projectName}` : "";
      showDesktopNotification({
        id: p.data.id,
        title: `${notificationText(n)}${project}`,
        body: notificationSubject(n),
        href: notificationHref(n, p.data.orgId),
      });
      return;
    }
    case "presence": {
      const p = streamPresence.safeParse(data);
      if (p.success) l.dispatch(presenceChanged({ feedbackId: p.data.feedbackId, users: p.data.users }));
      return;
    }
    default:
  }
}

/** The store's listener middleware, created per store so each has its own `extra` (base URL, EventSource). */
export function createListeners(extra: StoreExtra, register = true) {
  const listener = createListenerMiddleware<State, Dispatch, StoreExtra>({ extra });
  if (!register) return listener;
  const start = listener.startListening;

  start({
    actionCreator: realtimeStarted,
    effect: async (action, l) => {
      l.cancelActiveListeners();
      const task = l.fork((f) => runStream(l, action.payload?.projectIds, f.signal));
      await l.take(realtimeStopped.match);
      task.cancel();
    },
  });

  start({
    actionCreator: streamReceived,
    effect: (action, l) => applyStreamEvent(l, action.payload.event, action.payload.data),
  });

  // Heartbeat while an item is open; the latest one wins on the server, so switching items needs no "left".
  start({
    actionCreator: presenceWatched,
    effect: async (action, l) => {
      l.cancelActiveListeners();
      const beat = async (feedbackId: string | null) => {
        const req = l.dispatch(api.endpoints.presenceHeartbeat.initiate(feedbackId));
        await req;
        req.reset();
      };
      const id = action.payload;
      if (id === null) {
        await beat(null);
        return;
      }
      for (;;) {
        void beat(id);
        await l.delay(PRESENCE_HEARTBEAT_MS);
      }
    },
  });

  const showPending = (l: Listener) => {
    const pending = l.getState().realtime.pending;
    if (!pending.length) return;
    l.dispatch(api.util.invalidateTags([{ type: "Feedback", id: "LIST" }]));
    l.dispatch(itemsArrived(pending.map((p) => p.id)));
  };
  start({ actionCreator: newItemsShown, effect: (_a, l) => showPending(l) });
  start({
    actionCreator: followChanged,
    effect: (action, l) => {
      if (action.payload) showPending(l);
    },
  });

  start({
    actionCreator: densityChanged,
    effect: (_a, l) => {
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(l.getState().inbox.prefs));
      } catch {
        // storage blocked (private mode): the preference lasts for this visit
      }
    },
  });

  return listener;
}
