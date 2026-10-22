import { expect, test, type Page } from "@playwright/test";

// Session 4: live rig control on the virtual transport. Disarmed by default; a dry run shows the
// exact bytes and sends nothing; arming is an explicit phrase; an audition reaches the simulated
// pedals in order; a panel control is captured to the scene on purpose and survives a reload; a
// simulated MC8 stomp is followed honestly; the offline planner is untouched throughout.
//
// The live service is one per backend process, so these scenarios run serially.
test.describe.configure({ mode: "serial" });

const created: string[] = [];
const ARM = "send MIDI to my rig";

async function openCopy(page: Page) {
  const list = await (await page.request.get("/api/rigs")).json();
  const src = list.find((r: { name: string }) => r.name.startsWith("Demo rig"));
  const exported = await (await page.request.get(`/api/rigs/${src.id}/export`)).json();
  const res = await page.request.post(`/api/rigs/import?name=${encodeURIComponent(`E2E live ${Date.now()}`)}`, { data: exported });
  expect(res.ok()).toBeTruthy();
  const rig = (await res.json()).rig;
  created.push(rig.id);
  await page.goto(`/rigs/${rig.id}#live`);
  await expect(page.getByTestId("live-header")).toBeVisible({ timeout: 15_000 });
  return rig.id as string;
}

test.afterEach(async ({ page }) => {
  await page.request.post("/api/live/disconnect");
  while (created.length) await page.request.delete(`/api/rigs/${created.pop()}`);
});

test("live: disarmed by default, bindings and coverage are explicit, a dry run shows exact bytes and sends nothing, the planner stays untouched", async ({ page }) => {
  const rigId = await openCopy(page);
  const header = page.getByTestId("live-header");
  await expect(header).toHaveAttribute("data-armed", "false");
  await expect(page.getByTestId("live-armed-state")).toContainText("Disarmed");
  await expect(page.getByTestId("rig-armed-badge")).toHaveCount(0);
  // Nothing is bound yet: every pedal is unreachable and the table says what the smallest change is.
  await expect(page.getByTestId("coverage-inst_bigsky-pc")).toHaveAttribute("data-status", "unreachable");
  await page.getByTestId("live-suggest").click();
  await expect(page.getByTestId("live-bindings").locator("tbody tr")).toHaveCount(3); // MC8 out, MC8 in, the "new binding" row
  await expect(page.getByTestId("coverage-inst_bigsky-pc")).toHaveAttribute("data-status", "supported");
  await expect(page.getByTestId("coverage-inst_sunset-sysex_read")).toHaveAttribute("data-status", "unsupported");
  await expect(page.getByTestId("coverage-inst_ml10x-clock")).toHaveAttribute("data-status", "unverified");
  await expect(page.getByTestId("live-network-virt:inst_mc8:out")).toContainText("No channel shared");
  // Dry run of "Solo": nine messages, exact bytes, all via the MC8's virtual USB; nothing sent.
  await page.getByLabel("Live scene").selectOption({ label: "Solo" });
  await page.getByTestId("live-dry-run").click();
  const rows = page.getByTestId("live-dry-run-table").locator("tbody tr");
  await expect(rows).toHaveCount(9);
  await expect(rows.nth(0)).toContainText("B9 00 00");
  await expect(rows.nth(1)).toContainText("C9 02");
  await expect(rows.nth(8)).toContainText("CC 102 = 127 ch 2 → BigSky MX");
  await expect(rows.nth(3)).toContainText("Virtual USB — MC8");
  await expect(page.getByTestId("live-log")).toContainText("Nothing sent yet");
  await expect(page.getByTestId("live-audition")).toBeDisabled();
  await expect(page.getByTestId("live-audition")).toContainText("disarmed");
  // The planner is untouched: nothing dirty, revision still 0, Board and Stage open normally.
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
  expect((await (await page.request.get(`/api/rigs/${rigId}`)).json()).revision).toBe(0);
  await page.getByRole("tab", { name: "stage" }).click();
  await expect(page.getByTestId("stage-canvas")).toBeVisible();
  await page.getByRole("tab", { name: "board" }).click();
  await expect(page.getByTestId("board-canvas")).toBeVisible();
  const events = await (await page.request.get(`/api/live/events?rig_id=${rigId}`)).json();
  expect(events.log.filter((e: { kind: string }) => e.kind === "sent")).toHaveLength(0);
});

