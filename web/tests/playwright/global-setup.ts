/**
 * Automates Playwright authentication and storage setup.
 */

import {chromium} from "@playwright/test"

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
async function globalSetup() {
    // Automate authentication before Playwright tests
    console.log("[global-setup] Starting global setup for authentication")

    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost"
    const license = process.env.AGENTA_LICENSE || "oss"
    const storageState = "state.json"
    console.log(`[global-setup] Base URL: ${baseURL}, License: ${license}`)
    const timeout = 60000
    const inputDelay = 100

    const {email} = createInitialUserState({
        name: license,
    })

    console.log("[global-setup] Launching browser")
    const browser = await chromium.launch()
    const page = await browser.newPage()

    console.log(`[global-setup] Navigating to auth page: ${baseURL}/auth`)
    await page.goto(`${baseURL}/auth`, {timeout})

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

    /**
     * Handles the post-signup onboarding flow if it appears.
     * The post-signup form requires POSTHOG_API_KEY to load the survey.
     * Without it, the page auto-redirects to /get-started or /apps.
     */
    async function handlePostSignup(): Promise<void> {
        try {
            await page.waitForURL("**/post-signup", {waitUntil: "load", timeout: 10000})
        } catch {
            // No post-signup flow — already redirected to app
            console.log("[global-setup] No post-signup redirect detected, continuing")
            return
        }

        console.log("[global-setup] New user detected, on post-signup page")

        // Race: the survey form loads ("Tell us about yourself") OR
        // the page redirects away (no PostHog API key → redirects to /get-started or /apps)
        const tellUsAboutYourselfLocator = page.getByText("Tell us about yourself")
        const redirected = page.waitForURL(
            (url) => !url.pathname.endsWith("/post-signup"),
            {timeout: 15000},
        )
        const surveyLoaded = tellUsAboutYourselfLocator
            .waitFor({state: "visible", timeout: 15000})
            .then(() => "survey" as const)

        const result = await Promise.race([
            surveyLoaded,
            redirected.then(() => "redirected" as const),
        ])

        if (result === "redirected") {
            console.log("[global-setup] Post-signup redirected (no PostHog survey), continuing")
            return
        }

        console.log("[global-setup] PostHog survey loaded, completing post-signup flow")
        const isOptionVisible = await page.getByRole("option", {name: "Hobbyist"}).isVisible()

        if (isOptionVisible) {
            await selectOption(page, {text: "2-10"})
            await selectOption(page, {text: "Hobbyist"})
            await selectOption(page, {text: "Just exploring"})
            await clickButton(page, "Continue")

            const whatBringsYouHereLocator = page.getByText("What brings you here?")
            await whatBringsYouHereLocator.waitFor({state: "visible"})

            await selectOption(page, {text: "Evaluating LLM Applications"})
            await selectOption(page, {text: "Github"})
            await clickButton(page, "Continue")
            console.log("[global-setup] Post-signup flow completed")
            await waitForPath(page, `${baseURL}/apps`)
        } else {
            console.log("[global-setup] Post-signup flow not completed due to missing options")
        }
    }

    const timestamp = Date.now()

    // For OSS, use admin credentials from env vars
    const loginEmail =
        license === "oss" ? process.env.AGENTA_ADMIN_EMAIL || email : email
    const adminPassword = process.env.AGENTA_ADMIN_PASSWORD

    console.log(`[global-setup] Typing email: ${loginEmail}`)
    await typeWithDelay(page, 'input[type="email"]', loginEmail)

    // Detect which auth flow the page shows
    const signinButton = page.getByRole("button", {name: "Sign in"})
    const hasSigninButton = await signinButton.isVisible()

    try {
        if (hasSigninButton) {
            // Password sign-in flow (OSS with pre-created admin account)
            const password = adminPassword
            if (!password) {
                throw new Error(
                    "AGENTA_ADMIN_PASSWORD is required for the password sign-in flow",
                )
            }

            console.log("[global-setup] Password sign-in flow detected")
            await typeWithDelay(page, "input[type='password']", password)
            await signinButton.click()
            console.log(`[global-setup] Waiting for navigation to: ${baseURL}/apps`)
            await waitForPath(page, `${baseURL}/apps`)
        } else {
            // Click the email continue button (text varies by deployment)
            const continueWithEmail = page.getByRole("button", {name: "Continue with email"})
            const continueButton = page.getByRole("button", {name: "Continue", exact: true})
            if (await continueWithEmail.isVisible()) {
                await continueWithEmail.click()
            } else {
                await continueButton.click()
            }

            // Wait to see which flow appears: OTP or password signup
            const verifyEmailLocator = page.getByText("Verify your email")
            const passwordInput = page.locator("input[type='password']")

            // Race: whichever appears first determines the flow
            await Promise.race([
                verifyEmailLocator.waitFor({state: "visible", timeout}),
                passwordInput.waitFor({state: "visible", timeout}),
            ])

            if (await passwordInput.isVisible()) {
                // Email + password signup/signin flow (local EE with SuperTokens)
                console.log("[global-setup] Email + password flow detected")
                const testPassword = "TestPass123!"
                await typeWithDelay(page, "input[type='password']", testPassword)
                await clickButton(page, "Continue with password")

                await handlePostSignup()

                // Wait for the page to settle on an authenticated URL
                console.log("[global-setup] Waiting for authenticated page")
                await page.waitForURL(
                    (url) => !url.pathname.includes("/auth") && !url.pathname.endsWith("/post-signup"),
                    {timeout},
                )
                console.log(`[global-setup] Settled on: ${page.url()}`)
            } else {
                // OTP flow (cloud EE with SuperTokens passwordless)
                console.log("[global-setup] OTP flow detected")
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
                    await handlePostSignup()
                }
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

export default globalSetup
