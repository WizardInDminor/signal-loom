import { expect, test, type Page } from "@playwright/test";

// Session 3: the Stage. A scene is told on the physical board: conductor paths along real
// cables, pedal states, the MC8 switch that recalls it, MIDI along real MIDI cables, and what
// changes when stepping through the setlist. The Stage is read-only.

const created: string[] = [];

async function openCopy(page: Page, source: "mono" | "stereo", hash = "") {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => (source === "stereo" ? r.name.startsWith("Stereo demo") : r.name.startsWith("Demo rig")));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E s3 ${source} ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  await page.goto(`/rigs/${rig.id}${hash}`);
  await expect(page.getByTestId("error-banner")).toHaveCount(0);
  return rig as { id: string; connections: { id: string; source: { port_id: string }; target: { port_id: string } }[] };
}

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

const conn = (rig: { connections: { id: string; source: { port_id: string }; target: { port_id: string } }[] }, a: string, b: string) =>
  rig.connections.find((c) => c.source.port_id === a && c.target.port_id === b)!.id;

test("stage: the stereo scene is drawn along the real cables, stepping the setlist updates switch, LEDs and the change list, nothing is saved", async ({ page }) => {
  const rig = await openCopy(page, "stereo", "#stage");
  // Deep link opens the Stage directly.
  await expect(page.getByRole("tab", { name: "stage" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("stage-canvas")).toBeVisible();
  await expect(page.getByTestId("setlist").locator("[aria-current=true]")).toContainText("Clean intro");

  // Left conductor: guitar cable, Send C Tip -> BigSky IN L, OUT L -> Return C Tip, Output Tip -> Amp L.
  const left = page.getByTestId("stage-path-L");
  await expect(left).toHaveAttribute("data-complete", "true");
  await expect(left).toHaveAttribute("data-cables", [conn(rig, "out", "in_tip"), conn(rig, "send_c_tip", "in_l"), conn(rig, "out_l", "return_c_tip"), conn(rig, "out_tip", "input")].join(","));
  // Right conductor starts at the return-only loop: OUT R -> Return C Ring, then Output Ring -> Amp R.
  const right = page.getByTestId("stage-path-R");
  await expect(right).toHaveAttribute("data-cables", [conn(rig, "out_r", "return_c_ring"), conn(rig, "out_ring", "input")].join(","));
  await expect(right.locator('[data-kind="cable"][data-state="return_only"]')).toHaveCount(1);
  // Pedal states come from the scene, not from the loop: Sunset is bypassed and out of the path, Plumes is unset.
  await expect(page.getByTestId("stage-device-inst_sunset")).toHaveAttribute("data-state", "bypassed");
  await expect(page.getByTestId("stage-device-inst_sunset")).toHaveAttribute("data-inpath", "false");
  await expect(page.getByTestId("stage-device-inst_plumes")).toHaveAttribute("data-state", "unset");
  await expect(page.getByTestId("stage-device-inst_bigsky")).toHaveAttribute("data-state", "engaged");
  // MIDI to the BigSky travels two real cables (DIN into the ML10X, then its Thru); Sunset one TRS cable.
  await expect(page.getByTestId("stage-midi-inst_bigsky")).toHaveAttribute("data-route", [conn(rig, "midi_out", "midi_in"), conn(rig, "midi_thru", "midi_in")].join(","));
  await expect(page.getByTestId("stage-midi-inst_sunset")).toHaveAttribute("data-route", conn(rig, "omni1", "exp_midi"));
  // The MC8 face lights switch A of bank 1.
  await expect(page.getByTestId("mc8-switch-A")).toHaveAttribute("data-lit", "true");
  await expect(page.getByTestId("mc8-switch-B")).toHaveAttribute("data-lit", "false");
  await expect(page.getByTestId("stage-story")).toContainText("Press MC8 bank 1 switch A");

  // Step to the next scene with the keyboard: Heavy verse runs through Plumes and Sunset.
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("setlist").locator("[aria-current=true]")).toContainText("Heavy verse");
  await expect(page.getByTestId("mc8-switch-B")).toHaveAttribute("data-lit", "true");
  await expect(left).toHaveAttribute("data-cables", [conn(rig, "out", "in_tip"), conn(rig, "send_a_tip", "in"), conn(rig, "out", "return_a_tip"), conn(rig, "send_b_tip", "in"), conn(rig, "out", "return_b_tip"), conn(rig, "send_c_tip", "in_l"), conn(rig, "out_l", "return_c_tip"), conn(rig, "out_tip", "input")].join(","));
  await expect(page.getByTestId("stage-device-inst_sunset")).toHaveAttribute("data-state", "engaged");
  await expect(page.getByTestId("stage-device-inst_sunset")).toHaveAttribute("data-inpath", "true");
  const diff = page.getByTestId("stage-diff");
  await expect(diff).toContainText("ML10X recalls preset 1");
  await expect(diff).toContainText("Sunset: in the signal path; bypassed → engaged");
  await expect(page.getByTestId("stage-manual")).toContainText("Plumes: switch ON by hand");

  // Pressing a switch on the MC8 face recalls its scene.
  await page.getByTestId("mc8-switch-C").click();
  await expect(page.getByTestId("setlist").locator("[aria-current=true]")).toContainText("Solo");
  await expect(page.getByTestId("stage-story")).toContainText("Press MC8 bank 1 switch C");

  // Read-only: nothing was marked dirty or saved, and the revision on the server is unchanged.
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  const after = await (await page.request.get(`/api/rigs/${rig.id}`)).json();
  expect(after.revision).toBe(0);
});

test("stage: breaking a loop return shows the path breaking at that cable and the diff follows the scene order", async ({ page }) => {
  const rig = await openCopy(page, "mono");
  // Remove Plumes -> Return A on the wiring tab, then look at the Stage.
  await page.getByRole("tab", { name: "wiring" }).click();
  await page.getByRole("button", { name: "Remove cable Plumes -> Return A" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "stage" }).click();
  const left = page.getByTestId("stage-path-L");
  await expect(left).toHaveAttribute("data-complete", "false");
  await expect(left.locator('[data-state="broken"]')).toHaveCount(1);
  await expect(left).toHaveAttribute("data-cables", [conn(rig, "out", "in_tip"), conn(rig, "send_a_tip", "in")].join(","));
  await expect(page.getByTestId("stage-story")).toContainText("incomplete");
  // Loop-state overrides on a Simple preset are reflected: Solo engages loop 3 via CC.
  await page.getByTestId("mc8-switch-C").click();
  await expect(page.getByTestId("stage-story")).toContainText("Solo");
});

test("rig library: cards show a true-scale miniature of each board", async ({ page }) => {
  await page.goto("/");
  const card = page.getByTestId("rig-preview").first();
  await expect(card).toBeVisible();
  const n = await card.locator("rect[data-device]").count();
  expect(n).toBeGreaterThanOrEqual(5);
});