test("live: connect, arm with the phrase, audition in order into simulated pedals, Stop, dial a control, capture it to the scene, reload and compile", async ({ page }) => {
  const rigId = await openCopy(page);
  await page.getByTestId("live-suggest").click();
  await page.getByTestId("live-connect").click();
  await expect(page.getByTestId("live-header")).toContainText("connected");
  await expect(page.getByTestId("live-watching")).toContainText("ports watched");
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "false");
  // Arming needs the phrase; a wrong one is refused and leaves everything disarmed.
  await page.getByTestId("live-arm").click();
  await page.getByLabel("Arm confirmation phrase").fill("yes please");
  await page.getByTestId("live-arm-confirm").click();
  await expect(page.getByTestId("error-banner")).toContainText("confirmation phrase");
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "false");
  await page.getByLabel("Arm confirmation phrase").fill(ARM);
  await page.getByTestId("live-arm-confirm").click();
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "true");
  await expect(page.getByTestId("rig-armed-badge")).toBeVisible();
  // Audition "Solo" with a short delay. The routes carry hardware prerequisites (Cross MIDI Thru,
  // Omniport mode, Strymon's MIDI EXP cable): the first send is refused until they are acknowledged
  // in a dialog that names them; nothing is queued meanwhile. Then nine sent entries in compiled order.
  await page.getByLabel("Live scene").selectOption({ label: "Solo" });
  await page.getByTestId("live-dry-run").click();
  await expect(page.getByTestId("live-dry-run-confirmations")).toContainText("Cross MIDI Thru");
  await page.getByLabel("Audition delay").fill("5");
  await page.getByTestId("live-audition").click();
  const confirm = page.getByTestId("live-confirm");
  await expect(confirm).toHaveAttribute("data-reason", "route");
  await expect(confirm.getByTestId("live-confirm-items")).toContainText("Cross MIDI Thru");
  await expect(confirm.getByTestId("live-confirm-items")).toContainText("Omniport");
  await expect(page.getByTestId("live-log").locator('li[data-kind="queued"]')).toHaveCount(0);
  await confirm.getByTestId("live-confirm-send").click();
  await expect(page.getByTestId("live-confirm")).toHaveCount(0);
  const sent = page.getByTestId("live-log").locator('li[data-kind="sent"]');
  await expect(sent).toHaveCount(9, { timeout: 10_000 });
  await expect(sent.last()).toContainText("1/9 CC 0 = 0 ch 10 → ML10X"); // newest first in the log
  await expect(sent.first()).toContainText("9/9 CC 102 = 127 ch 2 → BigSky MX");
  await expect(page.getByTestId("live-sim-inst_sunset")).toContainText("PC 2");
  await expect(page.getByTestId("live-sim-inst_sunset")).toContainText("engaged");
  await expect(page.getByTestId("live-sim-inst_sunset")).toContainText("CC 15 = 127");
  await expect(page.getByTestId("live-last-inst_sunset")).toContainText("CC 15 = 127");
  await expect(page.getByTestId("live-observed-inst_sunset")).toContainText("no reply observed");
  // Stop: a slow audition is cancelled, the log says so and that transmitted messages are not undone.
  // The acknowledgement is remembered for the session: no second dialog.
  await page.getByLabel("Audition delay").fill("400");
  await page.getByTestId("live-audition").click();
  await expect(page.getByTestId("live-confirm")).toHaveCount(0);
  await expect(page.getByTestId("live-log").locator('li[data-kind="queued"]').first()).toBeVisible();
  await page.getByTestId("live-stop").click();
  await expect(page.getByTestId("live-log").locator('li[data-kind="stopped"]').first()).toContainText("not undone");
  await expect(page.getByTestId("live-log").locator('li[data-kind="cancelled"]').first()).toBeVisible();
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "true"); // Stop is not Disarm
  // Dial one control on the Sunset: the documented "0 = bypass" of CC 15 (B side) is a button, not a
  // free slider; press it, then capture the result to the Solo scene.
  await page.getByTestId("live-send-cc-inst_sunset-15-off").click();
  await expect(page.getByTestId("live-sim-inst_sunset")).toContainText("CC 15 = 0");
  await expect(page.getByTestId("live-last-inst_sunset")).toContainText("CC 15 = 0");
  // The scene is not rewritten by sending: Solo still says 127 until captured.
  let rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  const sceneCc = (r: typeof rig) => r.scenes.find((s: { id: string }) => s.id === "scene_solo").device_states.find((d: { instance_id: string }) => d.instance_id === "inst_sunset").cc_values.find((c: { cc: number }) => c.cc === 15).value;
  expect(sceneCc(rig)).toBe(127);
  await page.getByTestId("live-capture-inst_sunset").click();
  const preview = page.getByTestId("live-capture-preview-inst_sunset");
  await expect(preview).toContainText("CC 15 → 0 (Bypass/engage B side)");
  await expect(preview).not.toContainText("program →"); // PC 2 already in the scene: not a change
  await page.getByTestId("live-capture-confirm-inst_sunset").click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 10_000 });
  rig = await (await page.request.get(`/api/rigs/${rigId}`)).json();
  expect(sceneCc(rig)).toBe(0);
  expect(rig.revision).toBeGreaterThan(0);
  // The Scenes tab shows the captured value as an ordinary CC row (with the documented name as label).
  await page.getByRole("tab", { name: "scenes" }).click();
  await expect(page.getByTestId("cc-values-inst_sunset").getByLabel("CC value")).toHaveValue("0");
  // Reload: the captured value persists and compiles into the plan and into a new dry run.
  await page.reload();
  await page.getByRole("tab", { name: "scenes" }).click();
  await page.getByRole("button", { name: /^Solo/ }).click();
  await expect(page.getByTestId("cc-values-inst_sunset").getByLabel("CC value")).toHaveValue("0");
  await page.getByRole("tab", { name: "live" }).click();
  await page.getByLabel("Live scene").selectOption({ label: "Solo" });
  await page.getByTestId("live-dry-run").click();
  await expect(page.getByTestId("live-dry-run-table")).toContainText("CC 15 = 0 ch 3 → Sunset");
  // The reload did not re-arm anything by itself (the backend kept its state; the page only shows it).
  await page.getByTestId("live-disarm").click();
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "false");
  await page.getByTestId("live-disconnect").click();
  await expect(page.getByTestId("live-header")).toContainText("not connected");
});

