import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { FeedbackPatch } from "../api/feedback";

export type DetailMenu = "status" | "priority" | "assignee" | "round" | null;
export type Density = "comfortable" | "compact";

export type InboxState = {
  /** Checked rows (`x` / shift-click), in the order they were checked. */
  selection: string[];
  /** The row a shift-click extends from. */
  anchor: string | null;
  /** Which picker of the open item is open — the `s` / `p` / `a` keys open them. */
  menu: DetailMenu;
  /** The last change, so `u` can put it back. */
  lastChange: { ids: string[]; patch: FeedbackPatch; label: string } | null;
  /** Per-device preferences (saved in localStorage by the listener middleware). */
  prefs: { density: Density };
};

export const initialInboxState: InboxState = {
  selection: [],
  anchor: null,
  menu: null,
  lastChange: null,
  prefs: { density: "comfortable" },
};

export const inboxSlice = createSlice({
  name: "inbox",
  initialState: initialInboxState,
  reducers: {
    /**
     * A plain toggle flips one row and moves the anchor; with `range`, every row between the anchor and
     * this one (in list `order`) is added.
     */
    selectionToggled(state, action: PayloadAction<{ id: string; range?: boolean; order: string[] }>) {
      const { id, range, order } = action.payload;
      const a = range && state.anchor ? order.indexOf(state.anchor) : -1;
      const b = a >= 0 ? order.indexOf(id) : -1;
      if (a >= 0 && b >= 0) {
        const span = order.slice(Math.min(a, b), Math.max(a, b) + 1);
        state.selection = [...new Set([...state.selection, ...span])];
        return;
      }
      state.anchor = id;
      state.selection = state.selection.includes(id)
        ? state.selection.filter((x) => x !== id)
        : [...state.selection, id];
    },
    /** Keep the selection to rows still in the list (after a refetch, a filter change, a delete). */
    selectionPruned(state, action: PayloadAction<string[]>) {
      const keep = new Set(action.payload);
      if (state.selection.some((id) => !keep.has(id)))
        state.selection = state.selection.filter((id) => keep.has(id));
      if (state.anchor && !keep.has(state.anchor)) state.anchor = null;
    },
    selectionCleared(state) {
      state.selection = [];
      state.anchor = null;
    },
    menuChanged(state, action: PayloadAction<DetailMenu>) {
      state.menu = action.payload;
    },
    changeRecorded(state, action: PayloadAction<InboxState["lastChange"]>) {
      state.lastChange = action.payload;
    },
    densityChanged(state, action: PayloadAction<Density>) {
      state.prefs.density = action.payload;
    },
    prefsLoaded(state, action: PayloadAction<Partial<InboxState["prefs"]>>) {
      state.prefs = { ...state.prefs, ...action.payload };
    },
  },
});

export const {
  selectionToggled,
  selectionPruned,
  selectionCleared,
  menuChanged,
  changeRecorded,
  densityChanged,
  prefsLoaded,
} = inboxSlice.actions;
