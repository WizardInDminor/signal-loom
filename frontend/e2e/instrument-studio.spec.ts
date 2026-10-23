import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Instrument Studio (Team A, A-02): a guitarist opens a Texture on a real rig whose pedal profile
// carries controls entered the Session 6 way, finds a documented control by its musical name,
// maps it to the macro, reads direction and extent off the rail, flips one, previews with the
// macro while nothing is transmitted, accepts a grouping suggestion, saves and reopens. Everything
// is offline; the manual is the synthetic three-page fixture.

const MANUAL = path.join(__dirname, "fixtures", "manual.pdf");
const created: string[] = [];
const createdProfiles: string[] = [];

async function volanteProfile(page: Page) {
  const sunset = await (await page.request.get("/api/catalog/devices/strymon-sunset")).json();
  const id = `e2e-volante-${Date.now().toString(36)}`;
  const copy = { ...sunset, id, manufacturer: "Strymon", model: "Volante", builtin: false, tags: [], capabilities: {}, provenance: { ...sunset.provenance, source: "user", evidence: "user" } };
  copy.midi = { ...copy.midi, cc_map: [], commands: [], bypass: { evidence: "unknown" } };
  delete copy.unknown_attributes; delete copy.source; delete copy.document_files;
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  createdProfiles.push(id);
  const doc = await page.request.post(`/api/catalog/devices/${id}/documents`, { multipart: { title: "Volante MIDI guide", kind: "midi_chart", file: { name: "manual.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(MANUAL) } } });
  expect(doc.ok()).toBeTruthy();
  const docId = (await doc.json()).documents[0].document_id as string;
  // Knowledge as the Workbench stores it: a cited continuous control with a documented range, a
  // continuous one without, a trigger, a proposal awaiting review, and a control nobody described.
  const cc_map = [
    { cc: 12, name: "Echo Level", evidence: "documented", behavior: "continuous", continuous: true, min_value: 10, max_value: 120, citation: { document_id: docId, page: 2, note: null }, hardware_status: "unverified", mapping: "manufacturer_default" },
    { cc: 3, name: "Delay A Mix", evidence: "documented", behavior: "continuous", continuous: true, hardware_status: "unverified", mapping: "manufacturer_default" },
    { cc: 20, name: "Tap tempo", evidence: "documented", behavior: "trigger", continuous: false, hardware_status: "unverified", mapping: "manufacturer_default" },
    { cc: 21, name: "Time", evidence: "documented", behavior: "continuous", continuous: true, review_status: "proposed", hardware_status: "unverified", mapping: "manufacturer_default" },
    { cc: 100, name: "Expression", evidence: "unknown", hardware_status: "unverified", mapping: "manufacturer_default" },
  ];
  expect((await page.request.put(`/api/catalog/devices/${id}/controls`, { data: { cc_map } })).ok()).toBeTruthy();
  return id;
}

/** A copy of the demo rig whose Sunset is now a Volante using the profile copy. */
async function rigWith(page: Page, profileId: string) {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  exported.profiles = exported.profiles.filter((p: { id: string }) => p.id !== "strymon-sunset");
  let instId = "";
  for (const i of exported.rig.instances) if (i.profile_id === "strymon-sunset") { i.profile_id = profileId; i.label = "Volante"; instId = i.id; }
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E studio ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  return { rigId: rig.id as string, instId };
}

async function sentOrQueued(page: Page, rigId: string) {
  const ev = await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json();
  return ev.log.filter((e: { kind: string }) => e.kind === "sent" || e.kind === "queued").length as number;
}

const cards = (page: Page) => page.getByTestId("patch-bay").locator('li[data-testid^="mapping-map_"]');

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
  while (createdProfiles.length) await page.request.delete(`/api/catalog/devices/${createdProfiles.pop()}`);
  await page.request.delete("/api/documents/unreferenced");
});

test("instrument studio: find a documented control by name, map it, read and flip its direction, preview without sends, accept a grouping suggestion, save and reopen", async ({ page }) => {
  const profileId = await volanteProfile(page);
  const { rigId, instId } = await rigWith(page, profileId);
  await page.goto(`/rigs/${rigId}#instrument`);
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  page.once("dialog", (d) => d.accept("Undertow (real)"));
  await page.getByTestId("texture-new").click();
  await expect(page.getByTestId("texture-name")).toHaveValue("Undertow (real)");
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const macroId = (await (await page.request.get(`/api/rigs/${rigId}`)).json()).textures[0].macros[0].id as string;

  // --- The rig by function: a pedal the heuristics cannot place gets a suggestion with its basis; the user decides.
  await expect(page.getByTestId("function-group-other")).toContainText("Volante");
  const suggestion = page.getByTestId(`role-suggestion-${instId}`);
  await expect(suggestion).toContainText("Suggested: Delay");
  await expect(suggestion).toContainText("the model name “Volante”");
  await page.getByTestId(`role-suggestion-use-${instId}`).click();
  await expect(page.getByTestId("function-group-delay")).toContainText("Volante");
  await expect(page.getByTestId(`role-suggestion-${instId}`)).toHaveCount(0);
  await expect(page.getByTestId("function-groups")).toContainText("5 documented controls");

  // --- The patch is empty; the finder opens from the macro, and "echo" finds the control by its name.
  await expect(page.getByTestId(`patch-empty-${macroId}`)).toContainText("No destination yet");
  await page.getByTestId(`mapping-add-${macroId}`).click();
  const finder = page.getByTestId("control-finder");
  await expect(finder).toBeVisible();
  await expect(page.getByTestId("finder-search")).toBeFocused();
  await page.getByTestId("finder-search").fill("echo");
  await expect(page.getByTestId("finder-group-delay")).toContainText("Volante");
  const echo = page.getByTestId(`finder-control-${instId}-12`);
  await expect(echo).toHaveAttribute("data-offer", "sweep");
  await expect(echo).toContainText("Echo Level");
  await expect(echo).toContainText("10–120");
  await expect(echo).toContainText("p. 2");
  await expect(page.getByTestId(`finder-control-${instId}-3`)).toHaveCount(0);
  await expect(page.getByTestId("finder-count")).toHaveText("1 control");
  await page.getByTestId(`finder-map-${instId}-12`).click();
  // The destination appears with the documented range as its extent, rising with the macro.
  const first = cards(page).first();
  await expect(first).toContainText("Volante");
  await expect(first).toContainText("Echo Level");
  await expect(first).toContainText("CC 12");
  await expect(first).toHaveAttribute("data-direction", "rises");
  await expect(first.getByTestId(/mapping-direction-/)).toHaveText("rises 10 → 120 as Bloom rises");
  await expect(first).toHaveAttribute("data-eligible", "true", { timeout: 10_000 });
  await expect(first).toContainText("documented continuous");
  await expect(first).toContainText("not tried on hardware");
  await expect(first).toContainText("p. 2");
  await expect(first).toContainText("not hardware-verified");
  await expect(echo).toContainText("mapped");
  await expect(page.getByTestId(`finder-map-${instId}-12`)).toBeDisabled();

  // --- A switch, a proposal and an undocumented control are shown with their reasons, not hidden.
  await page.getByTestId("finder-search").fill("");
  await expect(page.getByTestId("finder-count")).toContainText("controls"); // the whole rig's documented controls
  const tap = page.getByTestId(`finder-control-${instId}-20`);
  await expect(tap).toHaveAttribute("data-offer", "refused");
  await expect(tap).toContainText("trigger");
  await expect(page.getByTestId(`finder-map-${instId}-20`)).toHaveCount(0);
  const time = page.getByTestId(`finder-control-${instId}-21`);
  await expect(time).toHaveAttribute("data-offer", "refused");
  await expect(time).toContainText("review");
  const expr = page.getByTestId(`finder-control-${instId}-100`);
  await expect(expr).toHaveAttribute("data-offer", "declare");
  await expect(expr).toContainText("you will be asked to declare it");
  await expect(page.getByTestId(`finder-map-${instId}-100`)).toBeVisible();
  // The function chips narrow the list to one pedal's function.
  await page.getByTestId("finder-role-delay").click();
  await expect(page.getByTestId("finder-group-space")).toHaveCount(0);
  await expect(page.getByTestId("finder-group-delay")).toBeVisible();
  await expect(page.getByTestId("finder-count")).toHaveText("5 controls"); // the Volante's five

  // --- A second destination, then one click flips its direction.
  await page.getByTestId(`finder-map-${instId}-3`).click();
  const second = cards(page).nth(1);
  await expect(second).toContainText("Delay A Mix");
  await expect(second.getByTestId(/mapping-direction-/)).toHaveText("rises 0 → 127 as Bloom rises");
  await second.getByTestId(/mapping-flip-/).click();
  await expect(second).toHaveAttribute("data-direction", "falls");
  await expect(second.getByTestId(/mapping-direction-/)).toHaveText("falls 127 → 0 as Bloom rises (inverse)");
  await expect(second).toContainText("macro 0 → 127");
  await expect(second).toContainText("1 → 0");
  // Both destinations are on one pedal; the group header names it once.
  await expect(page.getByTestId(`dest-group-${instId}`)).toContainText("Volante");
  await expect(page.getByTestId(`patch-macro-${macroId}`)).toContainText("2 destinations on 1 pedal");
  // Close the finder with its button: focus returns to the way in.
  await page.getByRole("button", { name: "Close the control finder" }).click();
  await expect(finder).toHaveCount(0);
  await expect(page.getByTestId(`mapping-add-${macroId}`)).toBeFocused();

  // --- Cords: one per destination, coloured by direction.
  const cords = page.getByTestId("patch-cords").locator("path");
  await expect(cords).toHaveCount(2);
  await expect(cords.nth(0)).toHaveAttribute("data-tone", "rises");
  await expect(cords.nth(1)).toHaveAttribute("data-tone", "falls");

  // --- Preview with the macro: values move in opposite directions and nothing is sent.
  await page.getByTestId(`lfo-enabled-${macroId}`).uncheck();
  const slider = page.getByTestId(`macro-slider-${macroId}`);
  await slider.focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId(`macro-effective-${macroId}`)).toHaveText("effective 100%");
  await expect(first.getByTestId(/mapping-value-/)).toHaveText("120");
  await expect(second.getByTestId(/mapping-value-/)).toHaveText("0");
  await page.keyboard.press("Home");
  await expect(first.getByTestId(/mapping-value-/)).toHaveText("10");
  await expect(second.getByTestId(/mapping-value-/)).toHaveText("127");
  await expect(page.getByTestId("instrument-state")).toHaveAttribute("data-state", "preview");
  expect(await sentOrQueued(page, rigId)).toBe(0);

  // --- Saved and reopened as authored: the grouping decision, both destinations and their directions.
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const saved = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(saved.textures[0].function_roles[instId]).toBe("delay");
  expect(saved.textures[0].macros[0].mappings.map((m: { cc: number; output_min: number; output_max: number }) => [m.cc, m.output_min, m.output_max])).toEqual([[12, 10, 120], [3, 127, 0]]);
  await page.reload();
  await expect(page.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).first().getByTestId(/mapping-direction-/)).toHaveText("rises 10 → 120 as Bloom rises");
  await expect(cards(page).nth(1).getByTestId(/mapping-direction-/)).toHaveText("falls 127 → 0 as Bloom rises (inverse)");
  await expect(page.getByTestId("function-group-delay")).toContainText("Volante");
  await expect(cards(page).first()).toHaveAttribute("data-eligible", "true", { timeout: 10_000 });
  expect(await sentOrQueued(page, rigId)).toBe(0);
});

