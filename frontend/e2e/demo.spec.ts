import { expect, test, type Page } from "@playwright/test";

// Representative browser path through the north-star demo: open the demo rig, edit the board,
// break and repair a cable, inspect scenes and the MC8 plan, prepare exports, and verify that
// edits persist across a reload. Requires backend :8000 + frontend :3000.

// Every test works on its own copy of the demo rig so tests stay independent and the seeded
// demo rig is never mutated.
const created: string[] = [];

async function openDemo(page: Page) {
  const res = await page.request.post("/api/rigs", { data: { name: `E2E demo copy ${Date.now()}`, from_demo: true } });
  expect(res.ok()).toBeTruthy();
  const rig = await res.json();
  created.push(rig.id);
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("error-banner")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "board" })).toBeVisible({ timeout: 15_000 });
}

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

test("library lists the demo rig and the tour", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Tour: the three-scene demo")).toBeVisible();
  await expect(page.getByRole("link", { name: /Demo rig/ })).toBeVisible();
});

test("board: select, rotate and move a device; change persists after reload", async ({ page }) => {
  await openDemo(page);
  const ml10x = page.getByRole("button", { name: /^ML10X, 169 by 58 mm/ });
  await expect(ml10x).toBeVisible();
  await ml10x.click();
  await expect(page.getByRole("heading", { name: "Device inspector" })).toBeVisible();
  await page.getByLabel("Rotation").selectOption("90");
  await expect(page.getByRole("button", { name: /^ML10X, 58 by 169 mm/ })).toBeVisible();
  await page.getByLabel("X (mm)").fill("40");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByRole("button", { name: /^ML10X, 58 by 169 mm at 40, 20/ })).toBeVisible();
});

test("board: a collision is reported and can be marked intentional", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  await page.getByLabel("X (mm)").fill("25");
  await page.getByLabel("Y (mm)").fill("25");
  await expect(page.getByText(/overlap by .* mm²/).first()).toBeVisible();
  await page.getByLabel("Overlap is intentional").check();
  await expect(page.getByText("(marked intentional)").first()).toBeVisible();
  await page.getByLabel("Overlap is intentional").uncheck();
  await page.getByLabel("X (mm)").fill("210");
  await page.getByLabel("Y (mm)").fill("20");
  await expect(page.getByText("Every device fits and nothing collides.")).toBeVisible();
  // Out of bounds is reported too.
  await page.getByLabel("X (mm)").fill("560");
  await expect(page.getByText(/extends outside the 600 x 300 mm board/).first()).toBeVisible();
});

test("wiring: removing a cable breaks the ML10X loop; re-adding it repairs the path", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "wiring" }).click();
  await expect(page.getByText("Signal path, MIDI, expression and power all check out.")).toHaveCount(0);
  await page.getByRole("button", { name: "Remove cable Plumes -> Return A" }).click();
  await expect(page.getByText(/loop 1: Send is cabled but Return is not/)).toBeVisible();
  await page.getByLabel("Signal kind").selectOption("audio");
  await page.getByLabel("From device").selectOption({ label: "Plumes" });
  await page.getByLabel("From port (output)").selectOption({ label: "Output" });
  await page.getByLabel("To device").selectOption({ label: "ML10X" });
  await page.getByLabel("To port (input)").selectOption({ label: "Return A (Tip)" });
  await page.getByLabel("Label (optional)").fill("Plumes -> Return A");
  await page.getByRole("button", { name: "Add cable" }).click();
  await expect(page.getByText(/loop 1: Send is cabled but Return is not/)).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "complete" }).first()).toBeVisible();
});

