// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "./attachments";
import { annotate, closeAll, grid, pickArea, shotMenu } from "./shots";

const root = document.createElement("div");
document.body.append(root);
const att = (name: string, type = "image/png", size = 2048): Attachment => ({
  name,
  contentType: type,
  dataUrl: `data:${type};base64,QUJD`,
  size,
});
const key = (k: string, init: KeyboardEventInit = {}) =>
  document.body.dispatchEvent(
    new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }),
  );

/** The element under `scope` matching `sel`; a missing one fails the test with its selector. */
const q = (scope: ParentNode | null | undefined, sel: string): HTMLElement => {
  const el = scope?.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`no element matches ${sel}`);
  return el;
};

afterEach(() => {
  closeAll();
  root.replaceChildren();
});

describe("shotMenu", () => {
  const modes = ["visible", "full", "area", "element", "tab"] as const;
  it("opens a menu of the given modes and calls pick straight from the click", () => {
    const pick = vi.fn();
    const m = shotMenu(root, [...modes], pick);
    root.append(m.el);
    expect(m.el.getAttribute("aria-expanded")).toBe("false");
    m.el.click();
    expect(m.el.getAttribute("aria-expanded")).toBe("true");
    const items = [...root.querySelectorAll<HTMLElement>("[role=menuitem]")];
    expect(items.map((i) => i.textContent)).toEqual([
      "Visible area",
      "Full page",
      "Selected area",
      "Element",
      "This tab (browser capture)",
    ]);
    items[2]?.click();
    expect(pick).toHaveBeenCalledWith("area");
    expect(root.querySelector(".sh-menu")).toBeNull();
    expect(m.el.getAttribute("aria-expanded")).toBe("false");
  });

  it("Escape closes the menu without leaking the key to the page, arrows move through items", () => {
    const m = shotMenu(root, [...modes], vi.fn());
    root.append(m.el);
    m.el.click();
    const items = [...root.querySelectorAll<HTMLElement>("[role=menuitem]")];
    expect(document.activeElement).toBe(items[0]);
    key("ArrowDown");
    expect(document.activeElement).toBe(items[1]);
    key("End");
    expect(document.activeElement).toBe(items[4]);
    key("ArrowDown");
    expect(document.activeElement).toBe(items[0]);
    const leaked = vi.fn();
    document.addEventListener("keydown", leaked);
    key("Escape");
    document.removeEventListener("keydown", leaked);
    expect(leaked).not.toHaveBeenCalled();
    expect(root.querySelector(".sh-menu")).toBeNull();
    expect(document.activeElement).toBe(m.el);
  });

  it("closes on an outside press and when disabled", () => {
    const m = shotMenu(root, [...modes], vi.fn());
    root.append(m.el);
    m.el.click();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    expect(root.querySelector(".sh-menu")).toBeNull();
    m.el.click();
    m.setDisabled(true);
    expect(root.querySelector(".sh-menu")).toBeNull();
    expect(m.el.disabled).toBe(true);
  });
});

describe("pickArea", () => {
  const drag = (target: Element, from: [number, number], to: [number, number]) => {
    const ev = (type: string, [x, y]: [number, number]) =>
      target.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }),
      );
    ev("pointerdown", from);
    ev("pointermove", to);
    ev("pointerup", to);
  };

  it("resolves with the dragged box, whichever way it was dragged, and removes its overlay", async () => {
    const p = pickArea(root);
    const shield = q(root, ".sh-shield");
    expect(root.querySelector(".sh-hint")?.textContent).toContain("Drag to select an area");
    drag(shield, [200, 150], [100, 50]);
    await expect(p).resolves.toEqual({ left: 100, top: 50, width: 100, height: 100 });
    expect(root.querySelector(".sh-shield, .sh-hint")).toBeNull();
  });

  it("ignores a stray click and cancels on Escape", async () => {
    const p = pickArea(root);
    const shield = q(root, ".sh-shield");
    drag(shield, [10, 10], [12, 12]);
    expect(root.querySelector(".sh-shield")).not.toBeNull();
    key("Escape");
    await expect(p).resolves.toBeNull();
    expect(root.querySelector(".sh-shield")).toBeNull();
  });
});