test("instrument studio: on a phone with reduced motion the patch stacks without overflow, the direction is readable without cords, and Keep Other is remembered", async ({ browser, page }) => {
  const profileId = await volanteProfile(page);
  const { rigId, instId } = await rigWith(page, profileId);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const phone = await context.newPage();
  await phone.goto(`/rigs/${rigId}#instrument`);
  await expect(phone.getByTestId("instrument-tab")).toBeVisible({ timeout: 15_000 });
  phone.once("dialog", (d) => d.accept("Pocket"));
  await phone.getByTestId("texture-new").click();
  await expect(phone.getByTestId("texture-name")).toHaveValue("Pocket");
  await expect(phone.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const macroId = (await (await phone.request.get(`/api/rigs/${rigId}`)).json()).textures[0].macros[0].id as string;
  await phone.getByTestId(`role-suggestion-keep-${instId}`).click();
  await expect(phone.getByTestId(`role-suggestion-${instId}`)).toHaveCount(0);
  await expect(phone.getByTestId("function-group-other")).toContainText("Volante");
  await phone.getByTestId(`mapping-add-${macroId}`).click();
  await phone.getByTestId("finder-search").fill("mix");
  await phone.getByTestId(`finder-map-${instId}-3`).click();
  const card = cards(phone).first();
  await expect(card).toBeVisible();
  await card.getByTestId(/mapping-flip-/).click();
  await expect(card.getByTestId(/mapping-direction-/)).toHaveText("falls 127 → 0 as Bloom rises (inverse)");
  await expect(phone.getByTestId("patch-cords")).toBeHidden();
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // Reduced motion: the value still follows the macro by keyboard.
  await phone.getByTestId(`lfo-enabled-${macroId}`).uncheck();
  await phone.getByTestId(`macro-slider-${macroId}`).focus();
  await phone.keyboard.press("End");
  await expect(card.getByTestId(/mapping-value-/)).toHaveText("0");
  await expect(phone.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  const saved = await (await phone.request.get(`/api/rigs/${rigId}`)).json();
  expect(saved.textures[0].function_roles[instId]).toBe("other");
  expect(await sentOrQueued(phone, rigId)).toBe(0);
  await context.close();
});
