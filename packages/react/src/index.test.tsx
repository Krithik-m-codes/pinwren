import { act, cleanup, render, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pinwren, usePinwren } from "./index";

type Fn = ReturnType<typeof vi.fn>;
type FakeApi = Record<
  "init" | "open" | "close" | "identify" | "setPageScope" | "setMetadata" | "show" | "hide" | "destroy",
  Fn
> & {
  on: Fn;
  emit: (event: string, data?: unknown) => void;
};

/** A stand-in for window.Pinwren once widget.js has run. */
function fakeApi(): FakeApi {
  const handlers = new Map<string, Set<(d?: unknown) => void>>();
  const api = {
    init: vi.fn(),
    open: vi.fn(),
    close: vi.fn(),
    identify: vi.fn(),
    setPageScope: vi.fn(),
    setMetadata: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn((event: string, cb: (d?: unknown) => void) => {
      const set = handlers.get(event) ?? new Set();
      set.add(cb);
      handlers.set(event, set);
      return () => set.delete(cb);
    }),
    emit: (event: string, data?: unknown) => {
      for (const cb of handlers.get(event) ?? []) cb(data);
    },
  };
  (window as unknown as { Pinwren: unknown }).Pinwren = api;
  return api;
}

const SIG = "0f".repeat(32);
let api: FakeApi;

beforeEach(() => {
  api = fakeApi();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as { Pinwren?: unknown }).Pinwren;
  vi.restoreAllMocks();
});

