// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, type WidgetConfig } from "./config";
import { Fab, type FabActions, type FabHost } from "./fab";

function setup(actions: Partial<FabActions> = {}, launcher: Partial<WidgetConfig["launcher"]> = {}) {
  const root = document.body.appendChild(document.createElement("div"));
  const all: FabActions = {
    markers: { shown: true, toggle: vi.fn() },
    annotate: vi.fn(),
    bug: { draft: false, run: vi.fn() },
    sidebar: { open: 3, run: vi.fn() },
    queued: null,
    ...actions,
  };
  const host: FabHost = {
    root,
    host: root,
    cfg: { ...DEFAULT_CONFIG, launcher: { ...DEFAULT_CONFIG.launcher, ...launcher } },
    poweredBy: true,
    actions: () => all,
    press: vi.fn(),
    prefetch: vi.fn(),
    opened: vi.fn(),
    closed: vi.fn(),
  };
  const fab = new Fab(host);
  return { fab, host, all, root };
}

const items = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>(".dial .act")).map(
    (b) => b.querySelector(".lbl")?.firstChild?.textContent,
  );

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("speed-dial launcher", () => {
  it("is a menu button with the open count", () => {
    const { fab, host } = setup();
    expect(fab.button?.getAttribute("aria-haspopup")).toBe("menu");
    expect(fab.button?.getAttribute("aria-expanded")).toBe("false");
    fab.setCount(7);
    expect(fab.badge.hidden).toBe(false);
    expect(fab.badge.textContent).toBe("7");
    fab.setCount(0);
    expect(fab.badge.hidden).toBe(true);
    fab.setCount(250);
    expect(fab.badge.textContent).toBe("99+");
    fab.button?.click();
    expect(host.press).toHaveBeenCalled();
  });

  it("applies light and dark launcher colors and supports disabling hover motion", () => {
    const { fab } = setup(
      {},
      { accent: "#123456", lightAccent: "#abcdef", darkAccent: "#fedcba", hoverEffect: false },
    );
    expect(fab.button?.style.getPropertyValue("--launcher-light")).toBe("#abcdef");
    expect(fab.button?.style.getPropertyValue("--launcher-dark")).toBe("#fedcba");
    expect(fab.button?.classList.contains("no-hover")).toBe(true);
  });

  it("fans out labelled actions and focuses the first", () => {
    const { fab, root, host } = setup();
    fab.open();
    expect(fab.button?.getAttribute("aria-expanded")).toBe("true");
    expect(items(root)).toEqual(["Hide markers", "Create new annotation", "Report a bug", "Show sidebar"]);
    const eye = root.querySelector(".dial [role=menuitemcheckbox]");
    expect(eye?.getAttribute("aria-checked")).toBe("true");
    expect(root.querySelector(".dial .ac")?.textContent).toBe("3");
    expect(document.activeElement).toBe(root.querySelector(".dial .act"));
    expect(root.querySelector(".dial .pw")?.textContent).toBe("Powered by Pinwren");
    expect(host.opened).toHaveBeenCalled();
  });

  it("leaves out what the visitor can't do and labels hidden markers", () => {
    const { fab, root } = setup({ bug: null, annotate: null, markers: { shown: false, toggle: vi.fn() } });
    fab.open();
    expect(items(root)).toEqual(["Show markers", "Show sidebar"]);
    expect(root.querySelector("[role=menuitemcheckbox]")?.getAttribute("aria-checked")).toBe("false");
  });

  it("runs an action and moves with the arrow keys", () => {
    const { fab, root, all } = setup();
    fab.open();
    const acts = Array.from(root.querySelectorAll<HTMLElement>(".dial .act"));
    acts[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(document.activeElement).toBe(acts[1]);
    acts[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(acts[3]);
    acts[1]?.click();
    expect(all.annotate).toHaveBeenCalled();
  });

  it("closes back onto the launcher", () => {
    const { fab, root, host } = setup();
    fab.open();
    fab.close();
    expect(root.querySelector(".dial")).toBeNull();
    expect(fab.button?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(fab.button);
    expect(host.closed).toHaveBeenCalled();
  });

  it("still opens its actions with a hidden launcher", () => {
    const { fab, root } = setup({}, { hidden: true });
    expect(fab.button).toBeNull();
    fab.open();
    expect(items(root)).toHaveLength(4);
  });
});
