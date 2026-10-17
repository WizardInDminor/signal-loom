import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Session 3d: a usability pass after the first hands-on testing. Fit really fits (both
// dimensions, padding, follows resizes until the user picks a zoom), the Board has an expanded
// workspace, and the jack mapper centres the photograph with breathing room at every zoom.

const LANDSCAPE = path.join(__dirname, "fixtures", "pedal-photo-landscape.jpg");
const createdRigs: string[] = [];
const createdProfiles: string[] = [];

test.afterEach(async ({ page }) => {
  while (createdRigs.length) await page.request.delete(`/api/rigs/${createdRigs.pop()}`);
  while (createdProfiles.length) await page.request.delete(`/api/catalog/devices/${createdProfiles.pop()}`);
  await page.request.delete("/api/assets/images/unreferenced");
});

async function openCopy(page: Page) {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Stereo demo"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E workspace ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  createdRigs.push(rig.id);
  await page.goto(`/rigs/${rig.id}`);
  await expect(page.getByTestId("board-canvas")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  return rig.id as string;
}

type Box = { x: number; y: number; width: number; height: number };
const box = async (page: Page, id: string): Promise<Box> => (await page.getByTestId(id).boundingBox())!;
const inside = (inner: Box, outer: Box, slack = 1) =>
  inner.x >= outer.x - slack && inner.y >= outer.y - slack && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
const scrollState = (page: Page, id: string) => page.getByTestId(id).evaluate((el) => ({ sw: el.scrollWidth, sh: el.scrollHeight, cw: el.clientWidth, ch: el.clientHeight }));

/** The whole drawing is visible inside the canvas area, with room to spare, and nothing scrolls. */
async function expectFitted(page: Page) {
  const vp = await box(page, "board-viewport");
  const canvas = await box(page, "board-canvas");
  expect(inside(canvas, vp)).toBeTruthy();
  const s = await scrollState(page, "board-viewport");
  expect(s.sw).toBeLessThanOrEqual(s.cw + 1);
  expect(s.sh).toBeLessThanOrEqual(s.ch + 1);
  // Padding: the drawing is not pressed against either edge.
  expect(canvas.width).toBeLessThan(vp.width - 16);
  expect(canvas.height).toBeLessThan(vp.height - 16);
  return { vp, canvas };
}

test("board: Fit fits both dimensions with padding, follows window resizes, and leaves a hand-picked zoom alone until pressed again", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openCopy(page);
  // Opening a rig fits it; the canvas area ends inside the window, so nothing needs page scrolling.
  let { vp, canvas } = await expectFitted(page);
  expect(vp.y + vp.height).toBeLessThanOrEqual(800);
  // A short, wide window: height is the limit now (width to spare), and the whole board is still on
  // screen unless the canvas's 320 px floor binds (the toolbar above wraps differently per platform).
  await page.setViewportSize({ width: 1400, height: 720 });
  await page.waitForTimeout(400);
  ({ vp, canvas } = await expectFitted(page));
  expect(canvas.width).toBeLessThan(vp.width - 100);
  expect(vp.y + vp.height).toBeLessThanOrEqual(Math.max(720, vp.y + 320 + 1));
  // A tall, narrow window: width is the limit.
  await page.setViewportSize({ width: 900, height: 1000 });
  await page.waitForTimeout(400);
  ({ vp, canvas } = await expectFitted(page));
  expect(vp.y + vp.height).toBeLessThanOrEqual(1000);
  // The user picks a zoom: the canvas now overflows and scrolls, and a resize does not undo the choice.
  await page.getByLabel("Zoom").fill("3");
  await page.waitForTimeout(200);
  let s = await scrollState(page, "board-viewport");
  expect(s.sw).toBeGreaterThan(s.cw);
  await expect(page.getByText("Zoom 3.0 px/mm")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(400);
  await expect(page.getByText("Zoom 3.0 px/mm")).toBeVisible();
  s = await scrollState(page, "board-viewport");
  expect(s.sw).toBeGreaterThan(s.cw);
  // Fit again: fitted, and following resizes once more.
  await page.getByTestId("board-fit").click();
  await page.waitForTimeout(200);
  await expectFitted(page);
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.waitForTimeout(400);
  await expectFitted(page);
});

test("board: the expanded workspace gives the board the window, keeps the controls and inspector, and editing works inside it", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const rigId = await openCopy(page);
  const before = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  await page.getByTestId("board-expand").click();
  await expect(page.getByTestId("board-workspace")).toHaveAttribute("data-expanded", "true");
  let vp = await box(page, "board-viewport");
  expect(vp.width).toBeGreaterThan(1280 * 0.65); // with the inspector column open
  expect(vp.height).toBeGreaterThan(800 * 0.7);
  await expectFitted(page); // the fit followed the new area
  // Essential controls are there; the inspector column is a toggle.
  for (const name of ["Fit", "Undo", "Redo"]) await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(page.getByLabel("Zoom")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /midi/ })).toBeVisible();
  await expect(page.getByTestId("board-side")).toBeVisible();
  await page.getByTestId("board-side-toggle").click();
  await expect(page.getByTestId("board-side")).toHaveCount(0);
  vp = await box(page, "board-viewport");
  expect(vp.width).toBeGreaterThan(1280 * 0.95);
  await expectFitted(page);
  await page.getByTestId("board-side-toggle").click();
  await expect(page.getByTestId("board-side")).toBeVisible();
  // Select, drag and wire inside the expanded workspace.
  const plumes = page.getByRole("button", { name: /^Plumes,/ });
  await plumes.click();
  await expect(page.getByTestId("board-side").getByLabel("Label")).toHaveValue("Plumes");
  const pb = (await plumes.boundingBox())!;
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await page.mouse.down();
  await page.mouse.move(pb.x + pb.width / 2 + 40, pb.y + pb.height / 2 + 60, { steps: 6 });
  await page.mouse.up();
  const x0 = before.instances.find((i: { label: string }) => i.label === "Plumes").x_mm;
  await expect(plumes).not.toHaveAccessibleName(new RegExp(` at ${x0}, `));
  const a = (await page.getByTestId("port-inst_ml10x-send_d_tip").boundingBox())!;
  const b = (await page.getByTestId("port-inst_bigsky-in_r").boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  // Esc restores the regular layout with the edits intact.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("board-workspace")).toHaveAttribute("data-expanded", "false");
  await expect(page.getByText("Board diagnostics")).toBeVisible();
  const after = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(after.connections.length).toBe(before.connections.length + 1);
  expect(after.instances.find((i: { label: string }) => i.label === "Plumes").x_mm).not.toBe(x0);
  // The Exit button works too, and the pending-cable Esc still belongs to the canvas.
  await page.getByTestId("board-expand").click();
  await expect(page.getByTestId("board-workspace")).toHaveAttribute("data-expanded", "true");
  await page.getByRole("button", { name: "⤡ Exit" }).click();
  await expect(page.getByTestId("board-workspace")).toHaveAttribute("data-expanded", "false");
});

