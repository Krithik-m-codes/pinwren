import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// "Record screen" in the bug report (ADR 0029). getDisplayMedia is replaced by a canvas stream (and
// getUserMedia by a WebAudio tone), but the recorder is the browser's own MediaRecorder, so the bytes sent are
// a real WebM. Headless Chromium has no Document Picture-in-Picture, so these tests exercise the
// controls-in-the-corner path; the PiP path is covered by the unit tests with a fake window.

const report = (page: Page) => page.getByRole("dialog", { name: "Report a bug" });
const setup = (page: Page) => page.getByRole("dialog", { name: "Record your screen" });
const review = (page: Page) => page.getByRole("dialog", { name: "Review your recording" });
const zone = (page: Page) => page.locator("pinwren-root .rc-zone");
const bar = (page: Page) => page.locator("pinwren-root .rc-bar");

const ON = { recording: { enabled: true, maxSeconds: 120, microphone: true } };

type Win = { __stopped: number; __display: number; __mic: number };

async function fakeMedia(page: Page, opts: { display?: "ok" | "denied"; mic?: "ok" | "denied" } = {}) {
  await page.addInitScript((o) => {
    const w = window as unknown as Win;
    w.__stopped = 0;
    w.__display = 0;
    w.__mic = 0;
    // Chromium has Document PiP; a headless run can't open one, so make the corner path deterministic.
    delete (window as unknown as { documentPictureInPicture?: unknown }).documentPictureInPicture;
    const count = (stream: MediaStream, onStop?: () => void) => {
      for (const t of stream.getTracks()) {
        const stop = t.stop.bind(t);
        t.stop = () => {
          w.__stopped++;
          onStop?.();
          stop();
        };
      }
      return stream;
    };
    navigator.mediaDevices.getDisplayMedia = () => {
      w.__display++;
      if (o.display === "denied")
        return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      const c = document.createElement("canvas");
      c.width = 640;
      c.height = 400;
      const x = c.getContext("2d");
      if (!x) throw new Error("no 2D canvas");
      let n = 0;
      const paint = () => {
        x.fillStyle = `hsl(${(n += 7) % 360} 80% 50%)`;
        x.fillRect(0, 0, 640, 400);
      };
      const timer = setInterval(paint, 40);
      return Promise.resolve(count(c.captureStream(25), () => clearInterval(timer)));
    };
    navigator.mediaDevices.getUserMedia = () => {
      w.__mic++;
      if (o.mic === "denied") return Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return Promise.resolve(count(dest.stream, () => void ctx.close()));
    };
  }, opts);
}

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
}

async function openReport(page: Page) {
  await page.locator("pinwren-root .launcher").click();
  await page.getByRole("menuitem", { name: /Report a bug/ }).click();
  await expect(report(page)).toBeVisible();
  await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeEnabled();
}

/** Press Start in the notice dialog and wait for the 3-2-1 to finish: the recorder is running afterwards. */
async function begin(page: Page, withMic = false) {
  await report(page).getByRole("button", { name: "Record screen" }).click();
  await expect(setup(page)).toBeVisible();
  if (withMic) await setup(page).getByRole("switch", { name: "Add voice narration" }).click();
  await setup(page).getByRole("button", { name: "Start recording" }).click();
  await expect(zone(page)).toBeAttached({ timeout: 8000 });
}

const stopFromCorner = async (page: Page) => {
  await zone(page).hover();
  await bar(page).getByRole("button", { name: "Stop recording" }).click();
};

type Sent = {
  recording?: { dataUrl: string; durationMs: number; audio: boolean; width?: number; height?: number };
  attachments?: unknown[];
};

