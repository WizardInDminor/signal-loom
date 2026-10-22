import { expect, test, type Page } from "@playwright/test";

// Session 5: the first playable whole-rig instrument, on the virtual transport. A named Texture
// moves two simulated pedals through opposite ranges from one macro with a tempo-related LFO;
// preview sends nothing; connect → arm → Start is explicit; the stream is budgeted; Stop ends it
// and nothing follows; the idea reloads; a second tab cannot hijack; the planner stays untouched.
//
// The live service is one per backend process, so these scenarios run serially.
test.describe.configure({ mode: "serial" });

const created: string[] = [];
const ARM = "send MIDI to my rig";

async function createUndertow(page: Page, name = `E2E Undertow ${Date.now()}`) {
  const res = await page.request.post("/api/rigs", { data: { name, template: "virtual_instrument" } });
  expect(res.ok()).toBeTruthy();
  const rig = await res.json();
  created.push(rig.id);
  return rig.id as string;
}

async function openInstrument(page: Page, rigId: string) {
  await page.goto(`/rigs/${rigId}#instrument`);
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
}

async function sentOrQueued(page: Page, rigId: string) {
  const ev = await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json();
  return ev.log.filter((e: { kind: string }) => e.kind === "sent" || e.kind === "queued").length as number;
}

async function performance(page: Page) {
  return (await (await page.request.get("/api/live/perform/status")).json()) as { state: string; counters: { ticks: number; handed: number; deferred: number }; destinations: { last_commanded: number | null; handed: number }[] };
}

