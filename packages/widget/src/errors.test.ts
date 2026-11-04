// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeError, fingerprint, MAX_PER_SESSION, MIN_GAP_MS, watch } from "./errors";

const fire = (message: string, error?: Error) =>
  window.dispatchEvent(new ErrorEvent("error", { message, ...(error ? { error } : {}) }));

describe("describeError", () => {
  it("reads Errors, strings and bare messages", () => {
    expect(describeError(new TypeError("x is undefined"))).toMatchObject({
      message: "TypeError: x is undefined",
    });
    expect(describeError("boom")).toEqual({ message: "boom" });
    expect(describeError(undefined, "Uncaught ReferenceError: y")).toEqual({
      message: "Uncaught ReferenceError: y",
    });
  });
  it("ignores cross-origin 'Script error.' and empty reasons", () => {
    expect(describeError(undefined, "Script error.")).toBeNull();
    expect(describeError(undefined)).toBeNull();
    expect(describeError("   ")).toBeNull();
  });
  it("caps the message and stack", () => {
    const e = new Error("m".repeat(1000));
    e.stack = "s".repeat(5000);
    const d = describeError(e);
    expect(d?.message.length).toBe(300);
    expect(d?.stack?.length).toBe(2000);
  });
});

describe("fingerprint", () => {
  it("treats the same error at different lines/ids as one", () => {
    const a = { message: "Failed 123", stack: "Error\n    at f (app.js:10:5)" };
    const b = { message: "Failed 456", stack: "Error\n    at f (app.js:99:1)" };
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint({ message: "Other", stack: a.stack })).not.toBe(fingerprint(a));
  });
});

describe("watch", () => {
  let root: HTMLElement;
  let stop: () => void;
  let blocked = false;
  const onSend = vi.fn();
  const toast = () => root.querySelector(".errprompt");
  const click = (sel: string) => root.querySelector<HTMLElement>(sel)?.click();

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    root = document.createElement("div");
    document.body.append(root);
    blocked = false;
    onSend.mockReset();
    stop = watch(root, () => blocked, onSend);
  });
  afterEach(() => {
    stop();
    root.remove();
    vi.useRealTimers();
  });

  it("shows a non-blocking toast and hands the error to onSend on click", () => {
    fire("boom", new Error("boom"));
    expect(toast()?.getAttribute("role")).toBe("status");
    expect(toast()?.textContent).toContain("Something went wrong");
    click(".go");
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ message: "Error: boom" }));
    expect(toast()).toBeNull();
  });
  it("dismisses on the close button and by itself", () => {
    fire("one", new Error("one"));
    click(".x");
    expect(toast()).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    vi.advanceTimersByTime(MIN_GAP_MS);
    fire("two", new Error("two"));
    expect(toast()).not.toBeNull();
    vi.advanceTimersByTime(13_000);
    expect(toast()).toBeNull();
  });
  it("never offers the same error twice", () => {
    fire("a", new Error("a"));
    click(".x");
    vi.advanceTimersByTime(MIN_GAP_MS);
    fire("a", new Error("a"));
    expect(toast()).toBeNull();
    fire("b", new Error("b"));
    expect(toast()).not.toBeNull();
  });
  it("waits MIN_GAP_MS between prompts", () => {
    fire("a", new Error("a"));
    click(".x");
    fire("b", new Error("b"));
    expect(toast()).toBeNull();
  });
  it("caps prompts per session", () => {
    for (let i = 0; i < MAX_PER_SESSION + 2; i++) {
      fire(`e${i}`, new Error(`e${"y".repeat(i + 1)}`));
      click(".x");
      vi.advanceTimersByTime(MIN_GAP_MS);
    }
    expect(Number(sessionStorage.getItem("pinwren:errprompt"))).toBe(MAX_PER_SESSION);
    expect(toast()).toBeNull();
  });
  it("shows nothing while blocked (widget hidden or a report open)", () => {
    blocked = true;
    fire("z", new Error("z"));
    expect(toast()).toBeNull();
  });
  it("offers unhandled rejections", () => {
    const ev = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.assign(ev, { reason: new Error("nope") });
    window.dispatchEvent(ev);
    click(".go");
    expect(onSend).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Unhandled rejection: Error: nope" }),
    );
  });
  it("ignores errors thrown by the widget's own files", () => {
    const e = new Error("own");
    e.stack = "Error: own\n    at x (https://cdn.example/widget-report.abc123.js:1:1)";
    fire("own", e);
    expect(toast()).toBeNull();
  });
  it("stops listening and removes the toast", () => {
    fire("q", new Error("q"));
    stop();
    expect(toast()).toBeNull();
    fire("r", new Error("r"));
    expect(toast()).toBeNull();
  });
});
