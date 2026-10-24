import { expect, test, type Page } from "@playwright/test";

// ML10X Native Integration V2: load an editor Device Backup, select a preset, rename / copy / move / swap it,
// review the exact before/after, and download a CANDIDATE backup whose routing data travelled verbatim.
// Offline: the file is synthetic (built here with the fixture-validated hash), nothing talks to a device.

function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
const withHash = (doc: { data: unknown; hash?: number }) => {
  doc.hash = javaHash(JSON.stringify(doc.data));
  return JSON.stringify(doc);
};

type Preset = { presetNumber: number; presetName: string; tipT: number; ringT: number; matrixArray: Record<string, number[]>; advancedMode: boolean; bypass: number; [k: string]: unknown };

function backup() {
  const presetData = Array.from({ length: 4 }, (_, bank) => ({
    bank,
    data: Array.from({ length: 128 }, (_, n): Preset => ({
      presetNumber: n,
      presetName: "Empty",
      tipT: 127,
      ringT: 127,
      matrixArray: Object.fromEntries(Array.from({ length: 16 }, (_, k) => [String(k), [0, 0, 0]])),
      advancedMode: false,
      bypass: 0,
    })),
  }));
  const lead = presetData[0].data[1];
  lead.presetName = "Lead";
  lead.matrixArray["0"] = [0, 64, 0];
  lead.matrixArray["2"] = [4, 0, 0];
  lead.futureField = "?";
  const split = presetData[1].data[5];
  split.presetName = "Split";
  split.advancedMode = true;
  split.matrixArray["3"] = [7, 0, 0];
  split.bypass = 3;
  const reverted = presetData[0].data[2]; // named "Empty" but with routing data left behind
  reverted.matrixArray["15"] = [1, 0, 0];
  const names = ["Ego 76", "Archer", "ODR", "SD1", "AT+", "Muff", "Press", "Duke", "OC-5", "EQ-7", "guitar", "Guitar aux", "Output", "Oupput aux"];
  return {
    schemaVersion: 1,
    dumpType: "full",
    deviceModel: 7,
    downloadDate: "2026-05-25T20:10:02.734Z",
    hash: 0,
    data: {
      presetData,
      controllerData: {
        midiChannel: 9,
        connectors: names.map((name, i) => ({ id: i, pos: i, name, shortName: name.slice(0, 2), trails: i === 3, inputName: "Input", outputName: "Output" })),
        deviceId: 6,
        inputRingSwapPin: 0,
        inputSplit: true,
        loopBypassPersistent: false,
        firmwareHint: "1.2.0",
      },
    },
  };
}

const upload = (page: Page, testId: string, name: string, text: string) =>
  page.getByTestId(testId).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });

async function openManage(page: Page, doc = backup()) {
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "Morningstar_ML10X_Backup_File_20260525_201002.json", withHash(doc));
  await expect(page.getByTestId("native-summary")).toContainText("hash OK");
  await expect(page.getByTestId("ml10x-coverage")).toContainText("preset proposals: candidate file only");
  await page.getByTestId("bridge-mode-propose").click();
  await expect(page.getByTestId("ml10x-propose")).toBeVisible();
  return doc;
}

async function downloadJson(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("ml10x-download").click()]);
  expect(download.suggestedFilename()).toMatch(/^Morningstar_ML10X_Backup_File_\d{8}_\d{6}_signal-loom-candidate\.json$/);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf-8"));
  return JSON.parse(text) as ReturnType<typeof backup>;
}

