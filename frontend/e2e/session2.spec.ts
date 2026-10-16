import { expect, test, type Page } from "@playwright/test";

// Session 2 scenarios: jack-aware wiring on the board, graphical jack editing, undo/redo,
// the stereo demo's left/right paths, scene duplication + MC8 assignment, and the Morningstar tools.

const created: string[] = [];

async function openCopy(page: Page, source: "mono" | "stereo") {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => (source === "stereo" ? r.name.startsWith("Stereo demo") : r.name.startsWith("Demo rig")));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E ${source} ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("error-banner")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "board" })).toBeVisible({ timeout: 15_000 });
  return rig.id as string;
}

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

async function dragPort(page: Page, from: string, to: string) {
  const a = await page.getByTestId(from).boundingBox();
  const b = await page.getByTestId(to).boundingBox();
  expect(a && b).toBeTruthy();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("board: dragging from a jack to a compatible jack creates a validated cable; incompatible drops do nothing", async ({ page }) => {
  const rigId = await openCopy(page, "mono");
  // ML10X Send D (Tip) [audio out] -> BigSky MX IN R [audio in, unused].
  await dragPort(page, "port-inst_ml10x-send_d_tip", "port-inst_bigsky-in_r");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const conn = rig.connections.find((c: { source: { port_id: string }; target: { port_id: string } }) => c.source.port_id === "send_d_tip" && c.target.port_id === "in_r");
  expect(conn).toBeTruthy();
  expect(conn.kind).toBe("audio");
  const before = rig.connections.length;
  // Audio out -> MIDI in is not offered: the drop is ignored and no cable appears.
  await dragPort(page, "port-inst_ml10x-send_e_tip", "port-inst_bigsky-midi_in");
  await page.waitForTimeout(800);
  const after = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(after.connections.length).toBe(before);
  // An input that already has a plug is not a valid target either.
  await dragPort(page, "port-inst_bigsky-in_r", "port-inst_ml10x-send_e_tip");
  await page.waitForTimeout(800);
  const again = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(again.connections.length).toBe(before + 0);
});

test("board: undo and redo walk the edit history and persist", async ({ page }) => {
  const rigId = await openCopy(page, "mono");
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  await page.getByLabel("X (mm)").fill("250");
  await page.getByLabel("Y (mm)").fill("40");
  await expect(page.getByRole("button", { name: /^Plumes, .* at 250, 40/ })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /^Plumes, .* at 250, 20/ })).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /^Plumes, .* at 210, 20/ })).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(page.getByRole("button", { name: /^Plumes, .* at 250, 20/ })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const plumes = rig.instances.find((i: { label: string }) => i.label === "Plumes");
  expect([plumes.x_mm, plumes.y_mm]).toEqual([250, 20]);
  await page.getByTestId("board-canvas").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+z");
  await expect(page.getByRole("button", { name: /^Plumes, .* at 210, 20/ })).toBeVisible();
});

test("board: dragging a jack in the editor moves it on the board and in the wiring view", async ({ page }) => {
  const rigId = await openCopy(page, "mono");
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  const jack = page.getByTestId("jack-in");
  const editor = page.getByTestId("jack-editor");
  await editor.scrollIntoViewIfNeeded(); // the inspector sits below the fold at the default viewport
  const jb = await jack.boundingBox();
  const eb = await editor.boundingBox();
  await page.mouse.move(jb!.x + jb!.width / 2, jb!.y + jb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb!.x + eb!.width * 0.35, eb!.y + eb!.height * 0.12, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("cell", { name: "Input edited" })).toBeVisible();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const plumes = rig.instances.find((i: { label: string }) => i.label === "Plumes");
  const override = plumes.port_overrides.find((p: { id: string }) => p.id === "in");
  expect(override.edge).toBe("top");
  expect(override.position_evidence).toBe("user");
  const analysis = await (await page.request.get(`/api/rigs/${rigId}/analysis`)).json();
  const placed = analysis.instances[plumes.id].ports.find((p: { port_id: string }) => p.port_id === "in");
  expect(placed.estimated).toBe(false);
  expect(placed.edge).toBe("top");
});

test("stereo demo: left and right conductor paths are distinct, complete and physically explained", async ({ page }) => {
  await openCopy(page, "stereo");
  await page.getByRole("tab", { name: "wiring" }).click();
  const paths = page.getByTestId("signal-paths");
  await expect(paths).toContainText("Left (Input Tip): Guitar → Input (Tip) → Plumes → Sunset → BigSky MX → Output (Tip) → Amp L");
  await expect(paths).toContainText("Right (return of loop 6, C Ring): BigSky MX → Output (Ring) → Amp R");
  await expect(paths).toContainText("Send C (Tip) → Return C (Tip)");
  await expect(paths).toContainText("Return C (Ring) (return only)");
  await expect(page.getByTestId("cable-kit")).toContainText("TRS-to-dual-TS breakout at ML10X Return C");
  await expect(page.getByTestId("cable-kit")).toContainText("TRS-to-dual-TS breakout at ML10X Output");
  await page.getByRole("button", { name: "Remove cable BigSky Out R -> Return C (Ring)" }).click();
  await expect(paths).toContainText("incomplete");
  await expect(page.getByText(/takes the Return of loop 6 .* but nothing is cabled into it/).first()).toBeVisible();
});