test.afterEach(async ({ page }) => {
  await page.request.post("/api/live/perform/stop");
  await page.request.post("/api/live/disconnect");
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

test("instrument: the Undertow journey — preview without sends, two opposite destinations, tempo and depth, connect, arm, Start, bounded virtual changes, Stop, save and reload", async ({ page }) => {
  // The demo is created on purpose from the rig library, never seeded.
  await page.goto("/");
  await page.getByPlaceholder("e.g. Sunday board").fill("E2E Undertow from library");
  await page.getByTestId("new-rig-instrument-demo").check();
  await page.getByRole("button", { name: "Create rig" }).click();
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  const rigId = page.url().match(/rigs\/([^#?]+)/)![1];
  created.push(rigId);

  // What am I playing: the texture, its intent, the synthetic label, its starting scene and tempo.
  await expect(page.getByTestId("texture-name")).toHaveValue("Undertow");
  await expect(page.getByTestId("texture-header")).toContainText("synthetic demo");
  await expect(page.getByTestId("texture-scene")).toHaveValue("scene_undertow_start");
  await expect(page.getByTestId("texture-bpm")).toHaveValue("72");
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "preview");
  // What does it move: two destinations on two different pedals, grouped by function, opposite ranges.
  await expect(page.getByTestId("function-group-drive")).toContainText("Virtual Pedal A");
  await expect(page.getByTestId("function-group-delay")).toContainText("Virtual Pedal B");
  const mapA = page.getByTestId("mapping-map_bloom_a");
  const mapB = page.getByTestId("mapping-map_bloom_b");
  await expect(mapA).toContainText("inverse");
  await expect(mapA).toContainText("synthetic (simulation only)");
  await expect(mapA).toHaveAttribute("data-eligible", "true");
  await expect(mapA).toContainText("macro 0 → 100");
  await expect(mapA).toContainText("1 → 30");
  await expect(mapB).toContainText("rises with the macro");
  await expect(mapB).toContainText("macro 0 → 15");
  await expect(mapB).toContainText("1 → 110");
  // Move the macro by keyboard with the LFO off: the two values move in opposite directions.
  await page.getByTestId("lfo-enabled-macro_bloom").uncheck();
  const slider = page.getByTestId("macro-slider-macro_bloom");
  await slider.focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("macro-effective-macro_bloom")).toHaveText("effective 100%");
  await expect(page.getByTestId("mapping-value-map_bloom_a")).toHaveText("30");
  await expect(page.getByTestId("mapping-value-map_bloom_b")).toHaveText("110");
  await page.keyboard.press("Home");
  await expect(page.getByTestId("mapping-value-map_bloom_a")).toHaveText("100");
  await expect(page.getByTestId("mapping-value-map_bloom_b")).toHaveText("15");
  // Tempo and modulation depth are authored settings; the LFO readout follows them.
  await page.getByTestId("texture-bpm").fill("120");
  await page.getByTestId("lfo-enabled-macro_bloom").check();
  await page.getByTestId("lfo-beats-macro_bloom").selectOption("4");
  await expect(page.getByTestId("lfo-readout-macro_bloom")).toContainText("period 2.00 s");
  const depth = page.getByTestId("lfo-depth-macro_bloom");
  await depth.focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("texture-header")).toContainText("Depth 100%");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  // All of that transmitted nothing, and the engine is idle.
  expect(await sentOrQueued(page, rigId)).toBe(0);
  expect((await performance(page)).state).not.toBe("performing");

  // Connect the simulation (binds the simulated USB endpoints as part of the click), then arm.
  await page.getByTestId("perf-connect").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "disarmed");
  await expect(mapA).toContainText("route supported");
  await page.getByTestId("perf-arm").click();
  await page.getByLabel("Arm confirmation phrase").fill("please");
  await page.getByTestId("perf-arm-confirm").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "disarmed");
  await page.getByLabel("Arm confirmation phrase").fill(ARM);
  await page.getByTestId("perf-arm-confirm").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
  await expect(page.getByTestId("rig-armed-badge")).toBeVisible();
  // Armed is not performing: still nothing sent, Start is a separate gesture.
  await page.waitForTimeout(400);
  expect(await sentOrQueued(page, rigId)).toBe(0);
  const start = page.getByTestId("perf-start");
  await expect(start).toBeEnabled({ timeout: 10_000 });
  await start.click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "performing");
  await expect(page.getByTestId("rig-performing-badge")).toBeVisible();
  await expect(page.getByTestId("perf-lease")).toContainText("this tab controls");
  await expect(page.getByTestId("perf-state")).toHaveText("performing");
  // Bounded virtual changes: both simulated pedals receive values inside their ranges, moving in
  // opposite directions for one effective value; never more than the budget per tick.
  await page.waitForTimeout(1200);
  const perf = await performance(page);
  expect(perf.counters.ticks).toBeGreaterThanOrEqual(5);
  expect(perf.counters.handed).toBeLessThanOrEqual(2 * perf.counters.ticks);
  for (const d of perf.destinations) expect(d.handed).toBeLessThanOrEqual(perf.counters.ticks);
  const sim = (await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json()).simulated;
  const va = sim.inst_vpedal_a.cc["21"];
  const vb = sim.inst_vpedal_b.cc["22"];
  expect(va).toBeGreaterThanOrEqual(30);
  expect(va).toBeLessThanOrEqual(100);
  expect(vb).toBeGreaterThanOrEqual(15);
  expect(vb).toBeLessThanOrEqual(110);
  expect(Math.abs((100 - va) / 70 - (vb - 15) / 95)).toBeLessThan(0.03);
  await expect(page.getByTestId("perf-last-map_bloom_a")).not.toHaveText("—");
  await expect(page.getByText("routing is locked while performing")).toBeVisible();
  // Moving the macro while performing follows the hand: with the LFO off and the macro at 1, the
  // pedals settle at 30 and 110 and then nothing more is sent (deduplicated).
  await page.getByTestId("lfo-enabled-macro_bloom").uncheck();
  await slider.focus();
  await page.keyboard.press("End");
  await expect.poll(async () => (await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json()).simulated.inst_vpedal_a.cc["21"], { timeout: 5000 }).toBe(30);
  await expect.poll(async () => (await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json()).simulated.inst_vpedal_b.cc["22"]).toBe(110);
  const handedSettled = (await performance(page)).counters.handed;
  await page.waitForTimeout(500);
  expect((await performance(page)).counters.handed).toBe(handedSettled);
  // Stop: the state says so, the reason is shown, and no further value is handed afterwards.
  await page.getByTestId("perf-stop").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
  await expect(page.getByTestId("perf-ended")).toContainText("STOPPED (user)");
  await expect(page.getByTestId("perf-ended")).toContainText("not undone");
  const handedAtStop = (await performance(page)).counters.handed;
  await page.waitForTimeout(600);
  const after = await performance(page);
  expect(after.state).toBe("stopped");
  expect(after.counters.handed).toBe(handedAtStop);
  await expect(page.getByTestId("rig-performing-badge")).toHaveCount(0);
  // The authored idea is saved and comes back identical after a reload; the performance's runtime
  // values were never written into it.
  await page.getByTestId("texture-name").fill("Undertow (evening)");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("texture-name")).toHaveValue("Undertow (evening)");
  await expect(page.getByTestId("texture-bpm")).toHaveValue("120");
  await expect(page.getByTestId("texture-header")).toContainText("Depth 100%");
  await expect(page.getByTestId("macro-effective-macro_bloom")).toHaveText("effective 100%");
  const saved = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(saved.textures[0].macros[0].base).toBe(1);
  expect(saved.textures[0].macros[0].mappings.map((m: { output_min: number; output_max: number }) => [m.output_min, m.output_max])).toEqual([[100, 30], [15, 110]]);
  // The reload re-armed nothing by itself; the backend kept its armed state, nothing is performing.
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
  expect((await performance(page)).state).toBe("stopped");
  // Stage and Scenes are unaffected; the starting scene still exists untouched.
  await page.getByRole("tab", { name: "stage" }).click();
  await expect(page.getByTestId("stage-canvas")).toBeVisible();
  await page.getByRole("tab", { name: "scenes" }).click();
  await expect(page.getByRole("button", { name: /^Undertow start/ })).toBeVisible();
  expect(saved.scenes).toHaveLength(1);
  expect(saved.scenes[0].device_states.map((d: { program: { pc: number } }) => d.program.pc)).toEqual([0, 1]);
  await page.getByRole("tab", { name: "instrument" }).click();
  await page.getByTestId("perf-disarm").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "disarmed");
});