test("ml10x: rename and copy a preset, review the exact differences, download a hash-valid candidate backup", async ({ page }) => {
  const doc = await openManage(page);
  // The first occupied preset is selected; the grid tells empty from occupied structurally.
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("occupied");
  await expect(page.getByTestId("ml10x-propose-slot-0-2")).toHaveAttribute("aria-label", /Bank 1 · preset 2 Empty, changed by the proposal|Bank 1 · preset 2 Empty$/);
  await expect(page.getByTestId("ml10x-propose-slot-0-3")).toHaveAttribute("aria-label", /empty/);
  // Rename with live character and byte counts; a 13-character name needs explicit consent.
  await page.getByTestId("ml10x-cmd-rename").click();
  const name = page.getByTestId("ml10x-rename-name");
  await name.fill("Lead thirteen");
  await expect(page.getByTestId("ml10x-name-count")).toContainText("13 characters · 13 bytes");
  await expect(page.getByTestId("ml10x-name-problem")).toContainText("device stores 12 bytes");
  await expect(page.getByTestId("ml10x-add-op")).toBeDisabled();
  await name.fill("Lead 2");
  await expect(page.getByTestId("ml10x-name-problem")).toHaveCount(0);
  await page.getByTestId("ml10x-add-op").click();
  await expect(page.getByTestId("ml10x-ops")).toContainText("Rename Bank 1 · preset 1 to “Lead 2”");
  // The grid shows the projected name and marks the slot as changed.
  await expect(page.getByTestId("ml10x-propose-slot-0-1")).toContainText("Lead 2");
  // Copy to an empty slot in another bank by typing the destination.
  await page.getByTestId("ml10x-cmd-copy").click();
  await page.getByTestId("ml10x-dest-bank").selectOption("2");
  await page.getByTestId("ml10x-dest-preset").fill("7");
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("Bank 3 · preset 7");
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("empty");
  await page.getByTestId("ml10x-add-op").click();
  await expect(page.getByTestId("ml10x-ops")).toContainText("Copy Bank 1 · preset 1 “Lead 2” → Bank 3 · preset 7");
  // Review.
  await page.getByTestId("ml10x-review").click();
  const result = page.getByTestId("ml10x-result");
  await expect(result).toContainText("self-check: structure + hash OK");
  await expect(result).toContainText("510 presets untouched");
  await expect(result).toContainText("0 routing fields authored");
  await expect(result).toContainText("not editor-validated");
  const slots = page.getByTestId("ml10x-result-slots");
  await expect(slots).toContainText("Bank 1 · preset 1");
  await expect(slots).toContainText("Bank 3 · preset 7");
  await expect(slots).toContainText("presetName");
  await expect(page.getByTestId("ml10x-result-effects")).toContainText("payload identical ✓");
  // The download is a hash-valid full backup; the copy carries the routing matrix and the unknown key verbatim.
  const out = await downloadJson(page);
  expect(out.dumpType).toBe("full");
  expect(out.deviceModel).toBe(7);
  expect(out.hash).toBe(javaHash(JSON.stringify(out.data)));
  const original = doc.data.presetData[0].data[1];
  const copy = out.data.presetData[2].data[7];
  expect(copy.presetNumber).toBe(7);
  expect(copy.presetName).toBe("Lead 2");
  expect(copy.matrixArray).toEqual(original.matrixArray);
  expect(copy.futureField).toBe("?");
  expect(out.data.presetData[0].data[1]).toEqual({ ...original, presetName: "Lead 2" });
  expect(out.data.presetData[1].data[5]).toEqual(doc.data.presetData[1].data[5]);
  expect(out.data.controllerData).toEqual(doc.data.controllerData);
});

