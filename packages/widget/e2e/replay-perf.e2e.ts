import { expect, type Page, test } from "@playwright/test";
import { mockApi } from "./mock";

// Main-thread cost of session replay (wave-4 §3) on the fixture page: the same scripted 5 s of activity
// (DOM mutations, scrolling, typing, mouse movement) with replay off and on, measured with Chrome's
// Performance.getMetrics (TaskDuration = main-thread busy time, ScriptDuration = JS). The difference is
// what rrweb + the buffer cost. Logged as test annotations; the assertion only catches a gross regression.

const WORK_MS = 5000;

async function busy(page: Page, replay: boolean) {
  await mockApi(page, { capture: { replay: { enabled: replay, seconds: 60 } } });
  await page.goto("/");
  await expect(page.locator("pinwren-root .launcher")).toBeVisible();
  if (replay) await expect.poll(() => page.evaluate(() => "__pinwrenReplay" in window)).toBe(true);
  await page.waitForTimeout(800); // let the first full snapshot and idle work settle
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const read = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
    return { task: (m.TaskDuration ?? 0) * 1000, script: (m.ScriptDuration ?? 0) * 1000 };
  };
  const before = await read();
  const mouse = (async () => {
    for (let i = 0; i < 120; i++) await page.mouse.move(100 + ((i * 37) % 1000), 100 + ((i * 53) % 600));
  })();
  await page.evaluate(async (ms) => {
    const end = performance.now() + ms;
    const box = document.createElement("section");
    document.body.append(box);
    const input = document.getElementById("email") as HTMLInputElement;
    let i = 0;
    while (performance.now() < end) {
      const card = document.createElement("article");
      card.innerHTML = `<h3>Item ${i}</h3><p>Generated row <b>${i}</b> with some text</p>`;
      box.append(card);
      if (box.children.length > 40) box.firstElementChild?.remove();
      if (i % 3 === 0) scrollTo(0, (i * 13) % 900);
      if (i % 5 === 0) {
        input.value = `typing ${i}`;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      i++;
      await new Promise((r) => setTimeout(r, 16));
    }
  }, WORK_MS);
  await mouse;
  const after = await read();
  await cdp.detach();
  return { task: after.task - before.task, script: after.script - before.script };
}

test("session replay CPU overhead on the fixture page", async ({ browser }) => {
  test.setTimeout(60_000);
  const runs: { off: Awaited<ReturnType<typeof busy>>; on: Awaited<ReturnType<typeof busy>> }[] = [];
  for (let i = 0; i < 2; i++) {
    const a = await browser.newPage();
    const off = await busy(a, false);
    await a.close();
    const b = await browser.newPage();
    const on = await busy(b, true);
    await b.close();
    runs.push({ off, on });
  }
  const avg = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / runs.length;
  const off = avg((r) => r.off.task);
  const on = avg((r) => r.on.task);
  const perSec = (on - off) / (WORK_MS / 1000);
  const summary =
    `main-thread busy over ${WORK_MS / 1000} s: replay off ${off.toFixed(0)} ms, on ${on.toFixed(0)} ms → ` +
    `+${perSec.toFixed(1)} ms per second (${((perSec / 1000) * 100).toFixed(2)} % of one core); ` +
    `script time off ${avg((r) => r.off.script).toFixed(0)} ms, on ${avg((r) => r.on.script).toFixed(0)} ms`;
  test.info().annotations.push({ type: "replay-cpu", description: summary });
  console.log(`[replay-cpu] ${summary}`);
  expect(perSec).toBeLessThan(150);
});