test("instrument: safety — a second tab cannot take over but can Stop; disarm stops; the lease stops a tab that stops heartbeating; nothing starts on reload", async ({ page, browser }) => {
  const rigId = await createUndertow(page);
  await openInstrument(page, rigId);
  await page.getByTestId("perf-connect").click();
  await page.getByTestId("perf-arm").click();
  await page.getByLabel("Arm confirmation phrase").fill(ARM);
  await page.getByTestId("perf-arm-confirm").click();
  await expect(page.getByTestId("perf-start")).toBeEnabled({ timeout: 10_000 });
  await page.getByTestId("perf-start").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "performing");
  // A second tab sees the performance, is told it is controlled elsewhere, cannot start another, may stop.
  const other = await browser.newPage();
  await openInstrument(other, rigId);
  await expect(other.getByTestId("instrument-state")).toHaveAttribute("data-state", "performing");
  await expect(other.getByTestId("perf-lease")).toContainText("controlled elsewhere");
  await expect(other.getByTestId("perf-start")).toHaveCount(0);
  await other.getByTestId("perf-stop").click();
  await expect(other.getByTestId("perf-ended")).toContainText("STOPPED (user)");
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
  await expect(page.getByTestId("perf-ended")).toContainText("STOPPED");
  await other.close();
  // Disarm while performing stops the stream (and re-arming never resumes it).
  await page.getByTestId("perf-start").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "performing");
  await page.getByRole("tab", { name: "live" }).click();
  await page.getByTestId("live-disarm").click();
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "false");
  expect((await performance(page)).state).toBe("stopped");
  await page.getByRole("tab", { name: "instrument" }).click();
  await expect(page.getByTestId("perf-ended")).toContainText("disarmed");
  await page.getByTestId("perf-arm").click();
  await page.getByLabel("Arm confirmation phrase").fill(ARM);
  await page.getByTestId("perf-arm-confirm").click();
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
  expect((await performance(page)).state).toBe("stopped");
  // The lease: a controlling tab that goes away (closed) stops heartbeating; the backend stops
  // the stream on its own within the lease, armed or not.
  const ctl = await browser.newPage();
  await openInstrument(ctl, rigId);
  await expect(ctl.getByTestId("perf-start")).toBeEnabled({ timeout: 10_000 });
  await ctl.getByTestId("perf-start").click();
  await expect(ctl.getByTestId("instrument-state")).toHaveAttribute("data-state", "performing");
  await ctl.close();
  await expect.poll(async () => (await performance(page)).state, { timeout: 12_000 }).toBe("stopped");
  const st = await (await page.request.get("/api/live/status")).json();
  expect(st.performance.stop_reason).toContain("lease expired");
  expect(st.armed).toBe(true);
  // Reloading the page starts nothing.
  await page.reload();
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(700);
  expect((await performance(page)).state).toBe("stopped");
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "armed");
});