test("ml10x: moving onto an occupied slot shows the overwrite choice; swap keeps both presets; cancel changes nothing", async ({ page }) => {
  await openManage(page);
  // Select the Advanced preset in bank 2 by clicking the grid.
  await page.getByTestId("ml10x-propose-bank-1").click();
  await page.getByTestId("ml10x-propose-slot-1-5").click();
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("Split");
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("Advanced");
  // Move it onto "Lead" (bank 1 preset 1) by picking in the grid: the source stays selected.
  await page.getByTestId("ml10x-cmd-move").click();
  await page.getByTestId("ml10x-propose-bank-0").click();
  await page.getByTestId("ml10x-propose-slot-0-1").click();
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("Split"); // source unchanged
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("“Lead”");
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("occupied");
  const warning = page.getByTestId("ml10x-overwrite-warning");
  await expect(warning).toContainText("already holds “Lead”");
  await expect(page.getByTestId("ml10x-add-op")).toBeDisabled();
  await expect(page.getByTestId("ml10x-dest-problem")).toContainText("choose swap or replace");
  // Cancel: nothing is proposed and the source is still selected.
  await page.getByTestId("ml10x-cancel-op").click();
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("Split");
  await expect(page.getByText("Nothing proposed yet.")).toBeVisible();
  // A slot named "Empty" that still carries routing data is occupied, so copying onto it needs the explicit replacement.
  await page.getByTestId("ml10x-cmd-copy").click();
  await page.getByTestId("ml10x-dest-bank").selectOption("0");
  await page.getByTestId("ml10x-dest-preset").fill("2");
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("routing data in matrix row(s) 15");
  await expect(page.getByTestId("ml10x-overwrite-warning")).toContainText("Replace “Empty”");
  await expect(page.getByTestId("ml10x-add-op")).toBeDisabled();
  await page.getByTestId("ml10x-cancel-op").click();
  // Swap across banks with "Lead".
  await page.getByTestId("ml10x-cmd-swap").click();
  await page.getByTestId("ml10x-dest-bank").selectOption("0");
  await page.getByTestId("ml10x-dest-preset").fill("1");
  await expect(page.getByTestId("ml10x-dest-status")).toContainText("“Lead”");
  await expect(page.getByTestId("ml10x-overwrite-warning")).toHaveCount(0);
  await page.getByTestId("ml10x-add-op").click();
  await expect(page.getByTestId("ml10x-ops")).toContainText("Swap Bank 2 · preset 5 “Split” ↔ Bank 1 · preset 1 “Lead”");
  await page.getByTestId("ml10x-review").click();
  await expect(page.getByTestId("ml10x-result")).toContainText("self-check: structure + hash OK");
  await expect(page.getByTestId("ml10x-result-effects")).toContainText("a holds former b ✓, b holds former a ✓");
  const out = await downloadJson(page);
  const src = backup();
  expect(out.data.presetData[0].data[1]).toEqual({ ...src.data.presetData[1].data[5], presetNumber: 1 });
  expect(out.data.presetData[1].data[5]).toEqual({ ...src.data.presetData[0].data[1], presetNumber: 5 });
  expect(out.data.presetData[0].data[1].advancedMode).toBe(true);
  expect(out.data.presetData[0].data[1].bypass).toBe(3);
});

test("ml10x: a move onto an occupied slot with explicit replacement clears the source with the file's factory payload; refused files never become proposals", async ({ page }) => {
  await openManage(page);
  await page.getByTestId("ml10x-cmd-move").click();
  await page.getByTestId("ml10x-dest-bank").selectOption("1");
  await page.getByTestId("ml10x-dest-preset").fill("5");
  await page.getByTestId("ml10x-on-occupied-overwrite").check();
  await page.getByTestId("ml10x-add-op").click();
  await expect(page.getByTestId("ml10x-ops")).toContainText("replaces the preset there");
  await expect(page.getByTestId("ml10x-propose-slot-0-1")).toHaveAttribute("aria-label", /empty, changed by the proposal/);
  await page.getByTestId("ml10x-review").click();
  await expect(page.getByTestId("ml10x-result-effects")).toContainText("replacing “Split”");
  await expect(page.getByTestId("ml10x-result-effects")).toContainText("source cleared with file template ✓");
  const out = await downloadJson(page);
  expect(out.data.presetData[1].data[5].presetName).toBe("Lead");
  expect(out.data.presetData[1].data[5].matrixArray["0"]).toEqual([0, 64, 0]);
  expect(out.data.presetData[0].data[1]).toEqual({ ...backup().data.presetData[0].data[3], presetNumber: 1 }); // the file's own factory-empty payload
  // The backend refuses an unsupported operation even if a client bypasses the UI; no file comes back.
  const res = await page.request.post("/api/morningstar/ml10x/propose", { data: { file: withHash(backup()), operations: [{ op: "set_matrix", slot: { bank: 0, preset: 1 } }] } });
  expect(res.status()).toBe(422);
  expect(JSON.stringify(await res.json())).not.toContain('"text"');
  // A hash-mismatched file can be inspected but the manage view refuses up front.
  const stale = backup();
  const text = withHash(stale);
  const broken = text.replace(/"hash":(-?\d+)/, (_m, h) => `"hash":${Number(h) + 1}`);
  await upload(page, "bridge-file", "stale.json", broken);
  await expect(page.getByTestId("native-summary")).toContainText("hash mismatch");
  await page.getByTestId("bridge-mode-propose").click();
  await expect(page.getByTestId("ml10x-propose-refused")).toContainText("integrity hash does not match");
  await expect(page.getByTestId("ml10x-cmd-rename")).toBeDisabled();
  await expect(page.getByTestId("ml10x-review")).toBeDisabled();
});

