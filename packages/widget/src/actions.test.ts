import { describe, expect, it } from "vitest";
import { actionHref, visitorActions } from "./actions";
import type { PanelAction } from "./config";

const vars = {
  id: "fb_1",
  number: 12,
  url: "https://lumen.example/shop?a=1&b=2#x",
  projectSlug: "lumen coffee",
};

describe("actionHref", () => {
  it("fills every placeholder, URL-encoded", () => {
    expect(
      actionHref("https://tickets.example/new?ref={id}&n={number}&page={url}&p={projectSlug}", vars),
    ).toBe(
      "https://tickets.example/new?ref=fb_1&n=12&page=https%3A%2F%2Flumen.example%2Fshop%3Fa%3D1%26b%3D2%23x&p=lumen%20coffee",
    );
    expect(actionHref("https://agent.example/{projectSlug}/{number}", vars)).toBe(
      "https://agent.example/lumen%20coffee/12",
    );
  });

  it("can't be used to break out of the parameter or change the host", () => {
    const evil = { ...vars, id: "x&admin=1#", projectSlug: "@evil.test/" };
    expect(actionHref("https://t.example/?id={id}", evil)).toBe("https://t.example/?id=x%26admin%3D1%23");
    expect(actionHref("https://{projectSlug}t.example/", evil)).toBeNull();
  });

  it("leaves unknown placeholders and rejects anything but http(s)", () => {
    expect(actionHref("https://t.example/{nope}", vars)).toBe("https://t.example/%7Bnope%7D");
    expect(actionHref("javascript:alert({id})", vars)).toBeNull();
    expect(actionHref("data:text/html,{id}", vars)).toBeNull();
    expect(actionHref("{url}", vars)).toBeNull(); // a whole-URL placeholder is encoded, so it isn't a URL
    expect(actionHref("not a url", vars)).toBeNull();
  });
});

describe("visitorActions", () => {
  const a = (kind: PanelAction["kind"], visibleTo: PanelAction["visibleTo"]): PanelAction => ({
    id: `${kind}-${visibleTo}`,
    label: "x",
    kind,
    url: "https://t.example",
    icon: null,
    visibleTo,
  });
  it("shows only links meant for everyone", () => {
    expect(
      visitorActions([
        a("link", "everyone"),
        a("link", "team"),
        a("webhook", "everyone"),
        a("webhook", "team"),
      ]).map((x) => x.id),
    ).toEqual(["link-everyone"]);
  });
});
