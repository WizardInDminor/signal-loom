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

// ---- Contrast regressions (WCAG AA) ----
const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Chromium may report lab()/color() values; normalise any CSS colour to sRGB through a canvas.
const toRgb = (page: Page, colors: string[]) => page.evaluate((list) => {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  return list.map((c) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = "#000"; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)); });
}, colors);
const contrast = async (page: Page, fg: string, bg: string) => { const [f, b] = await toRgb(page, [fg, bg]); return ratio(f, b); };

async function demoRig(page: Page) {
  const res = await page.request.post("/api/rigs", { data: { name: `Theme e2e ${Date.now()}`, from_demo: true } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).id as string;
}
async function goDark(page: Page, url: string) {
  await page.addInitScript(() => localStorage.setItem("signal-loom-theme", "dark"));
  await page.goto(url);
  expect(await theme(page)).toBe("dark");
}

test("dark accent text meets 4.5:1 on panel/background and white-on-accent buttons stay AA", async ({ page }) => {
  await goDark(page, "/");
  const c = await page.evaluate(() => {
    const probe = (v: string) => { const e = document.createElement("i"); e.style.color = `var(${v})`; document.body.append(e); const r = getComputedStyle(e).color; e.remove(); return r; };
    return { text: probe("--accent-text"), accent: probe("--accent"), panel: probe("--panel"), bg: probe("--background") };
  });
  expect(await contrast(page, c.text, c.panel)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page, c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
  expect(await contrast(page, "#ffffff", c.accent)).toBeGreaterThanOrEqual(4.5);
});

test("dark: wiring and board paper canvases keep dark ink on light surfaces", async ({ page }) => {
  const id = await demoRig(page);
  try {
    await goDark(page, `/rigs/${id}`);
    for (const [tab, svgSel] of [["wiring", 'svg[aria-label="Wiring diagram"]'], ["board", 'svg:has([data-testid="board-surface"])']] as const) {
      await page.getByRole("tab", { name: tab }).click();
      const svg = page.locator(svgSel).first();
      await expect(svg).toBeVisible();
      const r = await svg.evaluate((el) => {
        const bgc = getComputedStyle(el).backgroundColor;
        const t = [...el.querySelectorAll("text")].filter((x) => x.textContent?.trim());
        return { bg: bgc, fills: t.map((x) => getComputedStyle(x).fill) };
      });
      expect(r.fills.length).toBeGreaterThan(0);
      for (const f of r.fills) expect(await contrast(page, f, r.bg), `${tab} text ${f} on ${r.bg}`).toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await page.request.delete(`/api/rigs/${id}`);
  }
});

test("dark: selected/illuminated MC8 states use dark ink on their light fills", async ({ page }) => {
  const id = await demoRig(page);
  try {
    await goDark(page, `/rigs/${id}`);
    await page.getByRole("tab", { name: "stage" }).click();
    const face = page.getByTestId("mc8-face");
    await expect(face).toBeVisible();
    const pairs = await face.evaluate((el) => [...el.querySelectorAll(".bg-amber-300, .bg-slate-100")].map((x) => { const s = getComputedStyle(x); return { fg: s.color, bg: s.backgroundColor }; }));
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect(await contrast(page, p.fg, p.bg), `MC8 ${p.fg} on ${p.bg}`).toBeGreaterThanOrEqual(4.5);
  } finally {
    await page.request.delete(`/api/rigs/${id}`);
  }
});