test("ml10x: keyboard-only preset selection and a 390 px layout without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openManage(page);
  // Keyboard: focus the grid's active cell and walk with the arrow keys, then Enter selects.
  await page.getByTestId("ml10x-propose-slot-0-1").focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("ml10x-propose-slot-0-2")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("ml10x-propose-slot-0-10")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("ml10x-propose-slot-0-9")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ml10x-propose-selected")).toContainText("Bank 1 · preset 9");
  await expect(page.getByTestId("ml10x-propose-slot-0-9")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("PageDown");
  await expect(page.getByTestId("ml10x-propose-bank-1")).toHaveAttribute("aria-selected", "true");
  // Keyboard-only rename on a slot: Tab to the Rename button is reachable; Enter in the name field adds the operation.
  await page.getByTestId("ml10x-propose-bank-0").click();
  await page.getByTestId("ml10x-propose-slot-0-1").click();
  await page.getByTestId("ml10x-cmd-rename").focus();
  await page.keyboard.press("Enter");
  await page.getByTestId("ml10x-rename-name").fill("Verse");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ml10x-ops")).toContainText("Rename Bank 1 · preset 1 to “Verse”");
  // Narrow layout: the page does not scroll horizontally.
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
  await page.getByTestId("ml10x-review").click();
  await expect(page.getByTestId("ml10x-result")).toContainText("1 value change");
  const after = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(after.scroll).toBeLessThanOrEqual(after.client + 1);
});

test("ml10x: connector names are editable within the device's widths and the inspector's existing views still work", async ({ page }) => {
  await openManage(page);
  await page.getByTestId("ml10x-connector-name-13").fill("Output aux");
  await expect(page.getByTestId("ml10x-ops")).toContainText("Connector 13 name: “Output aux”");
  await page.getByTestId("ml10x-connector-name-0").fill("Seventeen chars!!");
  await page.getByTestId("ml10x-review").click();
  await expect(page.getByTestId("ml10x-propose-error")).toContainText("device stores 16");
  await page.getByTestId("ml10x-connector-name-0").fill("Ego 76");
  await page.getByTestId("ml10x-review").click();
  await expect(page.getByTestId("ml10x-result")).toContainText("1 value change");
  const out = await downloadJson(page);
  expect(out.data.controllerData.connectors[13].name).toBe("Output aux");
  expect(out.data.controllerData.connectors[0].name).toBe("Ego 76");
  // Inspect view regression: presets, matrix and routing experiment are unchanged.
  await page.getByTestId("bridge-mode-inspect").click();
  await expect(page.getByTestId("ml10x-preset-detail")).toContainText("undecoded");
  await page.getByTestId("ml10x-preset-0-2").click(); // "Empty" by name, but it carries matrix row 15
  await expect(page.getByTestId("ml10x-matrix")).toContainText("1 0 0");
  await page.getByTestId("ml10x-preset-0-3").click();
  await expect(page.getByText(/Factory-empty slot/)).toBeVisible();
});
