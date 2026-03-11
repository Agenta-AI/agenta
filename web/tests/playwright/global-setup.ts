/**
 * Automates Playwright authentication and storage setup.
 * Optionally creates an ephemeral project for test isolation.
 */

import {chromium} from "@playwright/test"
import {existsSync, writeFileSync} from "fs"

import {waitForApiResponse} from "../tests/fixtures/base.fixture/apiHelpers"
import {
    clickButton,
    selectOption,
    typeWithDelay,
    waitForPath,
} from "../tests/fixtures/base.fixture/uiHelpers/helpers"
import {AuthResponse} from "../tests/fixtures/user.fixture/authHelpers/types"
import {getTestmailClient} from "../utils/testmail"

/**
 * Runs before Playwright tests to automate authentication.
 * Handles both login and signup flows.
 * Stores authenticated state in a file to be reused by tests.
 * When AGENTA_TEST_EPHEMERAL_PROJECT is enabled (default), creates a fresh
 * project scoped to this test run so data doesn't accumulate.
 */
/**
 * Derives the API base URL from AGENTA_WEB_URL.
 * The web app may live at a subpath (e.g. /w) but the API is always at /api on the origin.
 */
function getApiURL(webURL: string): string {
    if (process.env.AGENTA_API_URL) return process.env.AGENTA_API_URL
    try {
        const u = new URL(webURL)
        return `${u.origin}/api`
    } catch {
        return `${webURL}/api`
    }
}