test("wiring: an incompatible connection is flagged, not silently accepted", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "wiring" }).click();
  await page.getByLabel("Signal kind").selectOption("midi");
  await page.getByLabel("From device").selectOption({ label: "MC8" });
  await page.getByLabel("From port (output)").selectOption({ label: "Omniport 2 (TRS MIDI out)" });
  await page.getByLabel("To device").selectOption({ label: "BigSky MX" });
  await page.getByLabel("To port (input)").selectOption("midi_in");
  await page.getByRole("button", { name: "Add cable" }).click();
  await expect(page.getByText(/DIN to TRS MIDI needs an adapter cable/).first()).toBeVisible();
  // Audio into a MIDI jack is impossible: the form only offers same-kind ports, and the
  // backend rejects a cross-kind cable if one is forced through the API.
  // Let the page's own (debounced) save of the new cable land first, so the forced PUT below is not
  // refused as a stale revision and silently leaves the rig without the bad cable.
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rigId = page.url().split("/rigs/")[1].split("#")[0];
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  rig.connections.push({ id: "conn_bad", kind: "audio", source: { instance_id: "inst_guitar", port_id: "out" }, target: { instance_id: "inst_mc8", port_id: "midi_in" }, intentional: false });
  rig.revision += 1;
  expect((await page.request.put(`/api/rigs/${rigId}`, { data: rig })).ok()).toBeTruthy();
  const analysis = await (await page.request.get(`/api/rigs/${rigId}/analysis`)).json();
  expect(analysis.diagnostics.some((d: { code: string }) => d.code === "connection.kind_mismatch")).toBeTruthy();
});

test("scenes: three scenes with compiled MIDI plans", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "scenes" }).click();
  for (const name of ["Clean intro", "Heavy verse", "Solo"]) await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
  await page.getByRole("button", { name: /Solo/ }).click();
  await expect(page.getByText(/Compiled MIDI plan — 9 messages/)).toBeVisible();
  await expect(page.getByText(/Engage ML10X loop 3/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Roll guitar volume to 10" })).toBeVisible();
});

test("controllers: MC8 bank 1 maps A/B/C and the ML10X preset chain is editable", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "controllers" }).click();
  await expect(page.getByLabel("Switch A scene")).toHaveValue("scene_clean");
  await expect(page.getByLabel("Switch B scene")).toHaveValue("scene_heavy");
  await expect(page.getByLabel("Switch C scene")).toHaveValue("scene_solo");
  await expect(page.getByText(/^A Clean — 7 messages/)).toBeVisible();
  await expect(page.getByText("Series chain: IN → L1 → L3 → L5 → OUT · bank 1, PC 0")).toBeVisible();
});

test("exports: evidence levels are explicit and the MC8 bank file self-checks", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "exports" }).click();
  await expect(page.getByText("ml10x native")).toBeVisible();
  await expect(page.getByText("unavailable")).toBeVisible();
  await page.getByRole("button", { name: /Prepare bank 1/ }).click();
  await expect(page.getByText("structure + hash OK")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download Morningstar_MC8_Bank_Backup_Demo song/ })).toBeVisible();
});

test("usability: build a small rig from scratch through the UI", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Name").fill("E2E scratch rig");
  await page.getByRole("button", { name: "Create rig" }).click();
  await expect(page.getByRole("tab", { name: "board" })).toBeVisible();
  await page.getByLabel("Search device library").fill("Plumes");
  await page.getByRole("button", { name: "Add EarthQuaker Devices Plumes" }).click();
  await expect(page.getByRole("heading", { name: "Device inspector" })).toBeVisible();
  await expect(page.getByText("jack positions (not documented)")).toBeVisible();
  await page.getByRole("button", { name: "+ Add jack" }).click();
  await page.locator("form").getByLabel("Label").fill("Side EXP");
  await page.locator("form").getByLabel("Signal").selectOption("expression");
  await page.getByRole("button", { name: "Save jack" }).click();
  await expect(page.getByRole("cell", { name: "Side EXP edited" })).toBeVisible();
  await page.getByLabel("Search device library").fill("MC8");
  await page.getByRole("button", { name: "Add Morningstar MC8" }).click();
  await page.getByRole("tab", { name: "wiring" }).click();
  await page.getByLabel("Signal kind").selectOption("expression");
  await page.getByLabel("From device").selectOption({ label: "MC8" });
  // MC8 Omniports 3/4 are expression INPUTS, so nothing can be offered as a source: the UI is honest.
  await expect(page.getByLabel("From port (output)").locator("option")).toHaveCount(1);
  await page.getByRole("tab", { name: "scenes" }).click();
  page.once("dialog", (d) => d.accept("Verse"));
  await page.getByRole("button", { name: "+ New" }).click();
  await page.getByLabel("Plumes state").selectOption("on");
  await expect(page.getByText("Plumes: switch ON by hand (no MIDI control).")).toBeVisible();
  await page.getByRole("tab", { name: "controllers" }).click();
  await page.getByLabel("MC8 instance").selectOption({ label: "MC8" });
  await page.getByRole("button", { name: "+ Bank" }).click();
  await page.getByLabel("Switch A scene").selectOption({ label: "Verse" });
  await expect(page.getByText(/^A Verse — 0 messages/)).toBeVisible();
  await page.goto("/");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("listitem").filter({ hasText: "E2E scratch rig" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "E2E scratch rig" })).toHaveCount(0);
});