test("instrument: on a real rig unknown CCs are not controllable, bypass CCs are refused, and a declared override is labelled as the user's claim", async ({ page }) => {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E real ${Date.now()}`)}`, { data: exported });
  const rigId = (await res.json()).rig.id as string;
  created.push(rigId);
  await openInstrument(page, rigId);
  await expect(page.getByTestId("texture-list")).toContainText("No texture yet");
  page.once("dialog", (d) => d.accept("Fracture"));
  await page.getByTestId("texture-new").click();
  await expect(page.getByTestId("texture-name")).toHaveValue("Fracture");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const macroId = (await (await page.request.get(`/api/rigs/${rigId}`)).json()).textures[0].macros[0].id as string;
  // Sunset CC 100 ("Expression (unverified)") is offered as "not stated" and refused once added.
  await page.getByTestId(`mapping-add-${macroId}`).click();
  await page.getByTestId("mapping-add-form").getByLabel("Destination device").selectOption({ label: "Sunset" });
  await page.getByTestId("mapping-add-form").getByLabel("Destination CC").selectOption("100");
  await page.getByTestId("mapping-add-form").getByLabel("Range from").fill("127");
  await page.getByTestId("mapping-add-form").getByLabel("Range to").fill("0");
  await page.getByTestId("mapping-add-confirm").click();
  const row = page.getByTestId("patch-bay").locator('li[data-testid^="mapping-map_"]').first();
  await expect(row).toHaveAttribute("data-eligible", "false", { timeout: 10_000 });
  await expect(row).toContainText("not eligible");
  await expect(row).toContainText("does not state that it is continuously variable");
  await expect(page.getByTestId("perf-not-controllable")).toBeVisible();
  await expect(page.getByTestId("perf-not-controllable")).toContainText("Not yet controllable");
  await expect(page.getByTestId("perf-create-demo")).toBeVisible();
  // The hardware-verified Sunset bypass CC 15 is a switch: refused outright, no override offered.
  await page.getByTestId(`mapping-add-${macroId}`).click();
  await page.getByTestId("mapping-add-form").getByLabel("Destination device").selectOption({ label: "Sunset" });
  await page.getByTestId("mapping-add-form").getByLabel("Destination CC").selectOption("15");
  await page.getByTestId("mapping-add-confirm").click();
  const bypassRow = page.getByTestId("patch-bay").locator('li[data-testid^="mapping-map_"]').nth(1);
  await expect(bypassRow).toHaveAttribute("data-eligible", "false", { timeout: 10_000 });
  await expect(bypassRow).toContainText("bypass");
  await expect(bypassRow.getByRole("button", { name: "Declare with note" })).toHaveCount(0);
  // BigSky CC 100 is documented continuous: eligible, with the honest "not hardware-verified" note.
  await page.getByTestId(`mapping-add-${macroId}`).click();
  await page.getByTestId("mapping-add-form").getByLabel("Destination device").selectOption({ label: "BigSky MX" });
  await page.getByTestId("mapping-add-form").getByLabel("Destination CC").selectOption("100");
  await page.getByTestId("mapping-add-confirm").click();
  const bigsky = page.getByTestId("patch-bay").locator('li[data-testid^="mapping-map_"]').nth(2);
  await expect(bigsky).toHaveAttribute("data-eligible", "true", { timeout: 10_000 });
  await expect(bigsky).toContainText("documented continuous");
  await expect(bigsky).toContainText("not hardware-verified");
  // Declaring the Sunset control needs a note, and is then labelled as the user's claim.
  await expect(row.getByRole("button", { name: "Declare with note" })).toBeDisabled();
  await row.getByLabel("Override note").fill("swept by hand on the board, smooth");
  await row.getByRole("button", { name: "Declare with note" }).click();
  await expect(row).toHaveAttribute("data-eligible", "true", { timeout: 10_000 });
  await expect(row).toContainText("user-declared");
  await expect(row).toContainText("your claim");
  await expect(page.getByTestId("perf-not-controllable")).toHaveCount(0);
  // Nothing was sent, and the Scenes of the demo are untouched.
  expect(await sentOrQueued(page, rigId)).toBe(0);
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(rig.scenes.map((s: { id: string }) => s.id)).toEqual(["scene_clean", "scene_heavy", "scene_solo"]);
  expect(rig.textures[0].macros[0].mappings[0].override_note).toBe("swept by hand on the board, smooth");
});

test("instrument: usable at phone width, with reduced motion the numbers still move, and the macro is keyboard-operable", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const rigId = await createUndertow(page);
  await openInstrument(page, rigId);
  // No horizontal page overflow at phone width; the state and Stop are visible.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.getByTestId("instrument-state")).toBeVisible();
  await expect(page.getByTestId("perf-stop-idle")).toBeVisible();
  // Reduced motion: the effective value is printed and still changes as the LFO moves (72 BPM, 8 beats: 6.67 s).
  await page.getByTestId("lfo-beats-macro_bloom").selectOption("1");
  const first = await page.getByTestId("macro-effective-macro_bloom").textContent();
  await expect.poll(async () => page.getByTestId("macro-effective-macro_bloom").textContent(), { timeout: 4000 }).not.toBe(first);
  // Keyboard: Tab to the macro slider and move it with the arrow keys.
  await page.getByTestId("lfo-enabled-macro_bloom").uncheck();
  const slider = page.getByTestId("macro-slider-macro_bloom");
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("mapping-value-map_bloom_a")).toHaveText("100");
  for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("macro-effective-macro_bloom")).toHaveText("effective 1%");
  await page.keyboard.press("End");
  await expect(page.getByTestId("mapping-value-map_bloom_b")).toHaveText("110");
  expect(await sentOrQueued(page, rigId)).toBe(0);
  await page.request.delete(`/api/rigs/${created.pop()}`);
  await context.close();
});