describe("grid", () => {
  const hooks = () => ({
    remove: vi.fn(),
    annotate: vi.fn(),
    retake: { can: (a: Attachment) => a.name.startsWith("screenshot"), run: vi.fn() },
  });

  it("renders a card per attachment with name, size and the right actions", () => {
    const hk = hooks();
    const g = grid(root, hk);
    root.append(g.el);
    expect(g.el.hidden).toBe(true);
    const shot = att("screenshot-area.png", "image/png", 2048);
    const pdf = att("invoice.pdf", "application/pdf", 3 * 1024 * 1024);
    g.render([shot, pdf]);
    expect(g.el.hidden).toBe(false);
    const cards = [...g.el.querySelectorAll(".sh-card")];
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain("screenshot-area.png");
    expect(cards[0]?.textContent).toContain("2 KB");
    expect(cards[1]?.textContent).toContain("3.0 MB");
    expect(cards[0]?.querySelector('[aria-label="Annotate screenshot-area.png"]')).not.toBeNull();
    expect(cards[0]?.querySelector('[aria-label="Retake screenshot-area.png"]')).not.toBeNull();
    // a PDF has no preview, annotate or retake: only remove
    expect(cards[1]?.querySelector("button.sh-thumb")).toBeNull();
    expect(cards[1]?.querySelectorAll(".sh-acts button")).toHaveLength(1);
    q(cards[1], '[aria-label="Remove invoice.pdf"]').click();
    expect(hk.remove).toHaveBeenCalledWith(pdf);
    q(cards[0], '[aria-label="Annotate screenshot-area.png"]').click();
    expect(hk.annotate).toHaveBeenCalledWith(shot);
  });

  it("reuses a card (and its decoded picture) across renders", () => {
    const g = grid(root, hooks());
    const a = att("a.png");
    g.render([a]);
    const first = g.el.firstElementChild;
    g.render([a, att("b.png")]);
    expect(g.el.firstElementChild).toBe(first);
    expect(g.el.children).toHaveLength(2);
  });

  it("shows a loading skeleton until the image loads, and an error state when it cannot", () => {
    const g = grid(root, hooks());
    g.render([att("a.png"), att("b.png")]);
    const [a, b] = [...g.el.querySelectorAll<HTMLElement>(".sh-card")];
    expect(a?.querySelector(".sh-skel")).not.toBeNull();
    expect(a?.classList.contains("loaded")).toBe(false);
    a?.querySelector("img")?.dispatchEvent(new Event("load"));
    expect(a?.classList.contains("loaded")).toBe(true);
    b?.querySelector("img")?.dispatchEvent(new Event("error"));
    expect(b?.classList.contains("failed")).toBe(true);
    expect(b?.textContent).toContain("This image couldn't be shown");
  });
});

