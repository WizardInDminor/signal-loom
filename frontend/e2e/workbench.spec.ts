import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Session 6: the MIDI Knowledge Workbench. A guitarist opens a pedal's profile, keeps its manual
// visible on the right, enters several controls one after another citing the page they are
// reading, marks behaviour, evidence and hardware verification, writes down a procedure and pins
// it, reloads, finds the control from the Scene editor, and exports a project that carries all of
// it. Everything is non-transmitting; the manual is a synthetic fixture (tests/support/pdf.py).

const MANUAL = path.join(__dirname, "fixtures", "manual.pdf"); // 3 pages; page 2 mentions "CC 10"
const created: string[] = [];
const createdProfiles: string[] = [];

async function pedalCopy(page: Page) {
  const sunset = await (await page.request.get("/api/catalog/devices/strymon-sunset")).json();
  const id = `e2e-wb-${Date.now().toString(36)}`;
  const copy = { ...sunset, id, manufacturer: "E2E", model: `Delay ${id}`, builtin: false, provenance: { ...sunset.provenance, source: "user", evidence: "user" } };
  copy.midi = { ...copy.midi, cc_map: [], commands: [] }; // the knowledge is entered from the manual below
  delete copy.unknown_attributes; delete copy.source; delete copy.document_files;
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  createdProfiles.push(id);
  return id;
}

async function attachManual(page: Page, profileId: string, title: string) {
  const r = await page.request.post(`/api/catalog/devices/${profileId}/documents`, {
    multipart: { title, kind: "midi_chart", file: { name: "manual.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(MANUAL) } },
  });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).documents[0].document_id as string;
}

/** A copy of the demo rig whose Sunset uses the profile copy, so the demo library is never changed. */
async function rigWith(page: Page, profileId: string) {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  exported.profiles = exported.profiles.filter((p: { id: string }) => p.id !== "strymon-sunset");
  for (const i of exported.rig.instances) if (i.profile_id === "strymon-sunset") i.profile_id = profileId;
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E workbench ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  return rig.id as string;
}

async function openWorkbench(page: Page, profileId: string, query = "") {
  await page.goto(`/catalog/${profileId}/workbench${query}`);
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 15_000 });
}

async function pageShown(page: Page, n: number) {
  const img = page.getByTestId("reference-page");
  await expect(img).toHaveAttribute("data-page", String(n), { timeout: 15_000 });
  await expect.poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(100);
}

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
  while (createdProfiles.length) await page.request.delete(`/api/catalog/devices/${createdProfiles.pop()}`);
  await page.request.delete("/api/documents/unreferenced");
});