async function globalSetup() {
    // Automate authentication before Playwright tests
    console.log("[global-setup] Starting global setup for authentication")

    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost:3000"
    const license = process.env.AGENTA_LICENSE || "oss"
    const storageState = "state.json"
    console.log(`[global-setup] Base URL: ${baseURL}, License: ${license}`)
    const timeout = 60000
    const inputDelay = 100
    const hasTestmailConfig = Boolean(
        process.env.TESTMAIL_API_KEY && process.env.TESTMAIL_NAMESPACE,
    )
    const testmail = hasTestmailConfig ? getTestmailClient() : null
    const generatedEmail = testmail
        ? testmail.generateTestEmail({
              scope: license,
              branch: process.env.BRANCH_NAME,
          })
        : `e2e.${license}.${Date.now()}@inbox.testmail.app`

    console.log("[global-setup] Launching browser")
    const browser = await chromium.launch()
    const page = await browser.newPage()

    console.log(`[global-setup] Navigating to auth page: ${baseURL}/auth`)
    await page.goto(`${baseURL}/auth`, {timeout})

    console.log("[global-setup] Clearing local storage")

    // @ts-ignore
    await page.evaluate(() => window.localStorage.clear())

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
        const redirected = page.waitForURL((url) => !url.pathname.endsWith("/post-signup"), {
            timeout: 15000,
        })
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

    // OSS owner credentials support both new and legacy env var names
    const ossOwnerEmail = process.env.AGENTA_TEST_OSS_OWNER_EMAIL || process.env.AGENTA_ADMIN_EMAIL
    const ossOwnerPassword =
        process.env.AGENTA_TEST_OSS_OWNER_PASSWORD || process.env.AGENTA_ADMIN_PASSWORD
    const loginEmail = license === "oss" ? ossOwnerEmail || generatedEmail : generatedEmail

    const ensureAuthEntryPoint = async (): Promise<boolean> => {
        const emailInput = page.locator('input[type="email"]').first()
        const hasEmailInput = await emailInput
            .waitFor({state: "visible", timeout: 10000})
            .then(() => true)
            .catch(() => false)

        if (hasEmailInput) {
            return true
        }

        const isAlreadyAuthenticated = !new URL(page.url()).pathname.includes("/auth")
        if (isAlreadyAuthenticated) {
            console.log("[global-setup] Already authenticated, skipping auth form flow")
            return true
        }

        // Fallback: auth page may transiently render without inputs; force a reload once.
        await page.goto(`${baseURL}/auth`, {timeout, waitUntil: "domcontentloaded"})
        const hasEmailInputAfterReload = await emailInput
            .waitFor({state: "visible", timeout})
            .then(() => true)
            .catch(() => false)

        if (hasEmailInputAfterReload) {
            return true
        }

        if (existsSync(storageState)) {
            console.warn(
                "[global-setup] Auth UI unavailable; reusing existing state.json from previous run",
            )
            return false
        }

        throw new Error("Auth UI unavailable: email input not visible on /auth")
    }

    const canRunAuthFlow = await ensureAuthEntryPoint()

    if (!canRunAuthFlow) {
        console.log(
            "[global-setup] Reusing cached state.json and creating ephemeral project with stored auth",
        )
        const cachedContext = await browser.newContext({storageState})
        const cachedPage = await cachedContext.newPage()

        await cachedPage.goto(`${baseURL}/apps`, {timeout, waitUntil: "domcontentloaded"})
        await maybeCreateEphemeralProject(cachedPage, baseURL)

        await cachedContext.close()
        await browser.close()
        return
    }

    if (!new URL(page.url()).pathname.includes("/auth")) {
        await page.context().storageState({path: storageState as string})
        // Create ephemeral project even when already authenticated
        await maybeCreateEphemeralProject(page, baseURL)
        await browser.close()
        return
    }

    console.log(`[global-setup] Typing email: ${loginEmail}`)
    await typeWithDelay(page, 'input[type="email"]', loginEmail)

    // Detect which auth flow the page shows
    const signinButton = page.getByRole("button", {name: "Sign in"})
    const hasSigninButton = await signinButton.isVisible()

    try {
        if (hasSigninButton) {
            // Password sign-in flow (OSS with pre-created admin account)
            if (!ossOwnerEmail) {
                throw new Error(
                    "AGENTA_TEST_OSS_OWNER_EMAIL (or AGENTA_ADMIN_EMAIL) is required for OSS password sign-in flow",
                )
            }
            const password = ossOwnerPassword
            if (!password) {
                throw new Error(
                    "AGENTA_TEST_OSS_OWNER_PASSWORD (or AGENTA_ADMIN_PASSWORD) is required for the password sign-in flow",
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

            // Detect whichever flow the rendered frontend exposes.
            await Promise.race([
                verifyEmailLocator.waitFor({state: "visible", timeout}),
                passwordInput.waitFor({state: "visible", timeout}),
            ])

            const isPasswordFlow = await passwordInput.isVisible()
            if (isPasswordFlow) {
                // Email + password signup/signin flow (local EE with SuperTokens)
                console.log("[global-setup] Email + password flow detected")
                const testPassword = ossOwnerPassword || "TestPass123!"
                await typeWithDelay(page, "input[type='password']", testPassword)
                try {
                    await clickButton(page, "Continue with password")
                } catch {
                    // Occasionally a transient Next.js portal overlays the button.
                    // Submit the form via Enter as a robust fallback.
                    await page.keyboard.press("Enter")
                }

                await handlePostSignup()

                // Wait for the page to settle on an authenticated URL
                console.log("[global-setup] Waiting for authenticated page")
                await page.waitForURL(
                    (url) =>
                        !url.pathname.includes("/auth") && !url.pathname.endsWith("/post-signup"),
                    {timeout, waitUntil: "domcontentloaded"},
                )
                console.log(`[global-setup] Settled on: ${page.url()}`)
            } else {
                // OTP flow (cloud EE with SuperTokens passwordless)
                if (!testmail) {
                    throw new Error(
                        "TESTMAIL_API_KEY and TESTMAIL_NAMESPACE are required for OTP auth flow",
                    )
                }
                console.log("[global-setup] OTP flow detected")
                console.log("[global-setup] Waiting for OTP email")
                const otp = await testmail.waitForOTP(loginEmail, {
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
        await maybeCreateEphemeralProject(page, baseURL)
        await browser.close()
    }
}

/**
 * Creates an ephemeral project for the test run when AGENTA_TEST_EPHEMERAL_PROJECT is enabled.
 * Uses the already-authenticated page context (cookies) to call the projects API.
 * Sets make_default=true so all test navigation to /apps auto-redirects to this project.
 * Saves project metadata to test-project.json for teardown to clean up.
 */
async function maybeCreateEphemeralProject(page: any, baseURL: string): Promise<void> {
    const ephemeralEnabled =
        String(process.env.AGENTA_TEST_EPHEMERAL_PROJECT ?? "true").toLowerCase() !== "false"

    if (!ephemeralEnabled) {
        console.log(
            "[global-setup] Ephemeral project disabled (AGENTA_TEST_EPHEMERAL_PROJECT=false)",
        )
        return
    }

    console.log("[global-setup] Creating ephemeral project for test isolation...")

    try {
        const apiURL = getApiURL(baseURL)

        // Find the current default project so we can restore it during teardown
        const projectsResponse = await page.request.get(`${apiURL}/projects/`)
        let originalDefaultProjectId: string | null = null

        if (projectsResponse.ok()) {
            const projects = await projectsResponse.json()
            const defaultProject = projects.find((p: any) => p.is_default_project)
            if (defaultProject) {
                originalDefaultProjectId = defaultProject.project_id
                console.log(
                    `[global-setup] Original default project: ${defaultProject.project_name} (${originalDefaultProjectId})`,
                )
            }
        }

        // Create the ephemeral project
        const projectName = `e2e-${Date.now()}`
        const response = await page.request.post(`${apiURL}/projects/`, {
            data: {name: projectName, make_default: true},
        })

        if (!response.ok()) {
            const text = await response.text()
            console.warn(
                `[global-setup] Failed to create ephemeral project (${response.status()}): ${text}`,
            )
            return
        }

        const project = await response.json()
        console.log(
            `[global-setup] Created ephemeral project: ${projectName} (${project.project_id})`,
        )

        // Save project metadata for teardown (including original default for restore)
        writeFileSync(
            "test-project.json",
            JSON.stringify(
                {
                    project_id: project.project_id,
                    project_name: project.project_name,
                    workspace_id: project.workspace_id,
                    original_default_project_id: originalDefaultProjectId,
                    created_at: new Date().toISOString(),
                },
                null,
                2,
            ),
        )
    } catch (error) {
        console.warn("[global-setup] Failed to create ephemeral project, using default:", error)
    }
}

export default globalSetup