describe("lightbox", () => {
  const open = (list: Attachment[], at = 0, hk = { remove: vi.fn(), annotate: vi.fn() }) => {
    const g = grid(root, hk);
    root.append(g.el);
    g.render(list);
    g.el.querySelectorAll<HTMLElement>("button.sh-thumb").item(at).click();
    return { hk, box: () => root.querySelector<HTMLElement>(".sh-lb") };
  };

  it("opens as a labelled modal dialog and closes on Escape and on the close button", () => {
    const { box } = open([att("a.png")]);
    const lb = box();
    expect(lb?.getAttribute("role")).toBe("dialog");
    expect(lb?.getAttribute("aria-modal")).toBe("true");
    expect(lb?.getAttribute("aria-label")).toBe("Preview a.png");
    expect(lb?.textContent).toContain("2 KB");
    key("Escape");
    expect(box()).toBeNull();
    const again = open([att("a.png")]);
    q(again.box(), '[aria-label="Close preview"]').click();
    expect(again.box()).toBeNull();
  });

  it("starts at the fitted size and offers zoom controls", () => {
    const { box } = open([att("a.png")]);
    const img = q(box(), "img") as HTMLImageElement;
    Object.defineProperty(img, "naturalWidth", { value: 400 });
    Object.defineProperty(img, "naturalHeight", { value: 300 });
    img.dispatchEvent(new Event("load"));
    // happy-dom has no layout, so the stage is 0x0 and the fit falls back to 100%
    expect(box()?.querySelector(".sh-zoom")?.textContent).toBe("100%");
    expect(img.style.width).toBe("400px");
    for (const label of ["Zoom in", "Zoom out", "Fit to window", "Actual size"])
      expect(box()?.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
  });

  it("steps between images with the arrow keys and buttons, wrapping around", () => {
    const { box } = open([att("a.png"), att("b.png"), att("c.png")]);
    const title = () => box()?.querySelector(".sh-title")?.textContent;
    expect(title()).toContain("a.png");
    expect(title()).toContain("1 of 3");
    key("ArrowRight");
    expect(title()).toContain("b.png");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(title()).toContain("c.png");
    q(box(), '[aria-label="Next image"]').click();
    expect(title()).toContain("a.png");
  });

  it("runs annotate and remove for the image on show, after closing", () => {
    const { box, hk } = open([att("a.png"), att("b.png")], 1);
    q(box(), '[aria-label="Annotate b.png"]').click();
    expect(box()).toBeNull();
    expect(hk.annotate).toHaveBeenCalledWith(expect.objectContaining({ name: "b.png" }));
    const second = open([att("a.png"), att("b.png")], 0, hk);
    q(second.box(), '[aria-label="Remove a.png"]').click();
    expect(hk.remove).toHaveBeenCalledWith(expect.objectContaining({ name: "a.png" }));
  });

  it("shows an error state for a picture that will not decode", () => {
    const { box } = open([att("a.png")]);
    box()?.querySelector("img")?.dispatchEvent(new Event("error"));
    const fail = box()?.querySelector<HTMLElement>(".sh-stage .sh-ph");
    expect(fail?.hidden).toBe(false);
    expect(fail?.textContent).toContain("couldn't be shown");
  });
});

describe("annotate", () => {
  class FakeEditor {
    el = document.createElement("div");
    tool = "rect";
    color = "#e5484d";
    canUndo = false;
    canRedo = false;
    count = 0;
    onChange: (() => void) | null = null;
    setTool = vi.fn();
    setColor = vi.fn();
    undo = vi.fn();
    redo = vi.fn();
    key = vi.fn(() => false);
    export = () => "data:image/png;base64,QUJD";
    destroy() {
      this.el.remove();
    }
  }
  const canvas = () => {
    const c = document.createElement("canvas");
    c.width = 10;
    c.height = 10;
    return c;
  };

  it("resolves unchanged when nothing was drawn, and cancels with Escape", async () => {
    const c = canvas();
    const p = annotate(root, FakeEditor as never, c, "Attach");
    await Promise.resolve();
    const dlg = root.querySelector(".sh-ann");
    expect(dlg?.getAttribute("role")).toBe("dialog");
    (
      [...(dlg?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Attach") as HTMLElement
    ).click();
    await expect(p).resolves.toEqual({ canvas: c, changed: false });
    expect(root.querySelector(".sh-ann")).toBeNull();

    const p2 = annotate(root, FakeEditor as never, c);
    await Promise.resolve();
    key("Escape");
    await expect(p2).resolves.toBeNull();
    expect(root.querySelector(".sh-ann")).toBeNull();
  });

  it("offers every tool, passes keys the editor handles to it only, and unhandled keys through", async () => {
    const p = annotate(root, FakeEditor as never, canvas());
    await Promise.resolve();
    expect(root.querySelectorAll(".sh-ann .tgroup:first-child .tb")).toHaveLength(8);
    const leaked = vi.fn();
    document.addEventListener("keydown", leaked);
    key("r"); // the fake editor declines it, so it carries on as normal
    expect(leaked).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", leaked);
    closeAll();
    await expect(p).resolves.toBeNull();
  });
});
