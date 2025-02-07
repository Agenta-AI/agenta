import type { AuthHelpers, AuthResponse } from "./types";
import { getTestmailClient } from "../../../../utils/testmail";
import type { BaseFixture } from "../../base.fixture/types";
import { UseFn } from "../../types";
import { expect } from "@playwright/test";

export const authHelpers = () => {
  return async (
    { page, uiHelpers, apiHelpers }: BaseFixture,
    use: UseFn<AuthHelpers>
  ) => {
    const helpers: AuthHelpers = {
      completeLLMKeysCheck: async () => {
        await page.goto("/settings");
        await uiHelpers.expectText("Available Providers", {
          role: "heading",
        });

        // check if there's an OpenAI key
        const container = await page
          .locator("div")
          .filter({ hasText: "Available Providers" })
          .last();

        await expect(container).toBeVisible();
        const openAIRow = await container
          .locator("div.ant-space")
          .filter({ hasText: "OpenAI" })
          .first();
        const openAIKey = await openAIRow.getByRole("textbox").first();

        const openAIKeyText = await openAIKey.inputValue();

        // enter and save a key for OpenAI if it's not already there
        if (!openAIKeyText) {
          await openAIKey.fill("testkey");
          await openAIRow
            .getByRole("button", {
              name: /^Save$/,
            })
            .first()
            .click();

          await uiHelpers.waitForLoadingState("The secret is saved");
        }

        await page.goto("/apps");
      },

      completePostSignup: async () => {
        await uiHelpers.expectText("Tell us about yourself");
        await uiHelpers.selectOption({ text: "1-10" });
        await uiHelpers.selectOption({ text: "Hobbyist" });
        await uiHelpers.selectOption({ text: "Just exploring" });
        await uiHelpers.clickButton("Continue");

        await uiHelpers.expectText("What brings you here?");
        await uiHelpers.selectOption({ text: "Evaluating LLM Applications" });
        await uiHelpers.selectOption({
          text: ["Just exploring", { exact: true }],
        });
        await uiHelpers.clickButton("Continue");
      },

      loginWithEmail: async (email, options = {}) => {
        const { timeout, inputDelay = 100 } = options;
        const testmail = getTestmailClient();

        async function fillOTPDigits(
          otp: string,
          delay: number
        ): Promise<void> {
          const digits = otp.split("");
          for (let i = 0; i < digits.length; i++) {
            await uiHelpers.typeWithDelay(
              `.ant-input:nth-child(${i + 1})`,
              digits[i],
              delay
            );
          }
        }

        await page.goto("/auth");
        const timestamp = Date.now();
        await uiHelpers.typeWithDelay('input[type="email"]', email);
        await uiHelpers.clickButton("Continue with email");
        await uiHelpers.expectText("Verify your email");

        try {
          const otp = await testmail.waitForOTP(email, {
            timeout,
            timestamp_from: timestamp,
          });
          const responsePromise = apiHelpers.waitForApiResponse<AuthResponse>({
            route: "/api/auth/signinup/code/consume",
            validateStatus: true,
          });

          await fillOTPDigits(otp, inputDelay);
          await uiHelpers.clickButton("Next");
          const responseData = await responsePromise;

          if (responseData.createdNewRecipeUser) {
            await uiHelpers.waitForPath("/post-signup");
            await helpers.completePostSignup();
          }

          await uiHelpers.waitForPath("/apps");
        } catch (error) {
          console.error("Error in login flow:", error);
          throw error;
        }
      },
    };

    await use(helpers);
  };
};
