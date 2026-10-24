import { expect, test, type Page } from "@playwright/test";

// Morningstar Bridge (Session 7): load an MC8 editor backup, inspect banks/presets/messages with
// known / third-party / unknown made explicit, compare a bank with a rig's modeled intent, review a
// proposed change, and inspect an ML10X backup with its routing kept opaque. Offline: the files are
// built in the test from the backend's own validated writer. Requires backend + frontend.

const created: string[] = [];

/** Java String.hashCode over the compact JSON of `data`: the editor's integrity hash (fixture-validated). */
function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
const withHash = (doc: { data: unknown; hash?: number }) => {
  doc.hash = javaHash(JSON.stringify(doc.data));
  return JSON.stringify(doc);
};

async function demoCopy(page: Page) {
  const res = await page.request.post("/api/rigs", { data: { name: `E2E bridge ${Date.now()}`, from_demo: true } });
  expect(res.ok()).toBeTruthy();
  const rig = await res.json();
  created.push(rig.id);
  return rig as { id: string; name: string };
}

async function demoBankFile(page: Page, rigId: string) {
  const bank = await (await page.request.get(`/api/rigs/${rigId}/exports/mc8-bank/1`)).json();
  return bank.dump as { data: { bank: { bankName: string; presetArray: { shortName: string; msgArray: Record<string, unknown>[] }[] } }; hash: number };
}

const upload = (page: Page, testId: string, name: string, text: string) =>
  page.getByTestId(testId).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

test("bridge: an MC8 bank backup is inspected with known, third-party and unknown data told apart", async ({ page }) => {
  const rig = await demoCopy(page);
  const dump = await demoBankFile(page, rig.id);
  // Damage the file the way a newer editor might: a foreign message type, an unknown code, unknown keys.
  const a = dump.data.bank.presetArray[0];
  a.msgArray[5] = { d1: 3, d2: 0, d3: 0, d4: 0, m: 5, c: 1, t: 13, a: 1, tg: 2, mi: "" };
  a.msgArray[6] = { d1: 1, d2: 2, d3: 3, d4: 4, m: 6, c: 1, t: 99, a: 1, tg: 2, mi: "" };
  (dump.data.bank as Record<string, unknown>).newBankSetting = 7;
  (dump as Record<string, unknown>).editorVersion = "9.9.9";
  await page.goto("/morningstar");
  await expect(page.getByRole("heading", { name: "Morningstar Bridge" })).toBeVisible();
  await expect(page.getByTestId("bridge-status")).toContainText("ml10x native export");
  await upload(page, "bridge-file", "Morningstar_MC8_Bank_Backup_Demo.json", withHash(dump));
  const summary = page.getByTestId("native-summary");
  await expect(summary).toContainText("native snapshot loaded");
  await expect(summary).toContainText("hash OK");
  await expect(summary).toContainText("2 unknown keys");
  await expect(page.getByTestId("mc8-coverage")).toContainText("1 third-party-named");
  await expect(page.getByTestId("mc8-coverage")).toContainText("1 unknown");
  // Preset A is selected (first used preset): its message table shows the three classes.
  const detail = page.getByTestId("mc8-preset-detail");
  await expect(detail).toContainText("Clean");
  const msgs = page.getByTestId("mc8-preset-messages");
  await expect(msgs.getByTestId("msg-slot-0")).toContainText("known");
  await expect(msgs.getByTestId("msg-slot-5")).toContainText("Bank Jump");
  await expect(msgs.getByTestId("msg-slot-5")).toContainText("third-party name");
  await expect(msgs.getByTestId("msg-slot-6")).toContainText("unknown");
  await expect(msgs.getByTestId("msg-slot-6")).toContainText("1 2 3 4");
  // Another preset.
  await page.getByTestId("mc8-preset-B").click();
  await expect(page.getByTestId("mc8-preset-detail")).toContainText("B (page 1)");
  await expect(page.getByTestId("mc8-preset-detail")).toContainText("Heavy");
  // Unknown data is listed, never dropped.
  await page.getByRole("tab", { name: /Unknown data \(2\)/ }).click();
  await expect(page.getByTestId("unknown-keys")).toContainText("newBankSetting");
  await expect(page.getByTestId("unknown-keys")).toContainText("editorVersion");
  // A single-bank file has no controller settings; the UI says why.
  await page.getByRole("tab", { name: "Controller settings" }).click();
  await expect(page.getByText(/single-bank file; global controller settings/)).toBeVisible();
});

