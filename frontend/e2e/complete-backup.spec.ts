import { expect, test } from "@playwright/test";

// Complete backup is a save-only operation and uses both asset categories.
test("Exports offers a complete photos + PDFs download", async ({ page }) => {
  const res = await page.request.post("/api/rigs", { data: { name: `E2E backup ${Date.now()}` } });
  expect(res.ok()).toBeTruthy();
  const rig = await res.json();
  try {
    await page.goto(`/rigs/${rig.id}#exports`);
    const button = page.getByTestId("complete-backup");
    await expect(button).toBeVisible({ timeout: 15000 });
    await expect(button).toContainText("photos + PDFs");
    const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
    expect(download.suggestedFilename()).toMatch(/\.complete\.signal-loom\.json$/);
    await expect(page.getByTestId("complete-backup-report")).toContainText(
      "Complete backup downloaded: 0 photo(s) and 0 PDF manual(s).",
    );
    const api = await page.request.get(`/api/rigs/${rig.id}/export?include_images=1&include_documents=1&require_complete=1`);
    expect(api.ok()).toBeTruthy();
    const payload = await api.json();
    expect(payload.format_version).toBe(3);
    expect(payload.assets).toEqual([]);
  } finally {
    await page.request.delete(`/api/rigs/${rig.id}`);
  }
});
