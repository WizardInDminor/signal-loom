import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Session 3b: user device pictures. A guitarist photographs a pedal, draws a box around the
// enclosure, and sees it at physical scale on the Board and the Stage; the picture is a visual
// layer only, so jacks, rotation and persistence behave exactly as before.

const FIXTURE = path.join(__dirname, "fixtures", "pedal-photo.jpg");
const LANDSCAPE = path.join(__dirname, "fixtures", "pedal-photo-landscape.jpg"); // 1200 × 900, pedal lying sideways
const created: string[] = [];
const createdProfiles: string[] = [];

async function openCopy(page: Page, hash = "") {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  // Each test gets its own copy of the Plumes profile too, so the demo library is never changed.
  const profileId = `e2e-plumes-${Date.now().toString(36)}`;
  const plumes = exported.profiles.find((p: { id: string }) => p.id === "eqd-plumes");
  const copy = { ...plumes, id: profileId, manufacturer: "E2E", model: `Test pedal ${profileId}`, builtin: false, provenance: { ...plumes.provenance, source: "user", evidence: "user" } };
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  createdProfiles.push(profileId);
  exported.profiles = exported.profiles.filter((p: { id: string }) => p.id !== "eqd-plumes");
  for (const i of exported.rig.instances) if (i.profile_id === "eqd-plumes") i.profile_id = profileId;
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E images ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  await page.goto(`/rigs/${rig.id}${hash}`);
  await expect(page.getByTestId("error-banner")).toHaveCount(0);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  return { rigId: rig.id as string, profileId };
}

test.afterEach(async ({ page }) => {
  // Remove the test rigs and profiles, then every asset they referenced (now unreferenced).
  const assetIds = new Set<string>();
  for (const id of created) {
    const rig = await (await page.request.get(`/api/rigs/${id}`)).json().catch(() => null);
    for (const i of rig?.instances ?? []) if (i.image?.asset_id) assetIds.add(i.image.asset_id);
  }
  for (const id of createdProfiles) {
    const prof = await (await page.request.get(`/api/catalog/devices/${id}`)).json().catch(() => null);
    if (prof?.image?.asset_id) assetIds.add(prof.image.asset_id);
  }
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
  while (createdProfiles.length) await page.request.delete(`/api/catalog/devices/${createdProfiles.pop()}`);
  for (const id of assetIds) await page.request.delete(`/api/assets/images/${id}`);
});