test("live: a simulated MC8 stomp is followed honestly — incomplete evidence stays ambiguous, a full match is only 'possible'", async ({ page }) => {
  await openCopy(page);
  await page.getByTestId("live-suggest").click();
  await expect(page.getByTestId("live-follower-text")).toContainText("Connect the rig first");
  await page.getByTestId("live-connect").click();
  await expect(page.getByTestId("live-follower")).toContainText("no evidence");
  await expect(page.getByTestId("live-observed")).toContainText("Nothing observed yet");
  // One PC on the ML10X's channel: part of a scene, reported as incomplete.
  await page.getByLabel("Inject channel").fill("10");
  await page.getByLabel("Inject PC").fill("1");
  await page.getByTestId("live-inject-pc").click();
  await expect(page.getByTestId("live-observed")).toContainText("PC 1 ch 10 on Virtual USB — MC8 (to computer)");
  await expect(page.getByTestId("live-follower")).toContainText("ambiguous");
  await expect(page.getByTestId("live-follower-text")).toContainText("incomplete");
  // Every compiled message of "Heavy verse": possible, with the caveat; never "active".
  await page.getByTestId("live-inject-scene-scene_heavy").click();
  await expect(page.getByTestId("live-follower")).toContainText("possible active scene");
  await expect(page.getByTestId("live-follower-text")).toContainText("does not prove which footswitch");
  await expect(page.getByTestId("live-follower")).toContainText("Heavy verse");
  // Observation is not simulated pedal state: the simulated pedals were never sent anything.
  await expect(page.getByTestId("live-sim-inst_ml10x")).toContainText("untouched");
  await expect(page.getByTestId("live-observed-inst_ml10x")).toContainText("PC 1");
  // A complete match is time-limited: it must expire without any additional MIDI messages.
  await expect(page.getByTestId("live-follower")).toContainText("no evidence", { timeout: 10000 });
  await expect(page.getByTestId("live-follower")).not.toContainText("Heavy verse");
  // Still disarmed, and the scene editor was not touched.
  await expect(page.getByTestId("live-header")).toHaveAttribute("data-armed", "false");
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
});