test("exports: an export made right after an edit reflects the edit, even while the save is slow", async ({ page }) => {
  await openDemo(page);
  const rigId = page.url().split("/rigs/")[1].split("#")[0];
  // Make the persistence slow so the export would read stale data without the save barrier.
  await page.route(`**/api/rigs/${rigId}`, async (route) => {
    if (route.request().method() === "PUT") await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  await page.getByRole("tab", { name: "controllers" }).click();
  await page.getByLabel("Switch A short name").fill("Intro");
  await page.getByRole("tab", { name: "exports" }).click();
  await page.getByRole("button", { name: /Prepare bank 1/ }).click();
  await expect(page.getByText("structure + hash OK")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("export-save-state")).toHaveText(/Saved \(revision \d+\)/);
  const bank = await (await page.request.get(`/api/rigs/${rigId}/exports/mc8-bank/1`)).json();
  expect(bank.dump.data.bank.presetArray[0].shortName).toBe("Intro");
});

test("saves: edits during an in-flight save are persisted in order and 'Saved' is only shown once the latest revision is stored", async ({ page }) => {
  await openDemo(page);
  const rigId = page.url().split("/rigs/")[1].split("#")[0];
  let puts = 0;
  await page.route(`**/api/rigs/${rigId}`, async (route) => {
    if (route.request().method() === "PUT") {
      puts += 1;
      if (puts === 1) await new Promise((r) => setTimeout(r, 2500)); // first save is slow
    }
    await route.continue();
  });
  await page.getByRole("tab", { name: "controllers" }).click();
  const field = page.getByLabel("Switch A short name");
  await field.fill("One");
  await expect(page.getByTestId("save-state")).toHaveText("Saving…", { timeout: 5_000 });
  await field.fill("Two"); // second edit while the first PUT is still in flight
  await expect(page.getByTestId("save-state")).not.toHaveText("Saved");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 15_000 });
  const stored = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(stored.controllers.mc8.banks[0].presets.find((p: { position: string }) => p.position === "A").short_name).toBe("Two");
  expect(stored.revision).toBeGreaterThanOrEqual(2);
  expect(puts).toBe(2);
  // An older revision arriving late (e.g. from another tab) is refused by the server.
  const stale = await page.request.put(`/api/rigs/${rigId}`, { data: { ...stored, revision: 1, name: "stale" } });
  expect(stale.status()).toBe(409);
  expect((await (await page.request.get(`/api/rigs/${rigId}`)).json()).name).not.toBe("stale");
});

test("exports: a wiring error blocks the native MC8 export even though the switches compile", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("tab", { name: "wiring" }).click();
  await page.getByRole("button", { name: "Remove cable Plumes -> Return A" }).click();
  await expect(page.getByText(/loop 1: Send is cabled but Return is not/)).toBeVisible();
  await page.getByRole("tab", { name: "exports" }).click();
  await expect(page.getByTestId("native-export-blocked")).toBeVisible();
  await expect(page.getByRole("button", { name: /Prepare bank 1/ })).toBeDisabled();
  const rigId = page.url().split("/rigs/")[1].split("#")[0];
  await expect.poll(async () => (await page.request.get(`/api/rigs/${rigId}/exports/mc8-bank/1`)).status()).toBe(409);
  // Human-readable reports remain available and list the problem.
  const md = await (await page.request.get(`/api/rigs/${rigId}/exports/wiring.md`)).text();
  expect(md).toContain("switcher.loop_open");
});
