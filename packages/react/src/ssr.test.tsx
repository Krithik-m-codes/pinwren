// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Pinwren, usePinwren } from "./index";

function Probe() {
  const { ready } = usePinwren();
  return <span>{ready ? "ready" : "loading"}</span>;
}

describe("server-side rendering", () => {
  it("renders without a window and without side effects", () => {
    expect(typeof window).toBe("undefined");
    const html = renderToString(
      <>
        <Pinwren projectKey="pk_1" endpoint="https://fb.example.com" user={{ id: "1" }} />
        <Probe />
      </>,
    );
    expect(html).toBe("<span>loading</span>");
  });
});
