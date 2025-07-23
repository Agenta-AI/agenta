/**
 * Automates Playwright authentication and storage setup.
 */

import {chromium, FullConfig} from "@playwright/test"

import {waitForApiResponse} from "../tests/fixtures/base.fixture/apiHelpers"
import {
    clickButton,
    selectOption,
    typeWithDelay,
    waitForPath,
} from "../tests/fixtures/base.fixture/uiHelpers/helpers"
import {AuthResponse} from "../tests/fixtures/user.fixture/authHelpers/types"
import {createInitialUserState} from "../tests/fixtures/user.fixture/authHelpers/utilities"
import {getTestmailClient} from "../utils/testmail"

/**
 * Runs before Playwright tests to automate authentication.
 * Handles both login and signup flows.
 * Stores authenticated state in a file to be reused by tests.
 */
async function globalSetup(config: FullConfig) {
    // Automate authentication before Playwright tests
    console.log("[global-setup] Starting global setup for authentication")

    const project = config.projects.find((project) => project.name === process.env.PROJECT)
    console.log(`[global-setup] Resolved project: ${process.env.PROJECT}`)
    if (!project) {
        throw new Error(`Project ${process.env.PROJECT} not found`)
    }
    const {baseURL, storageState} = project.use
    const timeout = 60000
    const inputDelay = 100

    const {email, password} = createInitialUserState({
        name: project.name,
    })

    console.log("[global-setup] Launching browser")
    const browser = await chromium.launch()
    const page = await browser.newPage()

    console.log(`[global-setup] Navigating to auth page: ${baseURL}/auth`)
    await page.goto(`${baseURL}/auth`)

    console.log("[global-setup] Clearing local storage")

    // @ts-ignore
    await page.evaluate(() => window.localStorage.clear())

    const testmail = getTestmailClient()
    /**
     * Fills OTP input fields on the page one digit at a time.
     * @param otp - The one-time password string.
     * @param delay - Delay in ms between typing each digit.
     */
    async function fillOTPDigits(otp: string, delay: number): Promise<void> {
        console.log("[global-setup] Filling OTP digits")
        const digits = otp.split("")
        for (let i = 0; i < digits.length; i++) {
            await typeWithDelay(page, `[aria-label='OTP Input ${i + 1}']`, digits[i], delay)
        }
    }

    const timestamp = Date.now()
    console.log(`[global-setup] Typing email: ${email}`)
    await typeWithDelay(page, 'input[type="email"]', email)
    const signinButton = await page.getByRole("button", {name: "Sign in"})

    const hasSigninButton = await signinButton.isVisible()

    if (hasSigninButton) {
        // Password sign-in flow
        if (!password) {
            throw new Error("Password is required for password sign-in flow")
        }

        try {
            console.log("[global-setup] Typing password")
            await typeWithDelay(page, "input[type='password']", password)
            console.log("[global-setup] Clicking Sign in button")
            await signinButton.click()
            console.log(`[global-setup] Waiting for navigation to: ${baseURL}/apps`)
            await waitForPath(page, `${baseURL}/apps`)
        } catch (error) {
            console.error("[global-setup] Error in login flow:", error)
            throw error
        } finally {
            console.log("[global-setup] Saving storage state and closing browser")
            await page.context().storageState({path: storageState as string})
            await browser.close()
        }
    } else {
        // Email verification and OTP flow
        await clickButton(page, "Continue with email")
        const verifyEmailLocator = page.getByText("Verify your email")
        await verifyEmailLocator.waitFor({state: "visible"})
        try {
            console.log("[global-setup] Waiting for OTP email")
            const otp = await testmail.waitForOTP(email, {
                timeout,
                timestamp_from: timestamp,
            })
            console.log("[global-setup] OTP received, preparing to input")
            const responsePromise = waitForApiResponse<AuthResponse>(page, {
                route: "/api/auth/signinup/code/consume",
                validateStatus: true,
            })

            await fillOTPDigits(otp, inputDelay)
            console.log("[global-setup] Clicking Next button after OTP input")
            await clickButton(page, "Next")
            const responseData = await responsePromise

            if (responseData.createdNewRecipeUser) {
                console.log("[global-setup] New user detected, completing post-signup flow")
                await page.waitForURL(`${baseURL}/post-signup`, {waitUntil: "load"})

                const tellUsAboutYourselfLocator = page.getByText("Tell us about yourself")
                await tellUsAboutYourselfLocator.waitFor({state: "visible"})
                const isOptionVisible = await page
                    .getByRole("option", {name: "Hobbyist"})
                    .isVisible()

                if (isOptionVisible) {
                    await selectOption(page, {text: "2-10"})
                    await selectOption(page, {text: "Hobbyist"})
                    await selectOption(page, {text: "Just exploring"})
                    await clickButton(page, "Continue")

                    const whatBringsYouHereLocator = page.getByText("What brings you here?")
                    await whatBringsYouHereLocator.waitFor({state: "visible"})

                    await selectOption(page, {text: "Evaluating LLM Applications"})
                    await selectOption(page, {
                        text: "Github",
                    })
                    await clickButton(page, "Continue")
                    console.log("[global-setup] Post-signup flow completed")
                    console.log(`[global-setup] Waiting for navigation to: ${baseURL}/apps`)
                    await waitForPath(page, `${baseURL}/apps`)
                } else {
                    console.log(
                        "[global-setup] Post-signup flow not completed due to missing options",
                    )
                }
            }
        } catch (error) {
            console.error("[global-setup] Error in login flow:", error)
            throw error
        } finally {
            console.log("[global-setup] Saving storage state and closing browser")
            await page.context().storageState({path: storageState as string})
            await browser.close()
        }
    }
}

export default globalSetup