test("bridge: a bank is compared with the rig's modeled intent and differences are named", async ({ page }) => {
  const rig = await demoCopy(page);
  const dump = await demoBankFile(page, rig.id);
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "bank.json", JSON.stringify(dump));
  await expect(page.getByTestId("native-summary")).toContainText("byte-exact");
  await page.getByTestId("bridge-mode-compare").click();
  await page.getByLabel("Rig", { exact: true }).selectOption({ label: rig.name });
  await expect(page.getByLabel("Rig bank")).toHaveValue("1");
  await page.getByTestId("compare-run").click();
  await expect(page.getByTestId("compare-summary")).toContainText("identical where Signal Loom models");
  // Now a controller that drifted: a different CC value on A and a switch Signal Loom does not have.
  const drifted = JSON.parse(JSON.stringify(dump));
  drifted.data.bank.presetArray[0].msgArray[0].d2 = 64;
  drifted.data.bank.presetArray[5].shortName = "Extra";
  drifted.data.bank.presetArray[5].msgArray[0] = { d1: 10, d2: 0, d3: 0, d4: 0, m: 0, c: 1, t: 23, a: 1, tg: 2, mi: "" }; // Delay
  await upload(page, "bridge-file", "drifted.json", withHash(drifted));
  await expect(page.getByTestId("native-summary")).toContainText("hash OK");
  await page.getByTestId("bridge-mode-compare").click();
  await page.getByLabel("Rig", { exact: true }).selectOption({ label: rig.name });
  await page.getByTestId("compare-run").click();
  await expect(page.getByTestId("compare-summary")).toContainText("differences found");
  await expect(page.getByTestId("compare-A")).toContainText("differs");
  await expect(page.getByTestId("compare-A")).toContainText("messages");
  await expect(page.getByTestId("compare-F")).toContainText("controller only");
  await expect(page.getByTestId("compare-F")).toContainText("not modelled");
});

test("bridge: a proposed change is reviewed as a diff before the single-bank file is produced; locked slots stay verbatim", async ({ page }) => {
  const rig = await demoCopy(page);
  const dump = await demoBankFile(page, rig.id);
  dump.data.bank.presetArray[0].msgArray[5] = { d1: 3, d2: 0, d3: 0, d4: 0, m: 5, c: 1, t: 13, a: 1, tg: 2, mi: "" };
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "bank.json", withHash(dump));
  await expect(page.getByTestId("native-summary")).toContainText("hash OK");
  await page.getByTestId("bridge-mode-propose").click();
  // No edits: the review reports a byte-identical file.
  await page.getByTestId("propose-review").click();
  await expect(page.getByTestId("propose-result")).toContainText("0 field changes");
  await expect(page.getByTestId("propose-result")).toContainText("byte-identical to the input");
  await expect(page.getByTestId("propose-result")).toContainText("1 third-party");
  // The foreign slot is locked.
  await expect(page.getByTestId("propose-slot-5")).toContainText("preserved verbatim");
  // Edit the short name and a CC value, add a PC in an empty slot; review shows exactly those changes.
  await page.getByRole("textbox", { name: "Short name" }).fill("Lead");
  await page.getByLabel("Slot 0 value").fill("100");
  await page.getByLabel("Slot 7 type").selectOption("1");
  await page.getByLabel("Slot 7 number").fill("12");
  await page.getByLabel("Slot 7 channel").fill("3");
  await page.getByTestId("propose-review").click();
  const result = page.getByTestId("propose-result");
  await expect(result).toContainText("5 field changes");
  await expect(result).toContainText("self-check: structure + hash OK");
  const diff = page.getByTestId("propose-diff");
  await expect(diff).toContainText("shortName");
  await expect(diff).toContainText("Lead");
  await expect(diff).toContainText("message slot 7 / t");
  // The download is a valid single-bank file with the foreign slot untouched.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("propose-download").click()]);
  expect(download.suggestedFilename()).toMatch(/^Morningstar_MC8_Bank_Backup_.*\.json$/);
  const text = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf-8"));
  const out = JSON.parse(text);
  expect(out.dumpType).toBe("singleBank");
  expect(out.hash).toBe(javaHash(JSON.stringify(out.data)));
  expect(out.data.bank.presetArray[0].shortName).toBe("Lead");
  expect(out.data.bank.presetArray[0].msgArray[5].t).toBe(13);
  expect(out.data.bank.presetArray[0].msgArray[7]).toMatchObject({ t: 1, d1: 12, c: 3 });
  // A refused edit never produces a file.
  await page.getByLabel("Slot 0 channel").fill("17");
  await page.getByTestId("propose-review").click();
  await expect(page.getByTestId("propose-error")).toContainText("1-16");
});