test("jack mapper: the photo is centred with margin at every window size, top-edge markers stay visible, zoom scrolls to everything, coordinates stay exact", async ({ page }) => {
  const base = await (await page.request.get("/api/catalog/devices/generic-mono-effect")).json();
  delete base.unknown_attributes;
  delete base.source;
  const id = `e2e-ws-${Date.now().toString(36)}`;
  const asset = await (await page.request.post("/api/assets/images", { multipart: { file: { name: "pedal.jpg", mimeType: "image/jpeg", buffer: fs.readFileSync(LANDSCAPE) } } })).json();
  const crop = { x: 0.05, y: 0.08, w: 0.9, h: 0.84 };
  const prof = { ...base, id, manufacturer: "E2E", model: `Wide ${id}`, builtin: false, ports: [], footprint: { ...base.footprint, width: { ...base.footprint.width, value_mm: 120 }, depth: { ...base.footprint.depth, value_mm: 70 } }, image: { asset_id: asset.id, crop, rotation_quarter: 0, fit: "contain", calibrated: true } };
  expect((await page.request.post("/api/catalog/devices", { data: prof })).ok()).toBeTruthy();
  createdProfiles.push(id);

  const open = async () => {
    await page.goto("/catalog");
    await page.getByRole("button", { name: `E2E Wide ${id}` }).click();
    await page.getByTestId("configure-jacks").scrollIntoViewIfNeeded();
    await page.getByTestId("configure-jacks").click();
    await expect(page.getByTestId("jacks-frame")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
  };
  const expectCentred = async () => {
    const sb = await box(page, "jacks-scroll");
    const fb = await box(page, "jacks-frame");
    const top = fb.y - sb.y;
    const bottom = sb.y + sb.height - (fb.y + fb.height);
    const left = fb.x - sb.x;
    const right = sb.x + sb.width - (fb.x + fb.width);
    expect(Math.abs(top - bottom)).toBeLessThan(3);
    expect(Math.abs(left - right)).toBeLessThan(3);
    expect(Math.min(top, bottom, left, right)).toBeGreaterThanOrEqual(24); // breathing room on every side
    expect(inside(fb, sb)).toBeTruthy();
    return { sb, fb };
  };

  for (const size of [{ width: 1280, height: 800 }, { width: 1024, height: 680 }, { width: 1600, height: 1000 }]) {
    await page.setViewportSize(size);
    await open();
    await expectCentred();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("jack-mapper")).toHaveCount(0);
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await open();
  const { sb } = await expectCentred();
  // A connector right at the top edge of the photo: the click lands where it should and the
  // marker (and its label above) are fully visible inside the dark area.
  const ov = await box(page, "jacks-overlay");
  await page.mouse.click(ov.x + 0.3 * ov.width, ov.y + 0.03 * ov.height);
  const m = page.getByTestId("jack-marker-in");
  expect(Number(await m.getAttribute("data-x"))).toBeCloseTo(0.3, 2);
  expect(Number(await m.getAttribute("data-y"))).toBeCloseTo(0.03, 2);
  expect(await m.getAttribute("data-edge")).toBe("top");
  const mb = (await m.locator("circle").boundingBox())!;
  expect(inside(mb, sb)).toBeTruthy();
  expect(mb.y).toBeGreaterThan(sb.y + 8);
  // Zoom: the frame outgrows the area, scrolls, and the far corner (with its margin) is reachable.
  await page.getByLabel("Zoom").fill("2.5");
  await page.waitForTimeout(300);
  const s = await scrollState(page, "jacks-scroll");
  expect(s.sh).toBeGreaterThan(s.ch);
  expect(s.sw).toBeGreaterThan(s.cw);
  await page.getByTestId("jacks-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; el.scrollLeft = el.scrollWidth; });
  await page.waitForTimeout(200);
  const fb2 = await box(page, "jacks-frame");
  const sb2 = await box(page, "jacks-scroll");
  expect(fb2.y + fb2.height).toBeLessThanOrEqual(sb2.y + sb2.height - 24);
  expect(fb2.x + fb2.width).toBeLessThanOrEqual(sb2.x + sb2.width - 24);
  // Coordinates are still exact at this zoom: the marker reports the same photo position.
  expect(Number(await m.getAttribute("data-x"))).toBeCloseTo(0.3, 2);
  expect(Number(await m.getAttribute("data-y"))).toBeCloseTo(0.03, 2);
  await page.getByTestId("jacks-scroll").evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; });
  const ov2 = await box(page, "jacks-overlay");
  await page.mouse.click(ov2.x + 0.1 * ov2.width, ov2.y + 0.2 * ov2.height);
  const m2 = page.getByTestId("jack-marker-in_2");
  expect(Number(await m2.getAttribute("data-x"))).toBeCloseTo(0.1, 2);
  expect(Number(await m2.getAttribute("data-y"))).toBeCloseTo(0.2, 2);
  await page.getByTestId("jacks-save").click();
  await expect(page.getByTestId("jack-mapper")).toHaveCount(0, { timeout: 15_000 });
  const saved = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  expect(saved.ports.map((p: { id: string }) => p.id)).toEqual(["in", "in_2"]);
  expect(saved.ports[0].image_anchor.y).toBeCloseTo(0.03, 2);
});
