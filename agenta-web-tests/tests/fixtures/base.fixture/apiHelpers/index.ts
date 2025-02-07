import { expect } from "@playwright/test";
import type { ApiHelpers } from "./types";
import { UseFn } from "../../types";
import { FixtureContext } from "../types";

export const apiHelpers = () => {
  return async ({ page }: FixtureContext, use: UseFn<ApiHelpers>) => {
    await use({
      waitForApiResponse: async (options) => {
        const {
          route,
          method = "POST",
          validateStatus = true,
          responseHandler,
        } = options;

        const response = await page.waitForResponse((response) => {
          const url = response.url();
          return (
            (route instanceof RegExp ? route.test(url) : url.includes(route)) &&
            response.request().method() === method
          );
        });

        if (validateStatus) {
          expect(response.status()).toBe(200);
        }

        const data = await response.json();
        if (responseHandler) await responseHandler(data);
        return data;
      },
    });
  };
};
