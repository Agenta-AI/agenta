import {expect} from "@playwright/test"

import {getTestmailClient} from "../../../../utils/testmail"
import type {BaseFixture} from "../../base.fixture/types"
import {UseFn} from "../../types"

import type {AuthHelpers, AuthResponse} from "./types"

export const authHelpers = () => {
    return async ({page, uiHelpers, apiHelpers}: BaseFixture, use: UseFn<AuthHelpers>) => {
        const helpers: AuthHelpers = {
            completeLLMKeysCheck: async () => {
                await page.goto("/settings")
                await uiHelpers.expectText("Available Providers", {
                    role: "heading",
                })

                // check if there's an OpenAI key
                const container = await page
                    .locator("div")
                    .filter({hasText: "Available Providers"})
                    .last()

                await expect(container).toBeVisible()
                const openAIRow = await container
                    .locator("div.ant-space")
                    .filter({hasText: "OpenAI"})
                    .first()
                const openAIKey = await openAIRow.getByRole("textbox").first()

                const openAIKeyText = await openAIKey.inputValue()

                // enter and save a key for OpenAI if it's not already there
                if (!openAIKeyText) {
                    await openAIKey.fill("testkey")
                    await openAIRow
                        .getByRole("button", {
                            name: /^Save$/,
                        })
                        .first()
                        .click()

                    await uiHelpers.waitForLoadingState("The secret is saved")
                }

                await page.goto("/apps")
            },

            completePostSignup: async () => {
                await uiHelpers.expectText("Tell us about yourself")
                await uiHelpers.selectOption({text: "2-10"})
                await uiHelpers.selectOption({text: "Hobbyist"})
                await uiHelpers.selectOption({text: "Just exploring"})
                await uiHelpers.clickButton("Continue")

                await uiHelpers.expectText("What brings you here?")
                await uiHelpers.selectOption({text: "Evaluating LLM Applications"})
                await uiHelpers.selectOption({
                    text: ["Github", {exact: true}],
                })
                await uiHelpers.clickButton("Continue")
            },

            loginWithEmail: async (
                email: string,
                password?: string,
                options: {
                    timeout?: number
                    inputDelay?: number
                } = {},
            ) => {
                const {timeout, inputDelay = 100} = options
                const testmail = getTestmailClient()
                let otpRequestedAt = Date.now()

                async function fillOTPDigits(otp: string, delay: number): Promise<void> {
                    // Ant Design 5.x Input.OTP: <div class="ant-otp"><input class="ant-otp-input"/>...</div>
                    // Click the first cell to ensure focus, then type sequentially.
                    const firstInput = page.locator(".ant-otp input").first()
                    await firstInput.waitFor({state: "visible", timeout: 10000})
                    await firstInput.click()
                    await page.keyboard.type(otp, {delay})
                }

                await page.goto("/auth")
                // @ts-ignore
                await page.evaluate(() => window.localStorage.clear())

                const timestamp = Date.now()
                await uiHelpers.typeWithDelay('input[type="email"]', email)

                const signinButton = await page.getByRole("button", {name: "Sign in"})
                const continueWithEmailButton = page.getByRole("button", {
                    name: "Continue with email",
                })
                const continueWithOtpButton = page.getByRole("button", {
                    name: "Continue with OTP",
                })
                const continueButton = page.getByRole("button", {
                    name: "Continue",
                    exact: true,
                })

                const hasSigninButton = await signinButton.isVisible()
                if (hasSigninButton) {
                    await uiHelpers.typeWithDelay("input[type='password']", password as string)
                    await signinButton.click()
                    await uiHelpers.waitForPath("/apps")
                } else {
                    if (await continueWithEmailButton.isVisible().catch(() => false)) {
                        await continueWithEmailButton.click()
                    } else if (await continueWithOtpButton.isVisible().catch(() => false)) {
                        await continueWithOtpButton.click()
                    } else if (await continueButton.isVisible().catch(() => false)) {
                        await continueButton.click()
                    }

                    const verifyEmailText = page.getByText("Verify your email")
                    const continueWithOtpButton = page.getByRole("button", {
                        name: "Continue with OTP",
                    })
                    const resendOtpLink = page.getByText("Resend one-time password")
                    await Promise.race([
                        verifyEmailText.waitFor({state: "visible", timeout}),
                        continueWithOtpButton.waitFor({state: "visible", timeout}),
                        resendOtpLink.waitFor({state: "visible", timeout}),
                    ])

                    const otpAlreadyRequested = await resendOtpLink.isVisible().catch(() => false)

                    if (
                        !otpAlreadyRequested &&
                        (await continueWithOtpButton.isVisible().catch(() => false))
                    ) {
                        otpRequestedAt = Date.now()
                        const createCodeResponsePromise = apiHelpers.waitForApiResponse({
                            route: /\/api\/auth\/signinup\/code(?:\?|$)/,
                            validateStatus: true,
                        })
                        await continueWithOtpButton.click()
                        await createCodeResponsePromise
                        await resendOtpLink.waitFor({state: "visible", timeout})
                    }

                    if (await resendOtpLink.isVisible().catch(() => false)) {
                        otpRequestedAt = Date.now()
                        const resendCodeResponsePromise = apiHelpers.waitForApiResponse({
                            route: /\/api\/auth\/signinup\/code\/resend(?:\?|$)/,
                            validateStatus: true,
                        })
                        await resendOtpLink.click()
                        await resendCodeResponsePromise
                    }
                    try {
                        const otp = await testmail.waitForOTP(email, {
                            timeout,
                            timestamp_from: otpRequestedAt,
                        })
                        const responsePromise = apiHelpers.waitForApiResponse<AuthResponse>({
                            route: "/api/auth/signinup/code/consume",
                            validateStatus: true,
                        })

                        await fillOTPDigits(otp, inputDelay)
                        await uiHelpers.clickButton("Continue with OTP")
                        const responseData = await responsePromise

                        if (responseData.createdNewRecipeUser) {
                            await uiHelpers.waitForPath("/post-signup")
                            await helpers.completePostSignup()
                        }

                        await uiHelpers.waitForPath("/apps")
                    } catch (error) {
                        console.error("Error in login flow:", error)
                        throw error
                    }
                }
            },
        }

        await use(helpers)
    }
}