describe("<Pinwren>", () => {
  it("renders nothing and initialises the widget with scope and identity first", () => {
    const { container } = render(
      <Pinwren
        projectKey="pk_1"
        endpoint="https://fb.example.com"
        locale="fr"
        forceShow
        urlPattern="/product/:id"
        user={{ id: "u1", name: "Maria", email: "m@example.com" }}
        userSignature={SIG}
      />,
    );
    expect(container.innerHTML).toBe("");
    expect(api.setPageScope).toHaveBeenCalledWith({ urlPattern: "/product/:id" });
    expect(api.identify).toHaveBeenCalledWith(
      { id: "u1", name: "Maria", email: "m@example.com" },
      { signature: SIG },
    );
    expect(api.init).toHaveBeenCalledWith(
      expect.objectContaining({
        projectKey: "pk_1",
        endpoint: "https://fb.example.com",
        locale: "fr",
        forceShow: true,
      }),
    );
    const order = (fn: Fn) => fn.mock.invocationCallOrder[0] ?? 0;
    expect(order(api.setPageScope)).toBeLessThan(order(api.init));
    expect(order(api.identify)).toBeLessThan(order(api.init));
  });

  it("updates identity and scope in place, re-creates on a new project, destroys on unmount", () => {
    const { rerender, unmount } = render(<Pinwren projectKey="pk_1" endpoint="https://fb.example.com" />);
    expect(api.identify).toHaveBeenLastCalledWith(null, undefined);
    rerender(
      <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" user={{ id: "u2" }} urlPattern="/a/*" />,
    );
    expect(api.identify).toHaveBeenLastCalledWith({ id: "u2", name: undefined, email: undefined }, undefined);
    expect(api.setPageScope).toHaveBeenLastCalledWith({ urlPattern: "/a/*" });
    expect(api.init).toHaveBeenCalledTimes(1);
    expect(api.destroy).not.toHaveBeenCalled();
    // A new object with the same values doesn't identify again.
    const calls = api.identify.mock.calls.length;
    rerender(
      <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" user={{ id: "u2" }} urlPattern="/a/*" />,
    );
    expect(api.identify).toHaveBeenCalledTimes(calls);
    rerender(
      <Pinwren projectKey="pk_2" endpoint="https://fb.example.com" user={{ id: "u2" }} urlPattern="/a/*" />,
    );
    expect(api.destroy).toHaveBeenCalledTimes(1);
    expect(api.init).toHaveBeenLastCalledWith(expect.objectContaining({ projectKey: "pk_2" }));
    unmount();
    expect(api.destroy).toHaveBeenCalledTimes(2);
  });

  it("survives StrictMode's mount → unmount → mount", () => {
    render(
      <StrictMode>
        <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" />
      </StrictMode>,
    );
    expect(api.init).toHaveBeenCalledTimes(2);
    expect(api.destroy).toHaveBeenCalledTimes(1);
  });

  it("calls the latest event props", () => {
    const first = vi.fn();
    const latest = vi.fn();
    const onError = vi.fn();
    const { rerender } = render(<Pinwren projectKey="pk_1" endpoint="https://x.example" onSubmit={first} />);
    rerender(<Pinwren projectKey="pk_1" endpoint="https://x.example" onSubmit={latest} onError={onError} />);
    act(() => {
      api.emit("submit", { id: "f1", number: 3, kind: "bug" });
      api.emit("error", { message: "nope" });
    });
    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith({ id: "f1", number: 3, kind: "bug" });
    expect(onError).toHaveBeenCalledWith({ message: "nope" });
  });
});

describe("usePinwren()", () => {
  it("controls the widget and reports when it is ready", () => {
    render(<Pinwren projectKey="pk_1" endpoint="https://x.example" />);
    const { result } = renderHook(() => usePinwren());
    expect(result.current.ready).toBe(false);
    act(() => {
      api.emit("ready");
    });
    expect(result.current.ready).toBe(true);
    result.current.open("bug");
    expect(api.open).toHaveBeenCalledWith("bug");
    result.current.close();
    expect(api.close).toHaveBeenCalled();
    result.current.identify({ id: "u3" }, { signature: SIG });
    expect(api.identify).toHaveBeenLastCalledWith({ id: "u3" }, { signature: SIG });
    const handler = vi.fn();
    const off = result.current.on("submit", handler);
    act(() => {
      api.emit("submit", { id: "f2", number: 4, kind: "comment" });
    });
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    act(() => {
      api.emit("submit", { id: "f3", number: 5, kind: "comment" });
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("before widget.js has loaded", () => {
  it("queues the calls and adds widget.js from the endpoint", () => {
    delete (window as unknown as { Pinwren?: unknown }).Pinwren;
    const added: HTMLScriptElement[] = [];
    vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
      added.push(...(nodes as HTMLScriptElement[]));
    });
    render(<Pinwren projectKey="pk_q" endpoint="https://fb.example.com/" nonce="n1" />);
    expect(added.map((s) => s.src)).toEqual(["https://fb.example.com/widget.js"]);
    expect(added[0]?.nonce).toBe("n1");
    const q = (window as unknown as { Pinwren: { q: unknown[][] } }).Pinwren.q;
    expect(q.map((c) => c[0])).toEqual(["on", "on", "on", "on", "on", "setPageScope", "identify", "init"]);
  });
});

describe("metadata and visibility (wave 5)", () => {
  it("sets metadata before init, by value, and shows or hides on demand", () => {
    const { rerender } = render(
      <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" metadata={{ plan: "pro" }} visible />,
    );
    expect(api.setMetadata).toHaveBeenCalledWith({ plan: "pro" });
    expect(api.show).toHaveBeenCalledTimes(1);
    const order = (fn: Fn) => fn.mock.invocationCallOrder[0] ?? 0;
    expect(order(api.setMetadata)).toBeLessThan(order(api.init));
    // A new object with the same content changes nothing.
    rerender(
      <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" metadata={{ plan: "pro" }} visible />,
    );
    expect(api.setMetadata).toHaveBeenCalledTimes(1);
    rerender(<Pinwren projectKey="pk_1" endpoint="https://fb.example.com" metadata={null} visible={false} />);
    expect(api.setMetadata).toHaveBeenLastCalledWith(null);
    expect(api.hide).toHaveBeenCalledTimes(1);
    expect(api.init).toHaveBeenCalledTimes(1);
  });

  it("exposes setMetadata, show and hide from usePinwren", () => {
    const { result } = renderHook(() => usePinwren());
    result.current.setMetadata({ a: 1 });
    result.current.show();
    result.current.hide();
    expect(api.setMetadata).toHaveBeenCalledWith({ a: 1 });
    expect(api.show).toHaveBeenCalled();
    expect(api.hide).toHaveBeenCalled();
  });
});
