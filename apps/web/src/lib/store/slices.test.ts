import { describe, expect, it } from "vitest";
import {
  changeRecorded,
  densityChanged,
  inboxSlice,
  initialInboxState,
  menuChanged,
  selectionCleared,
  selectionPruned,
  selectionToggled,
} from "./slices/inbox";
import {
  followChanged,
  freshCleared,
  initialRealtimeState,
  itemGone,
  itemsArrived,
  newItemQueued,
  presenceChanged,
  realtimeSlice,
  realtimeStopped,
  statusChanged,
} from "./slices/realtime";
import { initialUiState, paletteToggled, shortcutsToggled, uiSlice } from "./slices/ui";

const inbox = inboxSlice.reducer;
const rt = realtimeSlice.reducer;
const order = ["a", "b", "c", "d", "e"];

describe("inbox slice", () => {
  it("toggles one row and moves the anchor", () => {
    let s = inbox(initialInboxState, selectionToggled({ id: "b", order }));
    expect(s.selection).toEqual(["b"]);
    expect(s.anchor).toBe("b");
    s = inbox(s, selectionToggled({ id: "b", order }));
    expect(s.selection).toEqual([]);
  });

  it("shift adds the span from the anchor, in list order, without duplicates", () => {
    let s = inbox(initialInboxState, selectionToggled({ id: "b", order }));
    s = inbox(s, selectionToggled({ id: "d", range: true, order }));
    expect(s.selection).toEqual(["b", "c", "d"]);
    s = inbox(s, selectionToggled({ id: "a", range: true, order }));
    expect(new Set(s.selection)).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("a range without an anchor is a plain toggle", () => {
    const s = inbox(initialInboxState, selectionToggled({ id: "c", range: true, order }));
    expect(s.selection).toEqual(["c"]);
  });

  it("prunes rows that left the list and clears", () => {
    let s = inbox(initialInboxState, selectionToggled({ id: "a", order }));
    s = inbox(s, selectionToggled({ id: "c", order }));
    s = inbox(s, selectionPruned(["a", "b"]));
    expect(s.selection).toEqual(["a"]);
    expect(s.anchor).toBeNull();
    expect(inbox(s, selectionCleared()).selection).toEqual([]);
  });

  it("keeps the open picker, the last change and preferences", () => {
    let s = inbox(initialInboxState, menuChanged("priority"));
    expect(s.menu).toBe("priority");
    s = inbox(
      s,
      changeRecorded({
        each: [
          { id: "a", patch: { status: "open" } },
          { id: "b", patch: { status: "in_review" } },
        ],
        label: "Resolved",
      }),
    );
    expect(s.lastChange?.each.map((c) => c.patch.status)).toEqual(["open", "in_review"]);
    expect(inbox(s, densityChanged("compact")).prefs.density).toBe("compact");
  });
});

describe("realtime slice", () => {
  const users = [{ id: "u1", name: "Ann", image: null }];

  it("tracks who has an item open, and forgets empty or deleted ones", () => {
    let s = rt(initialRealtimeState, presenceChanged({ feedbackId: "f1", users }));
    expect(s.presence.f1).toEqual(users);
    s = rt(s, presenceChanged({ feedbackId: "f1", users: [] }));
    expect(s.presence).toEqual({});
    s = rt(s, presenceChanged({ feedbackId: "f2", users }));
    expect(rt(s, itemGone("f2")).presence).toEqual({});
  });

  it("queues new items once, and moves them to fresh when shown", () => {
    const item = { id: "n1", projectId: "p", number: 7, title: null };
    let s = rt(initialRealtimeState, newItemQueued(item));
    s = rt(s, newItemQueued(item));
    expect(s.pending).toHaveLength(1);
    s = rt(s, itemsArrived(["n1"]));
    expect(s.pending).toEqual([]);
    expect(s.fresh).toEqual(["n1"]);
    expect(rt(s, freshCleared("n1")).fresh).toEqual([]);
  });

  it("follows the list and reports the connection", () => {
    let s = rt(initialRealtimeState, followChanged(false));
    expect(s.follow).toBe(false);
    s = rt(s, statusChanged("open"));
    expect(s.status).toBe("open");
    expect(rt(s, realtimeStopped()).status).toBe("idle");
  });
});

describe("ui slice", () => {
  it("opens and toggles overlays", () => {
    let s = uiSlice.reducer(initialUiState, paletteToggled());
    expect(s.paletteOpen).toBe(true);
    s = uiSlice.reducer(s, paletteToggled(false));
    expect(s.paletteOpen).toBe(false);
    expect(uiSlice.reducer(s, shortcutsToggled(true)).shortcutsOpen).toBe(true);
  });
});