async function dragBy(page: Page, testId: string, dx: number, dy: number) {
  const b = await page.getByTestId(testId).boundingBox();
  expect(b).toBeTruthy();
  await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width / 2 + dx / 2, b!.y + b!.height / 2 + dy / 2, { steps: 4 });
  await page.mouse.move(b!.x + b!.width / 2 + dx, b!.y + b!.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

test("pictures: upload, crop with handles and lock, save, see it at scale on the Board and Stage, rotate, persist, remove", async ({ page }) => {
  const { rigId, profileId } = await openCopy(page);
  // Select Plumes on the board; the inspector offers to add a picture for every unit of this profile.
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  const section = page.getByTestId("profile-image");
  await section.scrollIntoViewIfNeeded();
  await expect(section.getByTestId("profile-image-add")).toBeVisible();

  // An unsupported file is refused with a useful message and nothing is stored.
  const assetsBefore = (await (await page.request.get("/api/assets/images")).json()).length;
  await section.getByTestId("profile-image-file").setInputFiles({ name: "evil.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>") });
  await expect(section.getByTestId("profile-image-error")).toContainText("SVG");
  expect((await (await page.request.get("/api/assets/images")).json()).length).toBe(assetsBefore);

  // A real photograph opens the crop editor with a selection locked to the pedal's 64 × 121 mm.
  await section.getByTestId("profile-image-file").setInputFiles(FIXTURE);
  const editor = page.getByTestId("image-crop-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByTestId("crop-lock")).toBeChecked();
  const rect = editor.getByTestId("crop-rect");
  const before = { w: Number(await rect.getAttribute("data-w")), h: Number(await rect.getAttribute("data-h")) };
  // Locked aspect: (w*900)/(h*1200) == 64/121.
  expect(Math.abs((before.w * 900) / (before.h * 1200) - 64 / 121)).toBeLessThan(0.01);
  await expect(editor.getByTestId("crop-fit-report")).toContainText("fills the footprint exactly");

  // Resize from the south-east handle: the lock keeps the proportions.
  await dragBy(page, "crop-handle-se", -40, -40);
  const after = { w: Number(await rect.getAttribute("data-w")), h: Number(await rect.getAttribute("data-h")) };
  expect(after.w).toBeLessThan(before.w);
  expect(Math.abs((after.w * 900) / (after.h * 1200) - 64 / 121)).toBeLessThan(0.01);
  // Move the selection by dragging inside it.
  const xBefore = Number(await rect.getAttribute("data-x"));
  const overlay = await page.getByTestId("crop-overlay").boundingBox();
  const sel = { x: overlay!.x + Number(await rect.getAttribute("data-x")) * overlay!.width, y: overlay!.y + Number(await rect.getAttribute("data-y")) * overlay!.height };
  await page.mouse.move(sel.x + 20, sel.y + 20);
  await page.mouse.down();
  await page.mouse.move(sel.x + 50, sel.y + 20, { steps: 4 });
  await page.mouse.up();
  expect(Number(await rect.getAttribute("data-x"))).toBeGreaterThan(xBefore);
  // Unlock and draw a fresh, deliberately wide box: the report explains the margins instead of stretching.
  await editor.getByTestId("crop-lock").uncheck();
  await page.getByTestId("crop-overlay").scrollIntoViewIfNeeded(); // unchecking scrolled the page; bring the photo back
  const ov2 = await page.getByTestId("crop-overlay").boundingBox();
  await page.mouse.move(ov2!.x + 10, ov2!.y + 10);
  await page.mouse.down();
  await page.mouse.move(ov2!.x + ov2!.width - 10, ov2!.y + ov2!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(editor.getByTestId("crop-fit-report")).toContainText("wider than the 64 × 121 mm footprint");
  await expect(editor.getByTestId("crop-fit-report")).toContainText("bands top and bottom");
  await editor.getByTestId("crop-fit-cover").check();
  await expect(editor.getByTestId("crop-fit-report")).toContainText("clips");
  // Back to a locked, centred selection and save.
  await editor.getByTestId("crop-lock").check();
  await editor.getByRole("button", { name: "Centre at enclosure ratio" }).click();
  await editor.getByTestId("crop-save").click();
  await expect(editor).toHaveCount(0, { timeout: 15_000 });
  await expect(section.getByTestId("profile-image-thumb")).toBeVisible();
  await expect(section).toContainText("calibrated to 64 × 121 mm");

  // The Board draws the photograph inside Plumes' footprint; jacks are still where they were.
  const board = page.getByTestId("board-canvas");
  const plumesGlyph = () => page.getByRole("button", { name: /^Plumes,/ });
  const img = plumesGlyph().locator('[data-testid="device-image"]');
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("data-fit", "cover");
  const jack = page.getByTestId("port-inst_plumes-in");
  await expect(jack).toBeVisible();
  const jackBefore = await jack.boundingBox();
  // Rotation turns the picture with the device and moves the jacks exactly as before.
  await page.getByLabel("Rotation").selectOption("90");
  await expect(page.getByRole("button", { name: /^Plumes, 121 by 64 mm/ })).toBeVisible();
  const jackAfter = await jack.boundingBox();
  expect(Math.abs(jackAfter!.x - jackBefore!.x) + Math.abs(jackAfter!.y - jackBefore!.y)).toBeGreaterThan(5);
  await expect(img).toHaveCount(1);
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

  // The profile persisted the crop metadata (not the photograph) and the stored asset is sanitized.
  const prof = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  expect(prof.image.asset_id).toMatch(/^img_[0-9a-f]{12}$/);
  expect(prof.image.calibrated).toBe(true);
  expect(prof.image.fit).toBe("cover");
  expect(prof.footprint.width.value_mm).toBe(64); // physical data untouched
  const served = await page.request.get(`/api/assets/images/${prof.image.asset_id}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/jpeg");

  // Reload: the picture is still there (served from the asset store, crop from the profile).
  await page.reload();
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await expect(plumesGlyph().locator('[data-testid="device-image"]')).toHaveCount(1);

  // The Stage shows the same picture under its overlays (LED, state line, path).
  await page.getByRole("tab", { name: "stage" }).click();
  const stageDevice = page.getByTestId("stage-device-inst_plumes");
  await expect(stageDevice.locator('[data-testid="device-image"]')).toHaveCount(1);
  await expect(stageDevice).toHaveAttribute("data-state", /engaged|bypassed|unset/);
  await expect(page.getByTestId("stage-path-L")).toBeVisible();
  // Rig library miniature carries it too.
  await page.goto("/");
  const card = page.getByRole("listitem").filter({ hasText: "E2E images" }).locator('[data-testid="rig-preview"] [data-testid="device-image"]');
  await expect(card.first()).toBeVisible();

  // Recrop reopens the editor with the saved selection; removing restores the plain enclosure.
  await page.goto(`/rigs/${rigId}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  await page.getByTestId("profile-image-recrop").click();
  await expect(page.getByTestId("image-crop-editor")).toBeVisible();
  await expect(page.getByTestId("crop-rect")).toHaveAttribute("data-w", String(prof.image.crop.w.toFixed(4)));
  await page.getByRole("button", { name: "Cancel" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("profile-image-remove").click();
  await expect(page.getByTestId("profile-image-add")).toBeVisible({ timeout: 15_000 });
  await expect(plumesGlyph().locator('[data-testid="device-image"]')).toHaveCount(0);
  void board;
  const prof2 = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  expect(prof2.image).toBeNull();
  expect(prof2.ports.length).toBe(prof.ports.length);
});

test("pictures: a device without dimensions can be cropped but is not called calibrated; an instance override applies to one unit", async ({ page }) => {
  const { profileId } = await openCopy(page);
  // Strip the dimensions from the test profile.
  const prof = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  delete prof.unknown_attributes;
  delete prof.source;
  prof.footprint.width.value_mm = null;
  prof.footprint.depth.value_mm = null;
  expect((await page.request.put(`/api/catalog/devices/${profileId}`, { data: prof })).ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Plumes,/ }).click();
  const section = page.getByTestId("profile-image");
  await section.scrollIntoViewIfNeeded();
  await section.getByTestId("profile-image-file").setInputFiles(FIXTURE);
  const editor = page.getByTestId("image-crop-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByTestId("crop-lock")).toBeDisabled();
  await expect(editor.getByTestId("crop-fit-report")).toContainText("cannot be calibrated");
  await editor.getByTestId("crop-save").click();
  await expect(section).toContainText("not calibrated", { timeout: 15_000 });

  // Instance override: a different crop for this one unit only.
  await page.getByTestId("instance-image-details").locator("summary").click();
  const inst = page.getByTestId("instance-image");
  await inst.getByTestId("instance-image-file").setInputFiles(FIXTURE);
  await expect(page.getByTestId("image-crop-editor")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Whole picture" }).click();
  await page.getByTestId("crop-save").click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rigId = page.url().split("/rigs/")[1].split("#")[0];
  const rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const plumes = rig.instances.find((i: { id: string }) => i.id === "inst_plumes");
  expect(plumes.image.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  expect(plumes.image.calibrated).toBe(false);
  const a = await (await page.request.get(`/api/rigs/${rigId}/analysis`)).json();
  expect(a.instances.inst_plumes.image.source).toBe("instance");
  // A plain project export stays format 1 with no binary data; the opt-in bundle carries it.
  const plain = await (await page.request.get(`/api/rigs/${rigId}/export`)).json();
  expect(plain.format_version).toBe(1);
  expect(plain.assets).toEqual([]);
  const bundled = await (await page.request.get(`/api/rigs/${rigId}/export?include_images=1`)).json();
  expect(bundled.format_version).toBe(2);
  expect(bundled.assets.length).toBeGreaterThanOrEqual(1);
});

/** A throwaway profile with Plumes' dimensions, visible in the Device library. */
async function createTestProfile(page: Page) {
  const plumes = await (await page.request.get("/api/catalog/devices/eqd-plumes")).json();
  delete plumes.unknown_attributes;
  delete plumes.source;
  const profileId = `e2e-pedal-${Date.now().toString(36)}`;
  const copy = { ...plumes, id: profileId, manufacturer: "E2E", model: `Test pedal ${profileId}`, builtin: false, provenance: { ...plumes.provenance, source: "user", evidence: "user" } };
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  createdProfiles.push(profileId);
  return profileId;
}

const assetCount = async (page: Page) => ((await (await page.request.get("/api/assets/images")).json()) as unknown[]).length;
const pxAspect = async (page: Page, imgW: number, imgH: number) => {
  const r = page.getByTestId("crop-rect");
  return (Number(await r.getAttribute("data-w")) * imgW) / (Number(await r.getAttribute("data-h")) * imgH);
};

test("pictures: the crop editor is usable at phone width with a landscape photograph, without horizontal overflow", async ({ page }) => {
  const profileId = await createTestProfile(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/catalog");
  await page.getByRole("button", { name: new RegExp(`Test pedal ${profileId}`) }).click();
  const section = page.getByTestId("device-image-section");
  await section.scrollIntoViewIfNeeded();
  await section.getByTestId("device-image-section-file").setInputFiles(LANDSCAPE);
  const editor = page.getByTestId("image-crop-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  // The canvas shrinks to the phone's width and the page does not scroll sideways.
  const frame = await page.getByTestId("crop-frame").boundingBox();
  expect(frame!.width).toBeLessThanOrEqual(390);
  expect(frame!.width).toBeGreaterThan(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // The lock is on and the selection has the 64 × 121 proportions in the landscape picture's pixels.
  await expect(editor.getByTestId("crop-lock")).toBeChecked();
  expect(Math.abs((await pxAspect(page, 1200, 900)) - 64 / 121)).toBeLessThan(0.01);
  // Resizing with a handle works at this scale: the normalized coordinates stay exact and in bounds.
  const rect = editor.getByTestId("crop-rect");
  const wBefore = Number(await rect.getAttribute("data-w"));
  await editor.getByTestId("crop-handle-se").scrollIntoViewIfNeeded();
  await dragBy(page, "crop-handle-se", -25, -25);
  const after = { x: Number(await rect.getAttribute("data-x")), y: Number(await rect.getAttribute("data-y")), w: Number(await rect.getAttribute("data-w")), h: Number(await rect.getAttribute("data-h")) };
  expect(after.w).toBeLessThan(wBefore);
  expect(after.x).toBeGreaterThanOrEqual(0);
  expect(after.x + after.w).toBeLessThanOrEqual(1.0001);
  expect(after.y + after.h).toBeLessThanOrEqual(1.0001);
  expect(Math.abs((await pxAspect(page, 1200, 900)) - 64 / 121)).toBeLessThan(0.01);
  // Move it by dragging inside (touch-sized target), then save: the stored crop equals what was shown.
  const frame2 = await page.getByTestId("crop-frame").boundingBox();
  const cx = frame2!.x + (after.x + after.w / 2) * frame2!.width;
  const cy = frame2!.y + (after.y + after.h / 2) * frame2!.height;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy, { steps: 4 });
  await page.mouse.up();
  const shown = { x: Number(await rect.getAttribute("data-x")), w: Number(await rect.getAttribute("data-w")) };
  expect(shown.x).toBeGreaterThan(after.x);
  await editor.getByTestId("crop-save").click();
  await expect(editor).toHaveCount(0, { timeout: 15_000 });
  const prof = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  expect(prof.image.crop.x).toBeCloseTo(shown.x, 3);
  expect(prof.image.crop.w).toBeCloseTo(shown.w, 3);
  expect(prof.image.calibrated).toBe(true);
});

test("pictures: cancelled and replaced uploads are reclaimed; the library offers cleanup of unused pictures", async ({ page }) => {
  const profileId = await createTestProfile(page);
  await page.goto("/catalog");
  await page.getByRole("button", { name: new RegExp(`Test pedal ${profileId}`) }).click();
  const section = page.getByTestId("device-image-section");
  await section.scrollIntoViewIfNeeded();
  const baseline = await assetCount(page);
  // Upload, replace twice inside the editor, then cancel: every upload of this attempt is gone.
  await section.getByTestId("device-image-section-file").setInputFiles(FIXTURE);
  const editor = page.getByTestId("image-crop-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => assetCount(page)).toBe(baseline + 1);
  await editor.locator('input[type="file"]').setInputFiles(LANDSCAPE);
  await expect.poll(() => assetCount(page)).toBe(baseline + 2);
  await editor.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(() => assetCount(page)).toBe(baseline);
  expect((await (await page.request.get(`/api/catalog/devices/${profileId}`)).json()).image).toBeNull();
  // Save one, then replace it: the old picture is reclaimed because nothing uses it any more.
  await section.getByTestId("device-image-section-file").setInputFiles(FIXTURE);
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.getByTestId("crop-save").click();
  await expect(section.getByTestId("device-image-section-thumb")).toBeVisible({ timeout: 15_000 });
  const first = (await (await page.request.get(`/api/catalog/devices/${profileId}`)).json()).image.asset_id as string;
  await section.getByRole("button", { name: "Replace…" }).click({ trial: true }); // the button exists; the hidden input does the work
  await section.getByTestId("device-image-section-file").setInputFiles(LANDSCAPE);
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await editor.getByTestId("crop-save").click();
  await expect(editor).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => (await page.request.get(`/api/assets/images/${first}`)).status()).toBe(404);
  await expect.poll(() => assetCount(page)).toBe(baseline + 1);
  // An orphan created outside the editor shows up in the library's cleanup panel and can be removed there.
  const unusedBefore = ((await (await page.request.get("/api/assets/images")).json()) as { referenced: boolean }[]).filter((a) => !a.referenced).length;
  const orphan = await page.request.post("/api/assets/images", { multipart: { file: { name: "orphan.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(FIXTURE) } } });
  expect(orphan.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("asset-unused-count")).toHaveText(String(unusedBefore + 1));
  page.once("dialog", (d) => d.accept());
  await page.getByTestId("asset-cleanup-remove").click();
  await expect(page.getByTestId("asset-unused-count")).toHaveText("0");
  const remaining = (await (await page.request.get("/api/assets/images")).json()) as { id: string; referenced: boolean }[];
  expect(remaining.every((a) => a.referenced)).toBe(true); // only pictures still in use survive
  const usedId = (await (await page.request.get(`/api/catalog/devices/${profileId}`)).json()).image.asset_id as string;
  expect(remaining.some((a) => a.id === usedId)).toBe(true);
});

test("pictures: replacing a photograph with different proportions keeps the lock honest", async ({ page }) => {
  const profileId = await createTestProfile(page);
  await page.goto("/catalog");
  await page.getByRole("button", { name: new RegExp(`Test pedal ${profileId}`) }).click();
  const section = page.getByTestId("device-image-section");
  await section.scrollIntoViewIfNeeded();
  await section.getByTestId("device-image-section-file").setInputFiles(FIXTURE); // 900 × 1200 portrait
  const editor = page.getByTestId("image-crop-editor");
  await expect(editor).toBeVisible({ timeout: 15_000 });
  const portrait = { w: Number(await editor.getByTestId("crop-rect").getAttribute("data-w")), h: Number(await editor.getByTestId("crop-rect").getAttribute("data-h")) };
  expect(Math.abs((portrait.w * 900) / (portrait.h * 1200) - 64 / 121)).toBeLessThan(0.01);
  // Replace inside the editor with the 1200 × 900 landscape picture: the same normalized crop
  // would no longer have the footprint's proportions, so it is reconciled while the lock stays on.
  await editor.locator('input[type="file"]').setInputFiles(LANDSCAPE);
  await expect(editor.getByText("1200 × 900 px stored copy")).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByTestId("crop-lock")).toBeChecked();
  expect(Math.abs((await pxAspect(page, 1200, 900)) - 64 / 121)).toBeLessThan(0.01);
  await expect(editor.getByTestId("crop-fit-report")).toContainText("fills the footprint exactly");
  // Same guarantee when a saved picture is replaced from the section (editor opens on the saved crop).
  await editor.getByTestId("crop-save").click();
  await expect(section.getByTestId("device-image-section-thumb")).toBeVisible({ timeout: 15_000 });
  await section.getByTestId("device-image-section-file").setInputFiles(FIXTURE);
  await expect(editor.getByText("900 × 1200 px stored copy")).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByTestId("crop-lock")).toBeChecked();
  expect(Math.abs((await pxAspect(page, 900, 1200)) - 64 / 121)).toBeLessThan(0.01);
  await editor.getByRole("button", { name: "Cancel" }).click();
});
