import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// Session 3b: user device pictures. A guitarist photographs a pedal, draws a box around the
// enclosure, and sees it at physical scale on the Board and the Stage; the picture is a visual
// layer only, so jacks, rotation and persistence behave exactly as before.

const FIXTURE = path.join(__dirname, "fixtures", "pedal-photo.jpg");
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
  const ov2 = await page.getByTestId("crop-overlay").boundingBox(); // unchecking may have scrolled the page
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
