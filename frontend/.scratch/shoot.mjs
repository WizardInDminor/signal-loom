import { chromium } from "@playwright/test";
const out = "/tmp/claude-0/-home-user-signal-loom/a44c7ebb-b6a9-53d8-bbf9-e9f722f6eab8/scratchpad/shots";
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:3000/");
await page.waitForSelector("text=Stereo demo");
await page.screenshot({ path: `${out}/00-home.png` });
await page.goto("http://localhost:3000/rigs/rig_demo_stereo");
await page.waitForSelector('[data-testid="board-canvas"]');
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/01-board.png` });
for (const t of ["wiring", "scenes", "controllers", "exports"]) {
  await page.getByRole("tab", { name: t }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/02-${t}.png`, fullPage: true });
}
console.log("console errors:", errors);
await browser.close();
