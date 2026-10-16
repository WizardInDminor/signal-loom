import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Session 3c: image-assisted jack mapping. Point at a connector in the photo, say what it is,
// and get a wired port on the reusable profile. Markers are annotations in photo space; wiring
// comes from edge + position; jack ids are stable handles that cables rely on.

const FIXTURE = path.join(__dirname, "fixtures", "pedal-photo.jpg");
// The drawn pedal occupies this part of the fixture photograph (normalized).
const CROP = { x: 0.2111, y: 0.1917, w: 0.4667, h: 0.6333 };

const createdProfiles: string[] = [];
const createdRigs: string[] = [];

test.afterEach(async ({ page }) => {
  while (createdRigs.length) await page.request.delete(`/api/rigs/${createdRigs.pop()}`);
  while (createdProfiles.length) await page.request.delete(`/api/catalog/devices/${createdProfiles.pop()}`);
  await page.request.delete("/api/assets/images/unreferenced");
});

/** Import a Pedal-Playground-style record (dimensions only) and give it a calibrated photo. */
async function importedProfileWithPhoto(page: Page, tag: string) {
  const brand = `E2E${tag}`;
  const name = `Drive ${Date.now().toString(36)}`;
  const rep = await (await page.request.post("/api/catalog/import/pedalplayground", { data: [{ Brand: brand, Name: name, Width: 2.6, Height: 4.9, Image: "x.png" }] })).json();
  expect(rep.imported).toBe(1);
  const id = `pp-${brand.toLowerCase()}-${name.toLowerCase().replace(/\s+/g, "-")}`;
  createdProfiles.push(id);
  const asset = await (await page.request.post("/api/assets/images", { multipart: { file: { name: "pedal.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FIXTURE) } } })).json();
  const prof = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  delete prof.unknown_attributes;
  delete prof.source;
  prof.image = { asset_id: asset.id, crop: CROP, rotation_quarter: 0, fit: "contain", calibrated: true };
  expect((await page.request.put(`/api/catalog/devices/${id}`, { data: prof })).ok()).toBeTruthy();
  return { id, title: `${brand} ${name}`, assetId: asset.id as string };
}

async function openMapperFromLibrary(page: Page, title: string) {
  await page.goto("/catalog");
  await page.getByRole("button", { name: title }).click();
  await page.getByTestId("configure-jacks").scrollIntoViewIfNeeded();
  await page.getByTestId("configure-jacks").click();
  await expect(page.getByTestId("jack-mapper")).toBeVisible();
  await expect(page.getByTestId("jacks-frame")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(200);
}

/** Click the photograph at a normalized point of the whole stored image. */
async function clickPhoto(page: Page, nx: number, ny: number) {
  const ov = await page.getByTestId("jacks-overlay").boundingBox();
  await page.mouse.click(ov!.x + nx * ov!.width, ov!.y + ny * ov!.height);
}
const marker = (page: Page, id: string) => page.getByTestId(`jack-marker-${id}`);
async function markerData(page: Page, id: string) {
  const m = marker(page, id);
  return { x: Number(await m.getAttribute("data-x")), y: Number(await m.getAttribute("data-y")), edge: await m.getAttribute("data-edge"), position: Number(await m.getAttribute("data-position")) };
}
async function dragMarker(page: Page, id: string, dx: number, dy: number) {
  const b = await marker(page, id).locator("circle").boundingBox();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2 + dx / 2, b!.y + b!.height / 2 + dy / 2, { steps: 4 });
  await page.mouse.move(b!.x + b!.width / 2 + dx, b!.y + b!.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}
async function dragPort(page: Page, from: string, to: string) {
  const a = await page.getByTestId(from).boundingBox();
  const b = await page.getByTestId(to).boundingBox();
  expect(a && b).toBeTruthy();
  await page.mouse.move(a!.x + a!.width / 2, a!.y + a!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2, { steps: 8 });
  await page.mouse.up();
}

test("jack mapping: imported pedal → click In, Out, DC on the photo → move and edit → save → wire on the Board → survives reload", async ({ page }) => {
  const prof = await importedProfileWithPhoto(page, "map");
  await openMapperFromLibrary(page, prof.title);
  // No jacks yet: templates are offered; mono gives three jacks to place.
  await expect(page.getByTestId("jack-templates")).toBeVisible();
  await page.getByTestId("jack-template-mono").click();
  await expect(page.getByTestId("jack-list")).toContainText("to place");

  // Click the right side of the pedal body: "In" lands on the right edge; the popover opens on it.
  await clickPhoto(page, 0.7, 0.45);
  await expect(page.getByTestId("jack-popover")).toBeVisible();
  await expect(page.getByTestId("jack-type")).toHaveValue("audio_in");
  await expect(page.getByTestId("jack-edge-right")).toHaveAttribute("aria-pressed", "true");
  const inData = await markerData(page, "in");
  expect(inData.edge).toBe("right");
  expect(inData.position).toBeGreaterThan(0.3);
  expect(inData.position).toBeLessThan(0.5);
  // Left side: "Out" on the left edge. Above the crop: the DC plug protrudes, so the top edge.
  await clickPhoto(page, 0.19, 0.45);
  expect((await markerData(page, "out")).edge).toBe("left");
  await clickPhoto(page, 0.45, 0.17);
  const dc = await markerData(page, "dc");
  expect(dc.edge).toBe("top");
  expect(dc.y).toBeLessThan(CROP.y); // the anchor really is outside the enclosure crop
  await expect(page.getByTestId("jack-list")).not.toContainText("to place");

  // Move "Out" down its edge by dragging; edit "In"'s label.
  const before = await markerData(page, "out");
  await dragMarker(page, "out", 0, 60);
  const after = await markerData(page, "out");
  expect(after.y).toBeGreaterThan(before.y);
  expect(after.edge).toBe("left");
  expect(after.position).toBeGreaterThan(before.position);
  await marker(page, "in").locator("circle").click();
  await page.getByTestId("jack-label").fill("Input");
  // A pedal with the preset "keep adding" on still lets you switch the next jack's type.
  await expect(page.getByTestId("jacks-quick")).toBeEnabled();

  await page.getByTestId("jacks-save").click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0, { timeout: 15_000 });
  const saved = await (await page.request.get(`/api/catalog/devices/${prof.id}`)).json();
  expect(saved.ports.map((p: { id: string }) => p.id)).toEqual(["in", "out", "dc"]);
  const byId = Object.fromEntries(saved.ports.map((p: { id: string }) => [p.id, p]));
  expect(byId.in.label).toBe("Input");
  expect(byId.in.evidence).toBe("user");
  expect(byId.in.position_evidence).toBe("user");
  expect(byId.in.image_anchor.asset_id).toBe(prof.assetId);
  expect(byId.dc.edge).toBe("top");
  expect(byId.dc.kind).toBe("power");
  expect(byId.out.position).toBeCloseTo(after.position, 3);
  // Third-party dimensions and attribution are untouched.
  expect(saved.footprint.width.evidence).toBe("third_party");
  expect(saved.provenance.source).toBe("pedalplayground_import");

  // Place it on a board next to an amp and wire Out → amp input with the new jack.
  const rig = await (await page.request.post("/api/rigs", { data: { name: `E2E jacks ${Date.now()}` } })).json();
  createdRigs.push(rig.id);
  rig.instances = [
    { id: "inst_pedal", profile_id: prof.id, label: "Drive", x_mm: 100, y_mm: 60, rotation: 0, intentional_overlap: false, off_board: false, midi_channel: null, port_overrides: [], removed_port_ids: [] },
    { id: "inst_amp", profile_id: "generic-amp", label: "Amp", x_mm: 0, y_mm: 0, rotation: 0, intentional_overlap: false, off_board: true, midi_channel: null, port_overrides: [], removed_port_ids: [] },
  ];
  rig.revision += 1;
  expect((await page.request.put(`/api/rigs/${rig.id}`, { data: rig })).ok()).toBeTruthy();
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("port-inst_pedal-out")).toBeVisible();
  await dragPort(page, "port-inst_pedal-out", "port-inst_amp-input");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const stored = await (await page.request.get(`/api/rigs/${rig.id}`)).json();
  expect(stored.connections).toHaveLength(1);
  expect(stored.connections[0].source).toEqual({ instance_id: "inst_pedal", port_id: "out" });

  // Reload: the cable and the jack positions are intact, and the Board draws the pedal's photo.
  await page.reload();
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("port-inst_pedal-out")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Drive,/ }).locator('[data-testid="device-image"]')).toHaveCount(1);
  const analysis = await (await page.request.get(`/api/rigs/${rig.id}/analysis`)).json();
  const placed = Object.fromEntries(analysis.instances.inst_pedal.ports.map((p: { port_id: string }) => [p.port_id, p]));
  expect(placed.in.edge).toBe("right");
  expect(placed.out.edge).toBe("left");
  expect(placed.dc.edge).toBe("top");
  expect(placed.out.estimated).toBe(false);
  expect(analysis.diagnostics.filter((d: { code: string }) => d.code === "connection.port_missing")).toHaveLength(0);
});

test("jack mapping: existing jacks are shown and improvable; removing a wired jack needs an explicit decision", async ({ page }) => {
  // A custom copy of the generic mono pedal (its jacks have known positions) with a photo,
  // placed on a rig with a cable into its "in".
  const plumes = await (await page.request.get("/api/catalog/devices/generic-mono-effect")).json();
  delete plumes.unknown_attributes;
  delete plumes.source;
  const id = `e2e-mono-${Date.now().toString(36)}`;
  const asset = await (await page.request.post("/api/assets/images", { multipart: { file: { name: "pedal.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FIXTURE) } } })).json();
  const copy = { ...plumes, id, manufacturer: "E2E", model: `Mono copy ${id}`, builtin: false, image: { asset_id: asset.id, crop: CROP, rotation_quarter: 0, fit: "contain", calibrated: true } };
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  createdProfiles.push(id);
  const rig = await (await page.request.post("/api/rigs", { data: { name: `E2E jacks guard ${Date.now()}` } })).json();
  createdRigs.push(rig.id);
  rig.instances = [
    { id: "inst_p", profile_id: id, label: "Pedal", x_mm: 100, y_mm: 60, rotation: 0, intentional_overlap: false, off_board: false, midi_channel: null, port_overrides: [], removed_port_ids: [] },
    { id: "inst_g", profile_id: "generic-guitar", label: "Guitar", x_mm: 0, y_mm: 0, rotation: 0, intentional_overlap: false, off_board: true, midi_channel: null, port_overrides: [], removed_port_ids: [] },
  ];
  rig.connections = [{ id: "conn_e2e", kind: "audio", source: { instance_id: "inst_g", port_id: "out" }, target: { instance_id: "inst_p", port_id: "in" }, intentional: false }];
  rig.revision += 1;
  expect((await page.request.put(`/api/rigs/${rig.id}`, { data: rig })).ok()).toBeTruthy();

  // From the Board inspector this time.
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Pedal,/ }).click();
  await page.getByTestId("configure-jacks").scrollIntoViewIfNeeded();
  await page.getByTestId("configure-jacks").click();
  await expect(page.getByTestId("jacks-frame")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(200);
  // Existing jacks are drawn at their wiring position (dashed: not yet confirmed on this photo).
  await expect(marker(page, "in")).toHaveAttribute("data-derived", "true");
  await expect(marker(page, "out")).toHaveAttribute("data-derived", "true");
  await expect(page.getByTestId("jack-row-in")).toContainText("🔌1");
  // Drag "in" onto the connector: it becomes placed on this photo with user evidence, same id.
  await dragMarker(page, "in", 30, 40);
  await expect(marker(page, "in")).toHaveAttribute("data-derived", "false");
  // Remove "out" (unused) outright; try to remove "in" (used): warned, then saved → server refuses → keep.
  await marker(page, "out").locator("circle").click();
  await page.getByTestId("jack-remove").click();
  await expect(marker(page, "out")).toHaveCount(0);
  await marker(page, "in").locator("circle").click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("jack-remove").click();
  await expect(marker(page, "in")).toHaveCount(0);
  await page.getByTestId("jacks-save").click();
  const conflict = page.getByTestId("jacks-conflict");
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText("Guitar: out");
  await page.getByTestId("jacks-conflict-keep").click();
  await expect(conflict).toHaveCount(0);
  await expect(page.getByTestId("jack-row-in")).toBeVisible();
  await page.getByTestId("jacks-save").click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0, { timeout: 15_000 });
  let saved = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  expect(saved.ports.map((p: { id: string }) => p.id).sort()).toEqual(["dc_in", "in"]);
  const analysis = await (await page.request.get(`/api/rigs/${rig.id}/analysis`)).json();
  expect(analysis.diagnostics.filter((d: { code: string }) => d.code === "connection.port_missing")).toHaveLength(0);
  // The dimensions and photo were preserved while the jacks changed.
  expect(saved.footprint.width.value_mm).toBe(plumes.footprint.width.value_mm);
  expect(saved.image.asset_id).toBe(asset.id);

  // An explicit decision: remove the wired jack anyway. The cable is then flagged, not silently dropped.
  await page.getByTestId("configure-jacks").click();
  await expect(page.getByTestId("jacks-frame")).toBeVisible({ timeout: 15_000 });
  await marker(page, "in").locator("circle").click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("jack-remove").click();
  await page.getByTestId("jacks-save").click();
  await expect(page.getByTestId("jacks-conflict")).toBeVisible();
  await page.getByTestId("jacks-conflict-force").click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0, { timeout: 15_000 });
  saved = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  expect(saved.ports.map((p: { id: string }) => p.id)).toEqual(["dc_in"]);
  const after = await (await page.request.get(`/api/rigs/${rig.id}/analysis`)).json();
  expect(after.diagnostics.some((d: { code: string }) => d.code === "connection.port_missing")).toBe(true);
  const stored = await (await page.request.get(`/api/rigs/${rig.id}`)).json();
  expect(stored.connections).toHaveLength(1); // the cable itself was not deleted
});

test("jack mapping: anchors outside the crop survive a recrop; stereo template and TRS keep the conductor model", async ({ page }) => {
  const prof = await importedProfileWithPhoto(page, "ste");
  await openMapperFromLibrary(page, prof.title);
  await page.getByTestId("jack-template-stereo").click();
  await expect(page.getByTestId("jack-list")).toContainText("In L");
  // Place In L and In R on the right side, Out L / Out R on the left, DC above the crop.
  await clickPhoto(page, 0.7, 0.35);
  await clickPhoto(page, 0.7, 0.5);
  await clickPhoto(page, 0.19, 0.35);
  await clickPhoto(page, 0.19, 0.5);
  await clickPhoto(page, 0.45, 0.17);
  // Turn Out L into one TRS socket carrying L+R: it becomes a stereo_trs jack, not two sockets.
  await marker(page, "out_l").locator("circle").click();
  await page.getByTestId("jack-channel-stereo_trs").click();
  await page.getByTestId("jacks-save").click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0, { timeout: 15_000 });
  const saved = await (await page.request.get(`/api/catalog/devices/${prof.id}`)).json();
  const byId = Object.fromEntries(saved.ports.map((p: { id: string }) => [p.id, p]));
  expect(byId.in_l.audio_channel).toBe("left");
  expect(byId.in_r.audio_channel).toBe("right");
  expect(byId.in_l.pair_group).toBe("in");
  expect(byId.in_r.pair_group).toBe("in");
  expect(byId.out_l.audio_channel).toBe("stereo_trs");
  expect(byId.out_l.connector).toBe("trs_1_4");
  expect(byId.out_l.trs_role).toBe("stereo");
  expect(byId.out_r.audio_channel).toBe("right");
  expect(byId.dc.image_anchor.y).toBeLessThan(CROP.y);
  expect(saved.ports).toHaveLength(5);

  // Recrop the photo (tighter): anchors and wiring positions are unchanged, and the mapper still
  // shows the markers where they were placed.
  delete saved.unknown_attributes;
  delete saved.source;
  saved.image.crop = { x: 0.25, y: 0.25, w: 0.4, h: 0.5 };
  expect((await page.request.put(`/api/catalog/devices/${prof.id}`, { data: saved })).ok()).toBeTruthy();
  const again = await (await page.request.get(`/api/catalog/devices/${prof.id}`)).json();
  expect(again.ports).toEqual(saved.ports);
  await openMapperFromLibrary(page, prof.title);
  const dc = await markerData(page, "dc");
  expect(dc.x).toBeCloseTo(0.45, 2);
  expect(dc.y).toBeCloseTo(0.17, 2);
  expect(dc.edge).toBe("top");
  await expect(marker(page, "dc")).toHaveAttribute("data-derived", "false");
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0);
});