test("workbench: read the manual beside the editor, enter controls consecutively with their source page, pin a procedure, reload, find the control in a scene, export", async ({ page }) => {
  const profileId = await pedalCopy(page);
  const docId = await attachManual(page, profileId, "Delay MIDI guide");
  const rigId = await rigWith(page, profileId);

  // --- The Device library is the way in.
  await page.goto(`/catalog?device=${profileId}`);
  await expect(page.getByTestId("knowledge-summary")).toContainText("No documented controls yet");
  await page.getByTestId("open-workbench").click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("split-pane")).toHaveAttribute("data-mode", "split");
  await expect(page.getByTestId("workbench-identity")).toContainText(`Delay ${profileId}`);
  await expect(page.getByTestId("controls-empty")).toBeVisible();
  await pageShown(page, 1);

  // --- Find the MIDI chart in the manual: the viewer turns to page 2 and stays there.
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await page.getByLabel("Find in document").fill("CC 10");
  await page.getByLabel("Find in document").press("Enter");
  await expect(page.getByTestId("reference-hits")).toContainText("p. 2");
  await page.getByTestId("reference-hits").getByRole("button").first().click();
  await pageShown(page, 2);
  await expect(page.getByTestId("reference-footer")).toContainText("PDF page 2 of 3");
  await expect(page.getByTestId("reference-footer")).toContainText("printed page numbers may differ");

  // --- Enter two controls back to back; the second starts with the first's source page.
  await page.getByTestId("control-add").click();
  const form = page.getByTestId("control-form");
  await expect(form.getByLabel("CC number")).toBeFocused();
  await expect(page.getByTestId("workbench-save-state")).toHaveAttribute("data-state", "editing");
  await form.getByLabel("CC number").fill("12");
  await form.getByLabel("Control name").fill("Echo Level");
  await form.getByLabel("Behaviour").selectOption("continuous");
  await form.getByLabel("Minimum value").fill("0");
  await form.getByLabel("Maximum value").fill("127");
  await expect(form.getByLabel("Cited document")).toHaveValue(docId); // "+ Control" cites the page open on the right
  await expect(form.getByLabel("Cited page")).toHaveValue("2");
  await expect(form.getByLabel("Control evidence")).toHaveValue("documented");
  await form.getByTestId("control-save-another").click();
  // The next blank control is open, same document and page, next free number; the viewer did not move.
  await expect(page.getByTestId("control-form")).toBeVisible();
  await expect(page.getByTestId("control-form").getByLabel("Cited page")).toHaveValue("2");
  await expect(page.getByTestId("control-form").getByLabel("CC number")).toHaveValue("13");
  await expect(page.getByTestId("reference-page")).toHaveAttribute("data-page", "2");
  await expect(page.getByTestId("control-cc-12")).toContainText("Echo Level");
  const form2 = page.getByTestId("control-form");
  await form2.getByLabel("CC number").fill("15");
  await form2.getByLabel("Control name").fill("Spacing");
  await form2.getByLabel("Behaviour").selectOption("continuous");
  await form2.getByText("On your hardware").click();
  await expect(form2.getByTestId("control-scope")).toContainText("this profile");
  await expect(form2.getByTestId("control-scope-count")).toHaveText("1"); // the rig's Sunset is the one unit placed with this copy
  await form2.getByLabel("Hardware status").selectOption("verified");
  await form2.getByLabel("Hardware note").fill("swept by hand on the bench");
  await form2.getByTestId("control-save").click();
  await expect(page.getByTestId("control-form")).toHaveCount(0);
  await expect(page.getByTestId("workbench-save-state")).toHaveAttribute("data-state", "saved");
  await expect(page.getByTestId("control-cc-15")).toContainText("verified (your claim)");
  await expect(page.getByTestId("control-cc-12")).not.toContainText("verified"); // a citation is never a hardware claim

  // --- A third control from the viewer side: turn to page 3, "+ Control from p. 3", Enter saves.
  await page.getByTestId("reference-nav").getByRole("button", { name: "Next page" }).click();
  await pageShown(page, 3);
  await page.getByTestId("reference-new-control").click();
  const form3 = page.getByTestId("control-form");
  await expect(form3.getByLabel("Cited page")).toHaveValue("3");
  await form3.getByLabel("CC number").fill("102");
  await form3.getByLabel("Control name").fill("Bypass");
  await form3.getByLabel("Behaviour").selectOption("toggle");
  await form3.getByLabel("Value meaning").fill("0 = bypass, 127 = engage");
  await form3.getByLabel("Control name").press("Enter");
  await expect(page.getByTestId("control-form")).toHaveCount(0);
  await expect(page.getByTestId("control-cc-102")).toContainText("toggle");
  await page.screenshot({ path: "test-results/workbench-1440-controls.png" }).catch(() => undefined);

  // --- Clicking a citation turns the viewer; editing another control keeps that position.
  await page.getByTestId("control-cc-12").getByTestId("control-citation").click();
  await pageShown(page, 2);
  await page.getByRole("button", { name: "Edit CC 15 Spacing" }).click();
  await page.getByTestId("control-form").getByLabel("Control name").fill("Spacing (repeats)");
  await page.getByTestId("control-form").getByTestId("control-save").click();
  await expect(page.getByTestId("control-cc-15")).toContainText("Spacing (repeats)");
  await expect(page.getByTestId("reference-page")).toHaveAttribute("data-page", "2");

  // --- Quick Reference: a pinned procedure with steps and the page reference.
  await page.getByTestId("view-notes").click();
  await expect(page.getByTestId("notes-empty")).toBeVisible();
  await page.getByTestId("note-add").click();
  const note = page.getByTestId("note-form");
  await note.getByLabel("Note title").fill("Save a preset");
  await note.getByLabel("Note category").selectOption("presets");
  await note.getByLabel("Note body").fill("Saving is armed by hand on the pedal; a Program Change then picks the slot.");
  await note.getByLabel("Note steps").fill("Hold FAV until the LED flashes\nPress the footswitch of the slot");
  await expect(note.getByTestId("note-references")).toContainText("p."); // the page open on the right was referenced on creation
  await note.getByLabel("Pinned").check();
  await note.getByTestId("note-save").click();
  const saved = page.locator("[data-testid^=note-note_]").filter({ hasText: "Save a preset" });
  await expect(saved).toHaveAttribute("data-pinned", "true");
  await expect(saved.getByTestId("note-steps").locator("li")).toHaveCount(2);
  await expect(saved.getByTestId("note-reference")).toContainText("p. 2");
  await page.screenshot({ path: "test-results/workbench-1440-notes.png" }).catch(() => undefined);

  // --- Reload: everything is there, the view and page come back from the URL.
  await expect(page).toHaveURL(/view=notes/);
  await page.reload();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-testid^=note-note_]").filter({ hasText: "Save a preset" })).toHaveAttribute("data-pinned", "true");
  await page.getByTestId("view-controls").click();
  await expect(page.getByTestId("controls-list").locator("li")).toHaveCount(3);
  await pageShown(page, 2);
  const prof = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  const byCc = Object.fromEntries(prof.midi.cc_map.map((c: { cc: number }) => [c.cc, c]));
  expect(byCc[12].citation).toEqual({ document_id: docId, page: 2, note: null });
  expect(byCc[12].continuous).toBe(true);
  expect(byCc[12].hardware_status).toBe("unverified");
  expect(byCc[15].hardware_status).toBe("verified");
  expect(byCc[102].continuous).toBe(false);
  expect(byCc[102].citation.page).toBe(3);
  expect(prof.quick_reference[0].pinned).toBe(true);
  expect(prof.quick_reference[0].references).toEqual([{ document_id: docId, page: 2, note: null }]);

  // --- Proposals from the page text are only ever "proposed" and never offered to scenes.
  await page.getByTestId("reference-propose").click();
  const proposals = page.getByTestId("reference-proposals");
  await expect(proposals).toContainText("CC 10");
  await proposals.getByTestId("proposals-accept").click();
  await expect(page.getByTestId("control-cc-10")).toHaveAttribute("data-review", "proposed");
  await expect(page.getByTestId("control-cc-10")).toContainText("needs review");

  // --- Scene editor: the reviewed control is offered by name; the proposed one is not.
  await page.goto(`/rigs/${rigId}#scenes`);
  await page.getByRole("button", { name: /^Heavy verse/ }).click();
  await page.getByTestId("add-command-inst_sunset").click();
  const picker = page.getByTestId("command-picker");
  await expect(picker.getByTestId("control-pick-12")).toContainText("Echo Level");
  await expect(picker.getByTestId("control-pick-10")).toHaveCount(0);
  await expect(picker).toContainText("1 awaiting review are not offered");
  await picker.getByTestId("control-pick-12").click();
  await picker.getByLabel("Control value").fill("64");
  await expect(picker.getByTestId("command-preview")).toContainText("CC 12 = 64 on channel 3 → Sunset");
  await expect(picker.getByTestId("picker-control-citation")).toHaveAttribute("href", `/catalog/${profileId}/workbench?doc=${docId}&page=2`);
  await picker.getByTestId("command-apply").click();
  await expect(page.getByTestId("cc-values-inst_sunset").getByLabel("CC number").last()).toHaveValue("12");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });

  // --- The Board inspector shows the pinned procedure next to the placed unit, and takes unit notes.
  await page.goto(`/rigs/${rigId}#board`);
  await page.getByRole("button", { name: /^Sunset,/ }).click();
  await expect(page.getByRole("heading", { name: "Device inspector" })).toBeVisible();
  const unit = page.getByTestId("unit-knowledge");
  await unit.scrollIntoViewIfNeeded();
  await expect(unit.getByTestId("pinned-model-notes")).toContainText("Save a preset");
  await unit.getByTestId("unit-notes-details").locator("summary").click();
  await unit.getByTestId("note-add").click();
  await unit.getByLabel("Note title").fill("This unit listens on channel 3");
  await unit.getByLabel("Note category").selectOption("midi_setup");
  await unit.getByLabel("Note body").fill("Set by hand on 2026-10-23; the profile default is 1.");
  await unit.getByTestId("note-save").click();
  await expect(unit.locator("[data-testid^=note-note_]")).toContainText("This unit listens on channel 3");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  const rigDoc = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const sunsetInst = rigDoc.instances.find((i: { id: string }) => i.id === "inst_sunset");
  expect(sunsetInst.quick_reference[0].title).toBe("This unit listens on channel 3");
  // Model notes stayed on the profile, not on the unit.
  expect((await (await page.request.get(`/api/catalog/devices/${profileId}`)).json()).quick_reference.length).toBe(1);

  // --- Export with documents: the knowledge and the cited manual travel together.
  const bundle = await (await page.request.get(`/api/rigs/${rigId}/export?include_documents=1`)).json();
  const exported = bundle.profiles.find((p: { id: string }) => p.id === profileId);
  expect(exported.midi.cc_map.find((c: { cc: number }) => c.cc === 12).citation.page).toBe(2);
  expect(exported.quick_reference[0].title).toBe("Save a preset");
  expect(bundle.documents.map((d: { id: string }) => d.id)).toEqual([docId]);
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent("E2E workbench reimport")}`, { data: bundle });
  expect(res.ok()).toBeTruthy();
  created.push((await res.json()).rig.id);
  const again = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  expect(again.quick_reference[0].pinned).toBe(true);
  expect(again.midi.cc_map.length).toBe(4);
});

test("workbench: on a phone the Editor and Reference segments keep an open control and the reading position; the viewer cites into the open editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const profileId = await pedalCopy(page);
  await attachManual(page, profileId, "Delay MIDI guide");
  await openWorkbench(page, profileId);
  await expect(page.getByTestId("split-pane")).toHaveAttribute("data-mode", "narrow");
  await page.getByTestId("control-add").click();
  await page.getByTestId("control-form").getByLabel("Control name").fill("Half entered");
  await page.getByTestId("segment-right").click();
  await pageShown(page, 1);
  await page.getByTestId("reference-nav").getByRole("button", { name: "Next page" }).click();
  await pageShown(page, 2);
  await page.screenshot({ path: "test-results/workbench-390-reference.png" }).catch(() => undefined);
  // The viewer knows a control is open and cites into it; the editor comes back with the draft intact.
  await page.getByTestId("reference-cite").click();
  await expect(page.getByTestId("segment-left")).toHaveAttribute("aria-selected", "true");
  const form = page.getByTestId("control-form");
  await expect(form.getByLabel("Control name")).toHaveValue("Half entered");
  await expect(form.getByLabel("Cited page")).toHaveValue("2");
  await page.screenshot({ path: "test-results/workbench-390-editor.png" }).catch(() => undefined);
  await form.getByLabel("CC number").fill("20");
  await form.getByLabel("Behaviour").selectOption("discrete");
  await form.getByTestId("control-save").click();
  await expect(page.getByTestId("control-cc-20")).toContainText("Half entered");
  // Back on the reference segment the page is still 2.
  await page.getByTestId("segment-right").click();
  await expect(page.getByTestId("reference-page")).toHaveAttribute("data-page", "2");
  // A keyboard-only user can move the split on a laptop: the separator is a focusable slider.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("split-pane")).toHaveAttribute("data-mode", "split");
  const sep = page.getByRole("separator", { name: "Resize panes" });
  const before = Number(await sep.getAttribute("aria-valuenow"));
  await sep.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  expect(Number(await sep.getAttribute("aria-valuenow"))).toBeGreaterThan(before);
  await page.screenshot({ path: "test-results/workbench-1280.png" }).catch(() => undefined);
});

test("workbench: entering controls never claims a MIDI interface; the user declares it explicitly", async ({ page }) => {
  const id = `e2e-wb-silent-${Date.now().toString(36)}`;
  const body = { id, manufacturer: "E2E", model: `Silent ${id}`, category: "effect", provenance: { source: "user", evidence: "user" } };
  expect((await page.request.post("/api/catalog/devices", { data: body })).ok()).toBeTruthy();
  createdProfiles.push(id);
  await openWorkbench(page, id);
  await expect(page.getByTestId("workbench-midi-basics")).toContainText("no MIDI input declared");
  await page.getByTestId("control-add").click();
  const form = page.getByTestId("control-form");
  await form.getByLabel("CC number").fill("7");
  await form.getByLabel("Control name").fill("Volume");
  await form.getByTestId("control-save").click();
  await expect(page.getByTestId("control-cc-7")).toBeVisible();
  await expect(page.getByTestId("controls-no-interface")).toContainText("not declared yet");
  let prof = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  expect(prof.midi.interfaces).toEqual([]); // nothing inferred from a list of controls
  await page.getByTestId("declare-midi-toggle").click();
  await page.getByLabel("MIDI interface").selectOption("usb");
  await page.getByLabel("Default MIDI channel").fill("4");
  await page.getByTestId("declare-midi-save").click();
  await expect(page.getByTestId("workbench-midi-basics")).toContainText("MIDI usb");
  await expect(page.getByTestId("controls-no-interface")).toHaveCount(0);
  prof = await (await page.request.get(`/api/catalog/devices/${id}`)).json();
  expect(prof.midi.interfaces).toEqual(["usb"]);
  expect(prof.midi.evidence).toBe("user");
  expect(prof.midi.default_channel).toBe(4);
});

test("workbench: a profile without a manual explains itself and takes a PDF in place; a non-PDF is refused", async ({ page }) => {
  const profileId = await pedalCopy(page);
  await openWorkbench(page, profileId);
  await expect(page.getByTestId("reference-empty")).toContainText("No manual attached");
  await page.getByTestId("reference-file").setInputFiles({ name: "photo.pdf", mimeType: "application/pdf", buffer: fs.readFileSync(path.join(__dirname, "fixtures", "pedal-photo.jpg")) });
  await expect(page.getByTestId("reference-error")).toContainText("not a PDF");
  await page.getByTestId("reference-empty").getByLabel("Document title").fill("Owner's manual");
  await page.getByTestId("reference-file").setInputFiles(MANUAL);
  await pageShown(page, 1);
  await expect(page.getByTestId("reference-doc-title")).toHaveText("Owner's manual");
  const prof = await (await page.request.get(`/api/catalog/devices/${profileId}`)).json();
  expect(prof.documents[0].title).toBe("Owner's manual");
});
