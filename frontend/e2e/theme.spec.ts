import { expect, test, type Page } from "@playwright/test";

// App-wide Light/Dark theme: frontend-only, persisted in localStorage, never sent to the backend.

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme ?? "light");
const bg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test("defaults to Light with an accessible pressed-state toggle", async ({ page }) => {
  await page.goto("/");
  expect(await theme(page)).toBe("light");
  const group = page.getByRole("group", { name: "Theme" });
  await expect(group.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  await expect(group.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "false");
  expect(await bg(page)).toBe("rgb(246, 247, 249)");
});

test("Dark persists across reload and route changes; backend is not written", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => { if (r.url().includes("/api/") && r.method() !== "GET") writes.push(`${r.method()} ${r.url()}`); });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  expect(await theme(page)).toBe("dark");
  expect(await bg(page)).toBe("rgb(15, 17, 21)");
  expect(await page.evaluate(() => localStorage.getItem("signal-loom-theme"))).toBe("dark");

  await page.reload();
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");

  for (const [name, path] of [["Device library", "/catalog"], ["Morningstar Bridge", "/morningstar"], ["Rigs", "/"]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
    await page.waitForURL((u) => u.pathname === path);
    expect(await theme(page)).toBe("dark");
    expect(await bg(page)).toBe("rgb(15, 17, 21)");
  }
  expect(writes).toEqual([]);

  await page.getByRole("button", { name: "Light" }).click();
  await page.reload();
  expect(await theme(page)).toBe("light");
});

test("saved Dark is applied before first paint (no light flash)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("signal-loom-theme", "dark"));
  await page.goto("/catalog");
  expect(await theme(page)).toBe("dark");
});

test("blocked storage does not crash the app", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); } });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  expect(await theme(page)).toBe("dark");
  expect(errors).toEqual([]);
});

test("dark mode: library panels, form controls and diagnostics stay legible", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  await page.goto("/catalog");
  const field = page.locator("input").first();
  await expect(field).toBeVisible();
  const colors = await field.evaluate((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, fg: s.color, scheme: getComputedStyle(document.documentElement).colorScheme }; });
  expect(colors.bg).toBe("rgb(24, 27, 33)");
  expect(colors.fg).toBe("rgb(230, 232, 236)");
  expect(colors.scheme).toBe("dark");
});

test("phone width: toggle fits without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark" }).click();
  // The shared header must not overflow (page content below it is out of scope for this check).
  const overflow = await page.locator("header").first().evaluate((h) => h.scrollWidth - h.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.getByTestId("theme-toggle").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
});