test("bridge: a file whose hash does not match can be inspected but never becomes a proposal", async ({ page }) => {
  const rig = await demoCopy(page);
  const dump = await demoBankFile(page, rig.id);
  dump.hash = dump.hash + 1; // hand-edited or foreign serializer
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "stale.json", JSON.stringify(dump));
  await expect(page.getByTestId("native-summary")).toContainText("hash mismatch");
  await expect(page.getByTestId("mc8-preset-detail")).toContainText("Clean"); // inspection still works
  await page.getByTestId("bridge-mode-propose").click();
  await expect(page.getByTestId("propose-refused")).toContainText("integrity hash does not match");
  await expect(page.getByTestId("propose-review")).toBeDisabled();
  // The backend refuses too, whatever the UI does.
  const res = await page.request.post("/api/morningstar/mc8/propose", { data: { file: JSON.stringify(dump), edits: [] } });
  expect(res.status()).toBe(422);
  expect(JSON.stringify(await res.json())).toContain("integrity hash mismatch");
});

test("bridge: an ML10X backup shows controller, connectors and presets, and keeps routing opaque", async ({ page }) => {
  const presetData = Array.from({ length: 4 }, (_, bank) => ({
    bank,
    data: Array.from({ length: 128 }, (_, n) => ({
      presetNumber: n,
      presetName: "Empty",
      tipT: 127,
      ringT: 127,
      matrixArray: Object.fromEntries(Array.from({ length: 16 }, (_, k) => [String(k), [0, 0, 0]])),
      advancedMode: false,
      bypass: 0,
    })),
  }));
  presetData[0].data[1].presetName = "Lead";
  presetData[0].data[1].matrixArray["0"] = [0, 64, 0];
  presetData[0].data[1].matrixArray["2"] = [4, 0, 0];
  (presetData[0].data[1] as Record<string, unknown>).futureField = "?";
  const names = ["Ego 76", "Archer", "ODR", "SD1", "AT+", "Muff", "Press", "Duke", "OC-5", "EQ-7", "guitar", "Guitar aux", "Output", "Output aux"];
  const doc = {
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
      },
    },
  };
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "ml10x-backup.json", withHash(doc));
  const summary = page.getByTestId("native-summary");
  await expect(summary).toContainText("7 — Morningstar ML10X");
  await expect(summary).toContainText("hash OK");
  await expect(summary).toContainText("1 unknown key");
  await expect(page.getByTestId("ml10x-coverage")).toContainText("1 in use");
  await expect(page.getByTestId("ml10x-coverage")).toContainText("routing authorship: blocked");
  await expect(page.getByTestId("ml10x-coverage")).toContainText("preset proposals: candidate file only");
  const detail = page.getByTestId("ml10x-preset-detail");
  await expect(detail).toContainText("Lead");
  await expect(detail).toContainText("undecoded");
  await expect(page.getByTestId("ml10x-matrix")).toContainText("Input Tip");
  await expect(page.getByTestId("ml10x-matrix")).toContainText("hypothesis");
  await expect(page.getByTestId("ml10x-matrix")).toContainText("0 64 0");
  await expect(detail).toContainText("futureField");
  await page.getByTestId("ml10x-preset-0-3").click();
  await expect(page.getByText(/Factory-empty slot/)).toBeVisible();
  await page.getByRole("tab", { name: "Controller & connectors" }).click();
  await expect(page.getByTestId("ml10x-controller")).toContainText("MIDI channel");
  await expect(page.getByTestId("ml10x-controller")).toContainText("A Tip (loop 1)");
  await expect(page.getByTestId("ml10x-controller")).toContainText("Input Tip");
  await expect(page.getByTestId("ml10x-controller")).toContainText("trails on");
  // Controlled experiment: the second export moved one matrix row.
  const after = JSON.parse(JSON.stringify(doc));
  after.data.presetData[0].data[1].matrixArray["2"] = [0, 0, 0];
  after.data.presetData[0].data[1].matrixArray["3"] = [2, 0, 0];
  await page.getByRole("tab", { name: "Routing experiment" }).click();
  await upload(page, "ml10x-second-file", "after.json", withHash(after));
  await page.getByTestId("ml10x-matrix-diff").click();
  const res = page.getByTestId("ml10x-matrix-diff-result");
  await expect(res).toContainText("preset 1 “Lead”");
  await expect(res).toContainText("A Tip");
  await expect(res).toContainText("A Ring");
  await expect(res).toContainText("byte0.bit1");
});

test("bridge: a file from another device model is kept opaque and says so", async ({ page }) => {
  await page.goto("/morningstar");
  await upload(page, "bridge-file", "pro.json", JSON.stringify({ schemaVersion: 1, dumpType: "allBanks", deviceModel: 8, data: { bankArray: [], extra: 1 } }));
  await expect(page.getByTestId("native-problems")).toContainText("deviceModel 8");
  await expect(page.getByTestId("unknown-keys")).toContainText("extra");
  await upload(page, "bridge-file", "garbage.json", "not json at all");
  await expect(page.getByTestId("native-problems")).toContainText("not valid JSON");
});