test("scenes: duplicate a scene, assign it to an MC8 switch from the scene, and see it compiled", async ({ page }) => {
  const rigId = await openCopy(page, "stereo");
  await page.getByRole("tab", { name: "scenes" }).click();
  await page.getByRole("button", { name: /Solo/ }).first().click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Solo (copy)");
  await page.getByLabel("Name", { exact: true }).fill("Outro");
  await page.getByLabel("MC8 switch").selectOption("1:D");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("tab", { name: "controllers" }).click();
  await expect(page.getByLabel("Switch D scene")).toHaveValue(/scene_/);
  await expect(page.getByLabel("Switch D short name")).toHaveValue("Outro");
  await expect(page.getByText(/^D Outro — 7 messages/)).toBeVisible();
  const compiled = await (await page.request.get(`/api/rigs/${rigId}/exports/compiled.json`)).json();
  const d = compiled.mc8.banks[0].switches.find((s: { position: string }) => s.position === "D");
  expect(d.scene_name).toBe("Outro");
  expect(d.messages.map((m: { summary: string }) => m.summary)).toEqual(["CC 0 = 0 ch 10 -> ML10X", "PC 2 ch 10 -> ML10X", "PC 2 ch 3 -> Sunset", "CC 10 = 127 ch 3 -> Sunset", "CC 0 = 0 ch 2 -> BigSky MX", "PC 2 ch 2 -> BigSky MX", "CC 102 = 127 ch 2 -> BigSky MX"]);
  await page.getByRole("tab", { name: "scenes" }).click();
  await page.getByRole("button", { name: /Clean intro/ }).first().click();
  await expect(page.getByLabel("MC8 switch").locator("option", { hasText: "Bank 1 · D (used by Outro)" })).toHaveAttribute("disabled", "");
});

test("exports: an MC8 bank backup can be imported and compared", async ({ page }) => {
  const rigId = await openCopy(page, "mono");
  const bank = await (await page.request.get(`/api/rigs/${rigId}/exports/mc8-bank/1`)).json();
  const fileA = JSON.stringify(bank.dump);
  await page.getByRole("tab", { name: "exports" }).click();
  await page.getByTestId("mc8-import-file").setInputFiles({ name: "bank.json", mimeType: "application/json", buffer: Buffer.from(fileA) });
  await expect(page.getByTestId("mc8-import-result")).toContainText("Imported bank 2 with 3 preset(s)");
  await page.getByRole("tab", { name: "controllers" }).click();
  await expect(page.getByLabel("Bank name").nth(1)).toHaveValue("Demo song");
  const changed = JSON.parse(fileA);
  changed.data.bank.presetArray[0].msgArray[1].d1 = 7;
  await page.getByRole("tab", { name: "exports" }).click();
  await page.getByTestId("diff-a").setInputFiles({ name: "a.json", mimeType: "application/json", buffer: Buffer.from(fileA) });
  await page.getByTestId("diff-b").setInputFiles({ name: "b.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(changed)) });
  await page.getByRole("button", { name: "Compare" }).click();
  await expect(page.getByTestId("diff-result")).toContainText("1 change(s)");
  await expect(page.getByTestId("diff-result")).toContainText("preset 0 (A) 'Clean' / msgArray / message slot 1 / d1");
});

test("catalog: duplicate a profile, drag a jack, save, and find it in the library", async ({ page }) => {
  await page.goto("/catalog");
  await page.getByRole("button", { name: /EarthQuaker Devices Plumes/ }).click();
  await page.getByRole("button", { name: "Duplicate" }).click();
  await expect(page.getByRole("heading", { name: "Edit eqd-plumes-copy" })).toBeVisible();
  const jack = page.getByTestId("jack-out");
  const editor = page.getByTestId("jack-editor");
  await editor.scrollIntoViewIfNeeded();
  const jb = await jack.boundingBox();
  const eb = await editor.boundingBox();
  await page.mouse.move(jb!.x + jb!.width / 2, jb!.y + jb!.height / 2);
  await page.mouse.down();
  await page.mouse.move(eb!.x + eb!.width * 0.5, eb!.y + eb!.height * 0.9, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText(/\(user\)/).first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "EarthQuaker Devices Plumes (copy)" })).toBeVisible();
  const prof = await (await page.request.get("/api/catalog/devices/eqd-plumes-copy")).json();
  expect(prof.source).toBe("custom");
  const out = prof.ports.find((p: { id: string }) => p.id === "out");
  expect(out.edge).toBe("bottom");
  expect(out.position_evidence).toBe("user");
  await page.request.delete("/api/catalog/devices/eqd-plumes-copy");
});
