import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { PresenceUser } from "@/lib/api";

export type StreamStatus = "idle" | "connecting" | "open" | "reconnecting";

/** A `feedback.created` the inbox hasn't shown yet (the list is scrolled, so it isn't refetched). */
export type NewItem = { id: string; projectId: string; number: number; title: string | null };

export type RealtimeState = {
  status: StreamStatus;
  /** Id of the last event seen, sent as `Last-Event-ID` when the stream is reopened by hand. */
  lastEventId: string | null;
  /** feedbackId → who else has it open (wave-4 §1 `presence`). */
  presence: Record<string, PresenceUser[]>;
  /** True while the inbox list is at the top: new items are fetched straight in. */
  follow: boolean;
  /** New items waiting behind the "N new" pill. */
  pending: NewItem[];
  /** Items that just arrived, for the slide-in highlight. */
  fresh: string[];
};

export const initialRealtimeState: RealtimeState = {
  status: "idle",
  lastEventId: null,
  presence: {},
  follow: true,
  pending: [],
  fresh: [],
};

const MAX_PENDING = 100;
const MAX_FRESH = 20;

/** One event from `GET /api/stream`, as received (validated by the listener middleware). */
export type StreamMessage = { event: string; data: unknown; id: string | null };

export const realtimeStarted = createAction<{ projectIds?: string[] } | undefined>("realtime/started");
export const realtimeStopped = createAction("realtime/stopped");
export const streamReceived = createAction<StreamMessage>("realtime/streamReceived");
/** The item this person has open (heartbeat every 20 s), or null when they leave it. */
export const presenceWatched = createAction<string | null>("realtime/presenceWatched");
/** "N new" clicked (or the list scrolled back to the top): show what's pending. */
export const newItemsShown = createAction("realtime/newItemsShown");

export const realtimeSlice = createSlice({
  name: "realtime",
  initialState: initialRealtimeState,
  reducers: {
    statusChanged(state, action: PayloadAction<StreamStatus>) {
      state.status = action.payload;
    },
    eventIdSeen(state, action: PayloadAction<string>) {
      state.lastEventId = action.payload;
    },
    presenceChanged(state, action: PayloadAction<{ feedbackId: string; users: PresenceUser[] }>) {
      const { feedbackId, users } = action.payload;
      const { [feedbackId]: _gone, ...others } = state.presence;
      state.presence = users.length ? { ...others, [feedbackId]: users } : others;
    },
    followChanged(state, action: PayloadAction<boolean>) {
      state.follow = action.payload;
    },
    newItemQueued(state, action: PayloadAction<NewItem>) {
      if (state.pending.some((p) => p.id === action.payload.id)) return;
      state.pending = [action.payload, ...state.pending].slice(0, MAX_PENDING);
    },
    itemsArrived(state, action: PayloadAction<string[]>) {
      state.fresh = [...new Set([...action.payload, ...state.fresh])].slice(0, MAX_FRESH);
      const shown = new Set(action.payload);
      state.pending = state.pending.filter((p) => !shown.has(p.id));
    },
    freshCleared(state, action: PayloadAction<string>) {
      state.fresh = state.fresh.filter((id) => id !== action.payload);
    },
    itemGone(state, action: PayloadAction<string>) {
      state.pending = state.pending.filter((p) => p.id !== action.payload);
      const { [action.payload]: _gone, ...others } = state.presence;
      state.presence = others;
    },
  },
  extraReducers: (b) => {
    b.addCase(realtimeStopped, (state) => {
      state.status = "idle";
    });
  },
});

export const {
  statusChanged,
  eventIdSeen,
  presenceChanged,
  followChanged,
  newItemQueued,
  itemsArrived,
  freshCleared,
  itemGone,
} = realtimeSlice.actions;