test("records the tab, reviews it and sends it with the report", async ({ page }) => {
  await fakeMedia(page);
  const mock = await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);

  await report(page).getByRole("button", { name: "Record screen" }).click();
  // The notice comes first, and nothing has been asked of the browser yet.
  await expect(setup(page)).toContainText("anything visible on it is included");
  await expect(setup(page)).toContainText("Maximum length: 2:00");
  expect(await page.evaluate(() => (window as unknown as Win).__display)).toBe(0);
  await page.screenshot({ path: "test-results/record-setup.png" });
  await setup(page).getByRole("button", { name: "Start recording" }).click();

  // The countdown covers the page; the report is out of the picture before the first frame.
  await expect(page.locator("pinwren-root .rc-count")).toContainText("Recording starts in");
  await expect(report(page)).toBeHidden();
  await expect(zone(page)).toBeAttached({ timeout: 8000 });
  await expect(report(page)).toBeHidden();
  await expect(page.locator("pinwren-root .launcher")).toBeHidden();
  // The corner is invisible until the pointer is in it.
  await expect(bar(page)).toHaveCSS("opacity", "0");
  await zone(page).hover();
  await expect(bar(page)).toHaveCSS("opacity", "1");
  await expect(bar(page).locator(".rc-state")).toHaveText("Recording");
  await expect(bar(page).locator(".rc-time")).toHaveText(/^0:0[1-9] of 2:00$/, { timeout: 5000 });

  await bar(page).getByRole("button", { name: "Stop recording" }).click();
  await expect(review(page)).toBeVisible();
  await expect(report(page)).toBeVisible();
  const video = review(page).locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/record-review.png" });
  // Every track was released when recording stopped.
  expect(await page.evaluate(() => (window as unknown as Win).__stopped)).toBeGreaterThanOrEqual(1);

  await review(page).getByRole("button", { name: "Attach recording" }).click();
  await expect(review(page)).toBeHidden();
  await expect(report(page).locator(".rc-row")).toContainText(/Screen recording · 0:0\d/);

  await report(page).getByLabel("Describe the bug").fill("The chart flickers when I scroll");
  await report(page).getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => mock.items.length).toBe(1);

  const sent = mock.items[0]?.payload as Sent;
  expect(sent.recording).toBeDefined();
  if (!sent.recording) throw new Error("no recording sent");
  const rec = sent.recording;
  expect(rec.dataUrl.startsWith("data:video/webm;base64,")).toBe(true);
  // A real WebM: the EBML signature the server checks.
  const head = Buffer.from(
    rec.dataUrl.slice(rec.dataUrl.indexOf(",") + 1, rec.dataUrl.indexOf(",") + 9),
    "base64",
  );
  expect([...head.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(rec.durationMs).toBeGreaterThan(500);
  expect(rec.audio).toBe(false);
  expect(rec.width).toBeGreaterThan(0);
  // A recording is not one of the three file attachments.
  expect(sent.attachments ?? []).toHaveLength(0);
});

test("adds voice narration when asked and the microphone is allowed", async ({ page }) => {
  await fakeMedia(page);
  const mock = await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await begin(page, true);
  expect(await page.evaluate(() => (window as unknown as Win).__mic)).toBe(1);
  await page.waitForTimeout(1200);
  await stopFromCorner(page);
  await expect(review(page)).toBeVisible();
  await expect(review(page)).toContainText("with voice");
  await review(page).getByRole("button", { name: "Attach recording" }).click();
  await expect(report(page).locator(".rc-row")).toContainText("with voice");
  await report(page).getByLabel("Describe the bug").fill("Sound check");
  await report(page).getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  expect((mock.items[0]?.payload as Sent).recording?.audio).toBe(true);
  // The microphone track was stopped too (display + mic + the audio context's stream).
  expect(await page.evaluate(() => (window as unknown as Win).__stopped)).toBeGreaterThanOrEqual(2);
});

test("carries on without sound when the microphone is refused", async ({ page }) => {
  await fakeMedia(page, { mic: "denied" });
  await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await begin(page, true);
  await page.waitForTimeout(1200);
  await stopFromCorner(page);
  await expect(review(page)).toContainText("microphone isn't available");
});

test("explains a refused screen share and lets the person try again", async ({ page }) => {
  await fakeMedia(page, { display: "denied" });
  const mock = await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await report(page).getByRole("button", { name: "Record screen" }).click();
  await setup(page).getByRole("button", { name: "Start recording" }).click();
  await expect(setup(page).getByRole("alert")).toContainText("cancelled or blocked");
  await expect(setup(page).getByRole("button", { name: "Start recording" })).toBeEnabled();
  // The report was never hidden, and nothing is attached.
  await expect(page.locator("pinwren-root .rc-row")).toBeHidden();
  await setup(page).getByRole("button", { name: "Cancel" }).click();
  await expect(setup(page)).toBeHidden();
  expect(mock.items).toHaveLength(0);
});

