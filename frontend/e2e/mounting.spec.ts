import { expect, test, type Page } from "@playwright/test";

// Session 3e: mounting surfaces (phase A) and power planning (phase B).
// Top and underside share one coordinate system (the underside is seen through the board from
// above, not mirrored); a device under the board is only called a fit when its height and the
// board's clearance are both known.

const createdRigs: string[] = [];
test.afterEach(async ({ page }) => {
  while (createdRigs.length) await page.request.delete(`/api/rigs/${createdRigs.pop()}`);
});

async function newRig(page: Page, name: string) {
  const rig = await (await page.request.post("/api/rigs", { data: { name } })).json();
  createdRigs.push(rig.id);
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  return rig.id as string;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const device = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${esc(label)},`) });
async function addDevice(page: Page, query: string, name: RegExp) {
  await page.getByLabel("Search device library").fill(query);
  await page.getByRole("button", { name }).click();
}
async function dragDevice(page: Page, label: string, dx: number, dy: number) {
  const b = (await device(page, label).boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 20);
  await page.mouse.down();
  await page.mouse.move(b.x + 20 + dx, b.y + 20 + dy, { steps: 6 });
  await page.mouse.up();
}
const saved = (page: Page) => expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

test("mounting: pick a Pedaltrain, pedals on top, ML10X and a supply underneath, both views keep positions, fit is verified only with real figures", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  const rigId = await newRig(page, `E2E mounting ${Date.now()}`);
  // 1. A manufacturer pedalboard: its dimensions come in, its unknowns are said out loud.
  await page.getByTestId("board-model").selectOption("pedaltrain-classic-2");
  await expect(page.getByLabel("Width (mm)")).toHaveValue("609.6");
  await expect(page.getByLabel("Depth (mm)")).toHaveValue("317.5");
  await expect(page.getByTestId("board-spec")).toContainText("4 rails");
  await expect(page.getByTestId("board-spec")).toContainText("spacing unverified");
  await expect(page.getByTestId("board-spec")).toContainText("mountable");
  // 2. Effects on top.
  await addDevice(page, "Plumes", /Add EarthQuaker Devices Plumes/);
  await addDevice(page, "Sunset", /Add Strymon Sunset/);
  await expect(device(page, "Plumes")).toHaveAttribute("data-surface", "top");
  await expect(page.getByTestId("surface-top")).toContainText("2");
  await saved(page);
  const plumesId = (await (await page.request.get(`/api/rigs/${rigId}`)).json()).instances.find((i: { label: string }) => i.label === "Plumes").id;
  // 3. Switch to the underside and mount the ML10X and a supply there: the top is ghosted.
  await page.getByTestId("surface-underside").click();
  await expect(page.getByTestId("board-surface")).toHaveAttribute("data-surface", "underside");
  await expect(page.getByTestId("underside-frame")).toBeVisible();
  await expect(page.getByTestId("underside-frame")).toContainText("not mirrored");
  await expect(page.getByTestId("underside-frame")).toContainText("open front");
  await expect(page.getByTestId(`ghost-${plumesId}`)).toBeVisible();
  await expect(device(page, "Plumes")).toHaveCount(0); // not editable from here
  await addDevice(page, "ML10X", /Add Morningstar ML10X/);
  await addDevice(page, "Isolated", /Add Generic Isolated power supply/);
  await expect(device(page, "ML10X")).toHaveAttribute("data-surface", "underside");
  await expect(page.getByTestId("surface-underside")).toContainText("2");
  // Position and rotate under the board; snapping ignores the pedals above.
  await dragDevice(page, "ML10X", 10, 120); // down, clear of the supply beside it
  await device(page, "ML10X").click();
  await page.keyboard.press("r");
  await saved(page);
  let rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const ml = rig.instances.find((i: { label: string }) => i.label === "ML10X");
  expect(ml.surface).toBe("underside");
  expect(ml.off_board).toBe(false);
  expect(ml.rotation).toBe(90);
  expect(ml.y_mm).toBeGreaterThan(100);
  const psu = rig.instances.find((i: { label: string }) => i.label.startsWith("Isolated"));
  expect(psu.surface).toBe("underside");
  // Clearance is not published for this board: the switcher is unverified, not approved.
  const diagText = page.getByText(/usable height under this board is not known/).first();
  await expect(diagText).toBeVisible();
  // 4. Back on top: the pedals are exactly where they were, the underside shows as ghosts, and the
  //    switcher cannot be grabbed from here.
  await page.getByTestId("surface-top").click();
  await expect(device(page, "Plumes")).toBeVisible();
  await expect(device(page, "ML10X")).toHaveCount(0);
  await expect(page.getByTestId(`ghost-${ml.id}`)).toBeVisible();
  const plumesBefore = rig.instances.find((i: { label: string }) => i.label === "Plumes");
  rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(rig.instances.find((i: { label: string }) => i.label === "Plumes")).toEqual(plumesBefore);
  // The user measures the clearance: 58 mm switcher vs 50 mm -> error; the 35 mm supply fits.
  await page.getByTestId("board-clearance").fill("50");
  await saved(page);
  await page.getByTestId("surface-underside").click();
  await expect(page.getByText(/is 58 mm tall but only 50 mm is available/).first()).toBeVisible();
  await expect(page.getByText(/clears the 50 mm under the board/).first()).toBeVisible();
  // Move the supply from the inspector to off-board and back to the top: one select, and the
  // device follows the view.
  await device(page, "Isolated power supply (8 x 9 V + 1 x 18 V)").click();
  await page.getByTestId("inst-surface").selectOption("top");
  await expect(device(page, "Isolated power supply (8 x 9 V + 1 x 18 V)")).toHaveCount(0);
  await page.getByTestId("surface-top").click();
  await expect(device(page, "Isolated power supply (8 x 9 V + 1 x 18 V)")).toHaveAttribute("data-surface", "top");
  await saved(page);
  // 10. Reload, export and import: mounting data survives, legacy flags stay honest.
  await page.reload();
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("board-model")).toHaveValue("pedaltrain-classic-2");
  await expect(page.getByTestId("board-clearance")).toHaveValue("50");
  await page.getByTestId("surface-underside").click();
  await expect(device(page, "ML10X")).toBeVisible();
  const exported = await (await page.request.get(`/api/rigs/${rigId}/export`)).json();
  const imported = (await (await page.request.post(`/api/rigs/import?name=${encodeURIComponent("E2E mount copy")}`, { data: exported })).json()).rig;
  createdRigs.push(imported.id);
  expect(imported.board.model_id).toBe("pedaltrain-classic-2");
  expect(imported.board.underside_clearance_mm).toBe(50);
  expect(imported.instances.find((i: { label: string }) => i.label === "ML10X").surface).toBe("underside");
  const analysis = await (await page.request.get(`/api/rigs/${imported.id}/analysis`)).json();
  expect(analysis.mounting.counts).toEqual({ top: 3, underside: 1, off_board: 0 });
  expect(analysis.diagnostics.some((d: { code: string }) => d.code === "instance.underside_too_tall")).toBe(true);
});

test("mounting: an older rig with off_board devices loads unchanged and a supply under the board still powers a pedal on top", async ({ page }) => {
  // The demo rig predates surfaces: its guitar, amp and supply are plain `off_board: true`.
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  for (const i of exported.rig.instances) delete i.surface; // exactly what an old file looks like
  const rig = (await (await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E legacy ${Date.now()}`)}`, { data: exported })).json()).rig;
  createdRigs.push(rig.id);
  const psu = rig.instances.find((i: { label: string }) => i.label === "Power supply");
  expect(psu.off_board).toBe(true);
  expect(psu.surface ?? null).toBeNull(); // not reinterpreted
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(device(page, "Power supply")).toHaveAttribute("data-surface", "off_board");
  // The user now says the supply is under the board. Its power cables to the pedals on top are
  // kept; on the top view they end in a stub pointing down, underneath they point up.
  await device(page, "Power supply").click();
  await page.getByTestId("inst-surface").selectOption("underside");
  await saved(page);
  const conn = rig.connections.find((c: { kind: string; target: { instance_id: string } }) => c.kind === "power" && c.target.instance_id === "inst_plumes");
  await page.getByRole("checkbox", { name: /power/ }).check();
  await expect(page.getByTestId(`cable-stub-${conn.id}`)).toBeVisible();
  await expect(page.getByTestId(`cable-stub-${conn.id}`)).toContainText("↧");
  await page.getByTestId("surface-underside").click();
  await expect(page.getByTestId(`cable-stub-${conn.id}`)).toContainText("↥");
  const analysis = await (await page.request.get(`/api/rigs/${rig.id}/analysis`)).json();
  expect(analysis.instances.inst_psu.surface).toBe("underside");
  expect(analysis.summary.errors).toBe(0); // mounting changes nothing electrically
  expect(analysis.diagnostics.filter((d: { code: string }) => d.code === "connection.port_missing")).toHaveLength(0);
  const md = await (await page.request.get(`/api/rigs/${rig.id}/exports/wiring.md`)).text();
  expect(md).toContain("| Power supply | Generic Isolated power supply (8 x 9 V + 1 x 18 V) | underside |");
  expect(md).toContain("Crosses from under the board to the top of the board");
});

test("power: a Zuma under the board powers the pedals on top; outlets show capacity, selectable voltage, overload, mismatch and unknowns; everything survives reload and import", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1000 });
  const rigId = await newRig(page, `E2E power ${Date.now()}`);
  const inst = (id: string, profile_id: string, label: string, x: number, y: number, surface: string) => ({ id, profile_id, label, x_mm: x, y_mm: y, rotation: 0, intentional_overlap: false, off_board: surface === "off_board", surface, midi_channel: null, port_overrides: [], removed_port_ids: [] });
  let rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  rig.board = { ...rig.board, model_id: "pedaltrain-novo-24", width_mm: 609.6, depth_mm: 368.3 };
  rig.instances = [
    inst("bs", "strymon-bigsky-mx", "BigSky", 40, 30, "top"), // 9 V, 500 mA
    inst("pl", "eqd-plumes", "Plumes", 260, 30, "top"), // 9 V, 25 mA
    inst("my", "generic-mono-effect", "Mystery", 380, 30, "top"), // requirement unknown
    inst("ml", "morningstar-ml10x", "ML10X", 40, 220, "underside"), // 9-18 V, 160 mA
    inst("z", "strymon-zuma", "Zuma", 300, 230, "underside"),
  ];
  rig.revision += 1;
  expect((await page.request.put(`/api/rigs/${rigId}`, { data: rig })).ok()).toBeTruthy();
  await page.reload();
  await page.getByRole("tab", { name: "wiring" }).click();
  const planner = page.getByTestId("power-planner");
  await expect(planner).toBeVisible();
  await expect(planner).toContainText("Zuma");
  await expect(planner).toContainText("underside");
  // 6. Each outlet shows its own rating; the 24 V link is not a pedal outlet; nothing is pooled.
  await expect(page.getByTestId("outlet-rated-out1")).toContainText("500 mA");
  await expect(page.getByTestId("outlet-link24")).toContainText("not a pedal outlet");
  await expect(page.getByTestId("power-unpowered")).toContainText("Not yet powered (4)");
  // 5. Assign: BigSky -> Out 1, Plumes -> Out 2, ML10X -> Out 8, Mystery -> Out 3.
  await page.getByTestId("power-bs").selectOption("out1");
  await page.getByTestId("power-pl").selectOption("out2");
  await page.getByTestId("power-ml").selectOption("out8");
  await page.getByTestId("power-my").selectOption("out3");
  await expect(page.getByTestId("power-unpowered")).toContainText("Not yet powered (0)");
  await expect(page.getByTestId("outlet-out1")).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("outlet-remaining-out1")).toContainText("0 mA");
  await expect(page.getByTestId("outlet-remaining-out2")).toContainText("475 mA");
  // 9. Unknown requirement stays unknown, never approved.
  await expect(page.getByTestId("outlet-out3")).toHaveAttribute("data-status", "unknown");
  await expect(page.getByTestId("power-unknown")).toContainText("Mystery");
  // Selectable voltage: Out 8 at 18 V gives 250 mA, enough for the ML10X (160 mA, accepts 9-18 V).
  await page.getByTestId("outlet-voltage-out8").selectOption("18");
  await expect(page.getByTestId("outlet-rated-out8")).toContainText("250 mA");
  await expect(page.getByTestId("outlet-remaining-out8")).toContainText("90 mA");
  await expect(page.getByTestId("outlet-out8")).toHaveAttribute("data-status", "ok");
  // 7. Capacity exceeded: move the BigSky onto Out 8 (250 mA at 18 V) -> error, and BigSky needs 9 V -> mismatch.
  await page.getByTestId("assign-out8").selectOption("bs");
  await expect(page.getByTestId("outlet-out8")).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("outlet-out8")).toContainText("overloaded");
  await expect(page.getByTestId("outlet-out8")).toContainText("wrong voltage");
  await expect(page.getByTestId("outlet-out1")).toHaveAttribute("data-status", "unused"); // it moved, not copied
  // Back at 9 V the voltage is right for the BigSky but 660 mA of documented minimums exceed 500 mA.
  await page.getByTestId("outlet-voltage-out8").selectOption("9");
  await expect(page.getByTestId("outlet-out8")).not.toContainText("wrong voltage");
  await expect(page.getByTestId("outlet-out8")).toContainText("overloaded");
  await expect(page.getByTestId("outlet-remaining-out8")).toContainText("-160 mA");
  // Move the BigSky back to Out 1 from the row itself.
  await page.getByLabel("Move BigSky to another outlet").selectOption("out1");
  await expect(page.getByTestId("outlet-out8")).toHaveAttribute("data-status", "ok");
  await expect(page.getByTestId("outlet-out1")).toHaveAttribute("data-status", "ok");
  // 8. A polarity / voltage error: Plumes (9 V) onto Out 9 set to 12 V.
  await page.getByTestId("outlet-voltage-out9").selectOption("12");
  await page.getByLabel("Move Plumes to another outlet").selectOption("out9");
  await expect(page.getByTestId("outlet-out9")).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("outlet-out9")).toContainText("wrong voltage");
  await saved(page);
  // The assignments are ordinary power cables: four of them, from the underside supply to devices on both surfaces.
  rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const power = rig.connections.filter((c: { kind: string }) => c.kind === "power");
  expect(power).toHaveLength(4);
  expect(power.every((c: { source: { instance_id: string } }) => c.source.instance_id === "z")).toBe(true);
  expect(rig.instances.find((i: { id: string }) => i.id === "z").supply_settings).toEqual({ out8: 9, out9: 12 });
  const a = await (await page.request.get(`/api/rigs/${rigId}/analysis`)).json();
  const codes = new Set(a.diagnostics.map((d: { code: string }) => d.code));
  expect(codes.has("power.voltage_mismatch")).toBe(true);
  expect(codes.has("power.requirement_unknown")).toBe(true);
  expect(codes.has("power.outlet_overloaded")).toBe(false);
  // 10. Reload, export, import.
  await page.reload();
  await page.getByRole("tab", { name: "wiring" }).click();
  await expect(page.getByTestId("outlet-voltage-out9")).toHaveValue("12");
  await expect(page.getByTestId("outlet-out9")).toHaveAttribute("data-status", "error");
  await expect(page.getByTestId("assigned-ml")).toBeVisible();
  const exported = await (await page.request.get(`/api/rigs/${rigId}/export`)).json();
  const imported = (await (await page.request.post(`/api/rigs/import?name=${encodeURIComponent("E2E power copy")}`, { data: exported })).json()).rig;
  createdRigs.push(imported.id);
  expect(imported.instances.find((i: { id: string }) => i.id === "z").supply_settings).toEqual({ out8: 9, out9: 12 });
  expect(imported.instances.find((i: { id: string }) => i.id === "z").surface).toBe("underside");
  const plan = (await (await page.request.get(`/api/rigs/${imported.id}/analysis`)).json()).power;
  const out9 = plan.supplies[0].outputs.find((o: { port_id: string }) => o.port_id === "out9");
  expect(out9.voltage_v).toBe(12);
  expect(out9.current_ma_max).toBe(375);
  expect(out9.assigned.map((x: { instance_id: string }) => x.instance_id)).toEqual(["pl"]);
  expect(plan.unknown_requirements).toEqual(["my"]);
});
