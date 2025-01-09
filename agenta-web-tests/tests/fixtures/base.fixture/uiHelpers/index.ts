import { expect } from "@playwright/test";
import type { UIHelpers } from "./types";
import { UseFn } from "../../types";
import { FixtureContext } from "../types";

export const uiHelpers = () => {
  return async ({ page }: FixtureContext, use: UseFn<UIHelpers>) => {
    await use({
      expectText: async (text: string, options = {}) => {
        let locator;
        const role = options.role;
        if (role) {
          locator = page.getByRole(role, { name: text });
        } else {
          locator = page.getByText(text, { exact: options.exact });
        }

        if (options.multiple) {
          const count = await locator.count();
          expect(count).toBeGreaterThan(0);
        } else {
          await expect(locator).toBeVisible();
        }
      },

      expectNoText: async (text) => {
        await expect(page.getByText(text)).not.toBeVisible();
      },

      typeWithDelay: async (selector, text, delay = 50) => {
        const input = page.locator(selector);
        await input.click();
        await input.pressSequentially(text, { delay });
      },

      clickButton: async (name, locator) => {
        const button = (locator || page).getByRole("button", { name }).first();
        await button.click();
      },

      selectOption: async ({ label, text }) => {
        if (text) {
          if (Array.isArray(text)) {
            const [textValue, options] = text;
            await page.getByText(textValue, options).click();
          } else {
            await page.getByText(text).click();
          }
        } else if (label) {
          await page.getByLabel(label).check();
        }
      },

      selectOptions: async (labels) => {
        for (const label of labels) {
          await page.getByLabel(label).check();
        }
      },

      expectPath: async (path) => {
        await expect(page).toHaveURL(new RegExp(path));
      },

      waitForPath: async (path) => {
        await page.waitForURL(path, { waitUntil: "domcontentloaded" });
      },

      waitForLoadingState: async (text) => {
        const loading = page.getByText(text);
        await expect(loading).toBeVisible();
        await expect(loading).not.toBeVisible();
      },
    });
  };
};