test("stops by itself at the project's maximum length", async ({ page }) => {
  test.setTimeout(45_000);
  await fakeMedia(page);
  await mockApi(page, { capture: { recording: { enabled: true, maxSeconds: 10, microphone: false } } });
  await ready(page);
  await openReport(page);
  await report(page).getByRole("button", { name: "Record screen" }).click();
  // No narration switch when the project turned the microphone off.
  await expect(setup(page).getByRole("switch")).toHaveCount(0);
  await setup(page).getByRole("button", { name: "Start recording" }).click();
  await expect(review(page)).toBeVisible({ timeout: 25_000 });
  await expect(review(page)).toContainText("reached the maximum length (0:10)");
  await expect(review(page)).toContainText(/0:1[01]|0:09/);
});

test("pauses and resumes, and Alt+Shift+S stops with the controls out of sight", async ({ page }) => {
  await fakeMedia(page);
  await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await begin(page);
  await zone(page).hover();
  await bar(page).getByRole("button", { name: "Pause recording" }).click();
  await expect(bar(page).locator(".rc-state")).toHaveText("Paused");
  await bar(page).getByRole("button", { name: "Resume recording" }).click();
  await expect(bar(page).locator(".rc-state")).toHaveText("Recording");
  await page.waitForTimeout(800);
  await page.mouse.move(600, 300); // away from the corner
  await page.keyboard.press("Alt+Shift+S");
  await expect(review(page)).toBeVisible();
});

test("retake and discard leave nothing attached and release the clip", async ({ page }) => {
  await fakeMedia(page);
  const mock = await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await begin(page);
  await page.waitForTimeout(1000);
  await stopFromCorner(page);
  await review(page).getByRole("button", { name: "Discard" }).click();
  await expect(review(page)).toBeHidden();
  await expect(report(page).locator(".rc-row")).toBeHidden();
  await report(page).getByLabel("Describe the bug").fill("No clip");
  await report(page).getByRole("button", { name: /^Send/ }).click();
  await expect.poll(() => mock.items.length).toBe(1);
  expect((mock.items[0]?.payload as Sent).recording).toBeUndefined();
});

test("closing the report mid-recording stops the capture", async ({ page }) => {
  await fakeMedia(page);
  await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await begin(page);
  const before = await page.evaluate(() => (window as unknown as Win).__stopped);
  await page.evaluate(() => (window as unknown as { Pinwren: { destroy(): void } }).Pinwren.destroy());
  expect(await page.evaluate(() => (window as unknown as Win).__stopped)).toBeGreaterThan(before);
});

test.describe("not offered", () => {
  test("when the project turned recordings off", async ({ page }) => {
    await fakeMedia(page);
    await mockApi(page, { capture: { recording: { enabled: false, maxSeconds: 120, microphone: true } } });
    await ready(page);
    await openReport(page);
    await expect(report(page).getByRole("button", { name: "Add screenshot" })).toBeVisible();
    await expect(report(page).getByRole("button", { name: "Record screen" })).toHaveCount(0);
  });
  test("by an older server that doesn't know about recordings", async ({ page }) => {
    await fakeMedia(page);
    await mockApi(page);
    await ready(page);
    await openReport(page);
    await expect(report(page).getByRole("button", { name: "Record screen" })).toHaveCount(0);
  });
  test("without downloading the recording code", async ({ page }) => {
    await fakeMedia(page);
    const chunks: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("widget-record.")) chunks.push(r.url());
    });
    await mockApi(page);
    await ready(page);
    await openReport(page);
    expect(chunks).toEqual([]);
  });
});

test("shows the unsupported message where the browser can't capture the screen", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });
  await mockApi(page, { capture: ON });
  await ready(page);
  await openReport(page);
  await report(page).getByRole("button", { name: "Record screen" }).click();
  await expect(setup(page)).toContainText("can't record the screen");
  await expect(setup(page).getByRole("button", { name: "Start recording" })).toBeDisabled();
});
