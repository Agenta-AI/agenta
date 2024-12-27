import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

export const test = base.extend({
  loginWithEmail: async ({ page }, use) => {
    const login = async () => {
      await page.goto("http://localhost:3000/auth");
      await page.waitForLoadState("networkidle");

      await page.fill('input[type="email"]', "test@example.com");
      await page.click("text=Login");

      // Wait for navigation or error
      await Promise.race([
        page.waitForURL(/app/),
        page.waitForSelector("[data-testid='error-message']"),
      ]);
    };

    await use(login);
  },
});
