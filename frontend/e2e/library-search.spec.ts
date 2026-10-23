import { expect, test, type Page, type Route } from "@playwright/test";

// UX-LIBRARY-01: the Device Library's visible list must always answer the visible query.
//
// The defect: every keystroke asked the backend for a new list and the page accepted whichever
// answer arrived last. With a large imported catalog the unfiltered (or one-letter) request is the
// slowest to serialize, so it regularly landed after the request for the full word and replaced the
// filtered list while the input still showed the word. These tests make that ordering
// deterministic: responses are held back for longer the shorter their query is, so the empty and
// one-letter answers always arrive after the answer for "Mood".

const created: string[] = [];

async function moodProfile(page: Page) {
  const base = await (await page.request.get("/api/catalog/devices/eqd-plumes")).json();
  const id = `e2e-mood-${Date.now().toString(36)}`;
  const copy = { ...base, id, manufacturer: "Chase Bliss", model: `MOOD MKII ${id}`, builtin: false, ports: [], provenance: { ...base.provenance, source: "user", evidence: "user" } };
  delete copy.unknown_attributes; delete copy.source; delete copy.document_files;
  expect((await page.request.post("/api/catalog/devices", { data: copy })).ok()).toBeTruthy();
  created.push(id);
  return { id, title: `Chase Bliss MOOD MKII ${id}` };
}

/** Hold every list response back for (5 − query length) × 300 ms: "" waits 1.5 s, "M" 1.2 s, "Mood" not at all. */
async function slowShortQueries(page: Page, log?: string[]) {
  await page.route((url) => url.pathname === "/api/catalog/devices", async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    log?.push(q);
    const wait = Math.max(0, 5 - q.length) * 300;
    try {
      const response = await route.fetch();
      if (wait) await new Promise((r) => setTimeout(r, wait));
      await route.fulfill({ response });
    } catch {
      // The page aborted a superseded request; nothing to deliver.
    }
  });
}

const list = (page: Page) => page.getByTestId("library-list");
const rows = (page: Page) => list(page).getByRole("listitem");
const search = (page: Page) => page.getByLabel("Search devices");

test.afterEach(async ({ page }) => {
  while (created.length) await page.request.delete(`/api/catalog/devices/${created.pop()}`);
});

test("library search: rapid typing with out-of-order answers never replaces the filtered list", async ({ page }) => {
  const { title } = await moodProfile(page);
  const asked: string[] = [];
  await slowShortQueries(page, asked);
  await page.goto("/catalog");
  const input = search(page);
  await expect(input).toBeVisible();
  // Type before the unfiltered first load has answered: its answer is the last to land.
  await input.pressSequentially("Mood", { delay: 40 });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText(title);
  // Long enough for every held-back answer ("", "M", "Mo", "Moo") to have arrived.
  await page.waitForTimeout(2000);
  await expect(input).toHaveValue("Mood");
  await expect(input).toBeFocused();
  await expect(rows(page)).toHaveCount(1);
  await expect(list(page)).toHaveAttribute("data-query", "Mood");
  // Rapid typing is debounced: the intermediate prefixes are not all sent to the backend.
  expect(asked.filter((q) => q === "Mood").length).toBeGreaterThanOrEqual(1);
  expect(asked.length).toBeLessThan(5);
});

test("library search: deleting and re-adding a letter, selecting a profile, cancelling and saving an edit all keep the query and the list", async ({ page }) => {
  const { id, title } = await moodProfile(page);
  await slowShortQueries(page);
  await page.goto("/catalog");
  const input = search(page);
  await input.fill("Mood");
  await expect(rows(page)).toHaveCount(1);

  await input.press("Backspace");
  await expect(input).toHaveValue("Moo");
  await input.pressSequentially("d");
  await page.waitForTimeout(1200);
  await expect(input).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);

  // Selecting the profile shows it and leaves the filter alone.
  await rows(page).first().getByRole("button").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(input).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);

  // Edit → Cancel: nothing re-fetched, nothing lost.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("heading", { name: `Edit ${id}` })).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(input).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);

  // Edit → Save refreshes the library *for the visible query*, not for an older one.
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(input).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);
  await expect(list(page)).toHaveAttribute("data-query", "Mood");
});

test("library search: the query survives a reload, the browser's Back from the Workbench, and the Workbench's own way back", async ({ page }) => {
  const { id, title } = await moodProfile(page);
  await page.goto("/catalog");
  const input = search(page);
  await input.fill("Mood");
  await expect(rows(page)).toHaveCount(1);
  await rows(page).first().getByRole("button").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page).toHaveURL(/q=Mood/);
  await expect(page).toHaveURL(new RegExp(`device=${id}`));

  await page.reload();
  await expect(search(page)).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.getByTestId("open-workbench").click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 15_000 });
  await page.goBack();
  await expect(search(page)).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // The Workbench's "← Device library" link reopens the profile; the library keeps the search too.
  await page.getByTestId("open-workbench").click();
  await expect(page.getByTestId("workbench")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "← Device library" }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(search(page)).toHaveValue("Mood");
  await expect(rows(page)).toHaveCount(1);
});

test("library search: zero results say so and Clear restores the whole library with focus in the field; the category filter combines with the query", async ({ page }) => {
  await page.goto("/catalog");
  const input = search(page);
  await expect(rows(page).first()).toBeVisible();
  const all = await rows(page).count();
  expect(all).toBeGreaterThan(5);

  await input.fill("zzzz nothing");
  await expect(page.getByTestId("library-empty")).toContainText("No devices match “zzzz nothing”");
  await expect(rows(page)).toHaveCount(0);
  await page.getByTestId("library-clear").click();
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(rows(page)).toHaveCount(all);

  await page.getByLabel("Category").selectOption("controller");
  await input.fill("Plumes");
  await expect(page.getByTestId("library-empty")).toContainText("in controller");
  await page.getByLabel("Category").selectOption("effect");
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText("Plumes");
  await expect(page.getByTestId("library-count")).toContainText("1 match for “Plumes” in effect");
});
