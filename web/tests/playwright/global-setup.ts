import {chromium, type BrowserContext, type Page} from "@playwright/test"
import {existsSync, mkdirSync, writeFileSync} from "fs"
import {dirname} from "path"

import {waitForApiResponse} from "../tests/fixtures/base.fixture/apiHelpers"
import {
    clickButton,
    selectOption,
    typeWithDelay,
} from "../tests/fixtures/base.fixture/uiHelpers/helpers"
import {AuthResponse} from "../tests/fixtures/user.fixture/authHelpers/types"
import {generateRuntimeTestEmail, getTestmailClient, isTestmailInboxEmail} from "../utils/testmail"
import {
    getChromiumLaunchOptions,
    getProjectMetadataPath,
    getStorageStatePath,
} from "./config/runtime"

type AuthMode = "auto" | "password" | "otp"
type TestmailClient = ReturnType<typeof getTestmailClient>

function getApiURL(webURL: string): string {
    if (process.env.AGENTA_API_URL) return process.env.AGENTA_API_URL
    try {
        const u = new URL(webURL)
        return `${u.origin}/api`
    } catch {
        return `${webURL}/api`
    }
}

function createTestEmail(scope: string): string {
    return generateRuntimeTestEmail({
        scope,
        branch: process.env.BRANCH_NAME,
    })
}

function getOssOwnerEmail({testmail}: {testmail: TestmailClient | null}): string {
    const configuredEmail = process.env.AGENTA_TEST_OSS_OWNER_EMAIL?.trim().toLowerCase()
    const namespace = process.env.TESTMAIL_NAMESPACE

    if (configuredEmail) {
        if (!testmail || isTestmailInboxEmail(configuredEmail, namespace)) {
            return configuredEmail
        }

        console.warn(
            "[global-setup] AGENTA_TEST_OSS_OWNER_EMAIL is not a Testmail inbox; falling back to a generated inbox address",
        )
    }

    return createTestEmail("oss-owner")
}

async function fillOTPDigits(page: Page, otp: string, delay: number): Promise<void> {
    // Ant Design 5.x Input.OTP renders: <div class="ant-otp"><input class="ant-otp-input"/>...</div>
    // Click the first cell to ensure focus (autoFocus may have been lost), then type sequentially.
    const firstInput = page.locator(".ant-otp input").first()
    await firstInput.waitFor({state: "visible", timeout: 10000})
    await firstInput.click()
    await page.keyboard.type(otp, {delay})
}

async function handlePostSignup(page: Page): Promise<void> {
    try {
        await page.waitForURL("**/post-signup", {
            waitUntil: "domcontentloaded",
            timeout: 10000,
        })
    } catch {
        console.log("[global-setup] No post-signup redirect detected, continuing")
        return
    }

    console.log("[global-setup] New user detected, on post-signup page")

    const tellUsAboutYourselfLocator = page.getByText("Tell us about yourself")
    const redirected = page.waitForURL((url) => !url.pathname.endsWith("/post-signup"), {
        timeout: 15000,
        waitUntil: "domcontentloaded",
    })
    const surveyLoaded = tellUsAboutYourselfLocator
        .waitFor({state: "visible", timeout: 15000})
        .then(() => "survey" as const)

    const result = await Promise.race([surveyLoaded, redirected.then(() => "redirected" as const)])

    if (result === "redirected") {
        console.log("[global-setup] Post-signup redirected (no PostHog survey), continuing")
        return
    }

    const isOptionVisible = await page.getByRole("option", {name: "Hobbyist"}).isVisible()
    if (!isOptionVisible) {
        console.log("[global-setup] Post-signup flow not completed due to missing options")
        return
    }

    await selectOption(page, {text: "2-10"})
    await selectOption(page, {text: "Hobbyist"})
    await selectOption(page, {text: "Just exploring"})
    await clickButton(page, "Continue")

    await page.getByText("What brings you here?").waitFor({state: "visible"})

    await selectOption(page, {text: "Evaluating LLM Applications"})
    await selectOption(page, {text: "Github"})
    await clickButton(page, "Continue")
}

async function waitForSettledAuthenticatedPage(page: Page, timeout: number): Promise<void> {
    await page.waitForURL(
        (url) => !url.pathname.includes("/auth") && !url.pathname.endsWith("/post-signup"),
        {timeout, waitUntil: "domcontentloaded"},
    )

    if (new URL(page.url()).pathname.startsWith("/workspaces/accept")) {
        await page
            .waitForURL((url) => !url.pathname.startsWith("/workspaces/accept"), {
                timeout,
                waitUntil: "domcontentloaded",
            })
            .catch(() => {})
    }

    console.log(`[global-setup] Settled on: ${page.url()}`)
}

async function authenticateUser({
    page,
    entryUrl,
    email,
    password,
    authMode,
    timeout,
    inputDelay,
    testmail,
}: {
    page: Page
    entryUrl: string
    email: string
    password: string
    authMode: AuthMode
    timeout: number
    inputDelay: number
    testmail: TestmailClient | null
}): Promise<void> {
    let otpRequestedAt = Date.now()
    const namespace = process.env.TESTMAIL_NAMESPACE

    console.log(`[global-setup] Navigating to auth entry: ${entryUrl}`)
    await page.goto(entryUrl, {timeout, waitUntil: "domcontentloaded"})

    console.log("[global-setup] Clearing browser auth state")
    await page.evaluate(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
    })

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.waitFor({state: "visible", timeout})

    const emailInputIsEditable = await emailInput.isEditable().catch(() => false)
    if (emailInputIsEditable) {
        await typeWithDelay(page, 'input[type="email"]', email)

        const continueWithEmail = page.getByRole("button", {name: "Continue with email"})
        const continueWithOtp = page.getByRole("button", {name: "Continue with OTP"})
        const continueButton = page.getByRole("button", {name: "Continue", exact: true})

        // Wait for and intercept the discovery API call when clicking Continue
        const discoveryTimeout = new Promise((resolve) => setTimeout(resolve, 15000))
        const discoveryPromise = Promise.race([
            waitForApiResponse(page, {
                route: /\/api\/auth\/discover(?:\?|$)/,
                validateStatus: false,
            }).catch(() => null),
            discoveryTimeout,
        ])

        if (await continueWithEmail.isVisible().catch(() => false)) {
            await continueWithEmail.click()
        } else if (await continueWithOtp.isVisible().catch(() => false)) {
            await continueWithOtp.click()
        } else if (await continueButton.isVisible().catch(() => false)) {
            await continueButton.click()
        }

        // Wait for discovery to complete so the auth method UI is fully rendered
        console.log("[global-setup] Waiting for auth discovery to complete")
        await discoveryPromise
        console.log("[global-setup] Auth discovery completed")
    }

    const verifyEmailLocator = page.getByText("Verify your email")
    const continueWithOtpButton = page.getByRole("button", {name: "Continue with OTP"})
    const resendOtpLink = page.getByText("Resend one-time password")
    const passwordInput = page.locator("input[type='password']").first()

    if (authMode === "password") {
        await passwordInput.waitFor({state: "visible", timeout})
    } else if (authMode === "otp") {
        console.log("[global-setup] Waiting for OTP flow controls")
        await Promise.race([
            verifyEmailLocator.waitFor({state: "visible", timeout}),
            continueWithOtpButton.waitFor({state: "visible", timeout}),
            resendOtpLink.waitFor({state: "visible", timeout}),
        ])
    } else {
        console.log("[global-setup] Auto-detecting password vs OTP flow")
        await Promise.race([
            verifyEmailLocator.waitFor({state: "visible", timeout}),
            continueWithOtpButton.waitFor({state: "visible", timeout}),
            resendOtpLink.waitFor({state: "visible", timeout}),
            passwordInput.waitFor({state: "visible", timeout}),
        ])
    }

    if (await passwordInput.isVisible().catch(() => false)) {
        console.log("[global-setup] Email + password flow detected")
        await typeWithDelay(page, "input[type='password']", password)
        try {
            await clickButton(page, "Continue with password")
        } catch {
            await page.keyboard.press("Enter")
        }

        await handlePostSignup(page)
        await waitForSettledAuthenticatedPage(page, timeout)
        return
    }

    const otpAlreadyRequested = await resendOtpLink.isVisible().catch(() => false)
    const canSendOtp =
        (await continueWithOtpButton.isVisible().catch(() => false)) ||
        (await continueWithOtpButton
            .waitFor({state: "visible", timeout: 5000})
            .then(() => true)
            .catch(() => false))

    if (!otpAlreadyRequested && canSendOtp) {
        console.log("[global-setup] Sending OTP email")

        // Turnstile may block the form submission until its token arrives.
        // Depending on the site key, Turnstile can be:
        //   - invisible/auto: solves automatically, just needs time to load
        //   - managed/visible: shows a checkbox the user must click
        //   - interactive: shows a full challenge
        // We handle all modes by:
        //   1. Trying to click the Turnstile iframe checkbox (for visible challenges)
        //   2. Retrying "Continue with OTP" until the createCode API fires
        const MAX_OTP_SEND_ATTEMPTS = 15
        const OTP_SEND_RETRY_DELAY = 3000
        let otpSent = false
        let turnstileSolved = false

        for (let attempt = 1; attempt <= MAX_OTP_SEND_ATTEMPTS; attempt++) {
            otpRequestedAt = Date.now()

            // Try to solve Turnstile challenge if a visible widget is present.
            // The Turnstile iframe src follows the pattern:
            //   https://challenges.cloudflare.com/cdn-cgi/challenge-platform/.../turnstile/...
            // We try a direct CSS selector first, then fall back to page.frames().
            if (!turnstileSolved) {
                try {
                    // Approach 1: Direct CSS selector for the Turnstile iframe
                    const turnstileIframe = page
                        .locator(
                            'iframe[src*="challenges.cloudflare.com/cdn-cgi/challenge-platform"]',
                        )
                        .first()
                    if (await turnstileIframe.isVisible().catch(() => false)) {
                        console.log(
                            `[global-setup] Turnstile iframe found via CSS selector (attempt ${attempt})`,
                        )
                        await turnstileIframe.click()
                        await page.waitForTimeout(2000)
                        turnstileSolved = true
                    } else {
                        // Approach 2: Enumerate page.frames() for Cloudflare URLs
                        const frames = page.frames()
                        const turnstileFrame = frames.find(
                            (f) =>
                                f !== page.mainFrame() &&
                                /cloudflare|turnstile|challenges/i.test(f.url()),
                        )
                        if (turnstileFrame) {
                            console.log(
                                `[global-setup] Found Turnstile frame via page.frames(): ${turnstileFrame.url()} (attempt ${attempt})`,
                            )
                            const body = turnstileFrame.locator("body")
                            await body.click({timeout: 3000})
                            await page.waitForTimeout(2000)
                            turnstileSolved = true
                        } else if (attempt <= 3) {
                            // Approach 3: Click any visible iframe (auth page only has Turnstile)
                            const iframes = page.locator("iframe")
                            const iframeCount = await iframes.count()
                            if (iframeCount > 0) {
                                for (let i = 0; i < iframeCount; i++) {
                                    const iframe = iframes.nth(i)
                                    if (await iframe.isVisible().catch(() => false)) {
                                        const src = await iframe
                                            .getAttribute("src")
                                            .catch(() => "unknown")
                                        console.log(
                                            `[global-setup] Clicking iframe[${i}] src=${src} (attempt ${attempt})`,
                                        )
                                        await iframe.click().catch(() => {})
                                        await page.waitForTimeout(2000)
                                        turnstileSolved = true
                                        break
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.log(`[global-setup] Turnstile interaction failed: ${e}`)
                }
            }

            // Set up a short-lived listener for the createCode response
            const createCodeRace = Promise.race([
                page
                    .waitForResponse((response) => {
                        const url = response.url()
                        return (
                            /\/api\/auth\/signinup\/code(?:\?|$)/.test(url) &&
                            response.request().method() === "POST"
                        )
                    })
                    .then((r) => ({fired: true as const, response: r})),
                new Promise<{fired: false}>((resolve) =>
                    setTimeout(() => resolve({fired: false}), OTP_SEND_RETRY_DELAY),
                ),
            ])

            await continueWithOtpButton.click()
            const result = await createCodeRace

            if (result.fired) {
                console.log(`[global-setup] createCode API responded on attempt ${attempt}`)
                otpSent = true
                break
            }

            // Check if a "security check" error appeared (Turnstile not ready yet)
            const securityCheckError = page.getByText("Please complete the security check")
            if (await securityCheckError.isVisible().catch(() => false)) {
                console.log(
                    `[global-setup] Turnstile not ready yet (attempt ${attempt}/${MAX_OTP_SEND_ATTEMPTS}), retrying...`,
                )
                // Reset solved flag — maybe the click didn't actually produce a token
                turnstileSolved = false
            } else {
                console.log(
                    `[global-setup] createCode did not fire on attempt ${attempt}, retrying...`,
                )
            }
        }

        if (!otpSent) {
            throw new Error(
                "Failed to send OTP: createCode API never fired after " +
                    MAX_OTP_SEND_ATTEMPTS +
                    " attempts. Turnstile may not have solved.",
            )
        }

        await resendOtpLink.waitFor({state: "visible", timeout})
    }

    if (authMode === "password") {
        throw new Error("Password auth was forced but OTP flow was rendered")
    }

    if (!testmail) {
        throw new Error(
            "OTP auth was rendered, but TESTMAIL_API_KEY and TESTMAIL_NAMESPACE are not configured",
        )
    }

    if (!isTestmailInboxEmail(email, namespace)) {
        throw new Error(`OTP auth requires a Testmail inbox email, got '${email}'`)
    }

    if (await resendOtpLink.isVisible().catch(() => false)) {
        console.log("[global-setup] OTP entry screen already active, requesting a fresh OTP email")
        otpRequestedAt = Date.now()
        const resendCodeResponsePromise = waitForApiResponse(page, {
            route: /\/api\/auth\/signinup\/code\/resend(?:\?|$)/,
            validateStatus: true,
        })
        await resendOtpLink.click()
        await resendCodeResponsePromise
    }

    console.log("[global-setup] OTP flow detected")
    console.log(`[global-setup] Waiting for OTP email for ${email}`)
    const otp = await testmail.waitForOTP(email, {
        timeout,
        timestamp_from: otpRequestedAt,
    })
    console.log("[global-setup] OTP email received")
    const responsePromise = waitForApiResponse<AuthResponse>(page, {
        route: "/api/auth/signinup/code/consume",
        validateStatus: true,
    })

    console.log("[global-setup] Filling OTP input")
    await fillOTPDigits(page, otp, inputDelay)
    console.log("[global-setup] Submitting OTP")
    await clickButton(page, "Continue with OTP")
    const responseData = await responsePromise
    console.log("[global-setup] OTP submit response received")

    if (responseData.createdNewRecipeUser) {
        await handlePostSignup(page)
    }

    await waitForSettledAuthenticatedPage(page, timeout)
}

async function inviteOssUser({
    page,
    apiURL,
    baseURL,
    email,
}: {
    page: Page
    apiURL: string
    baseURL: string
    email: string
}): Promise<string> {
    const projectsResponse = await page.request.get(`${apiURL}/projects/`)
    if (!projectsResponse.ok()) {
        throw new Error(
            `[global-setup] Failed to fetch OSS projects for invite bootstrap (${projectsResponse.status()}): ${await projectsResponse.text()}`,
        )
    }

    const projects = (await projectsResponse.json()) as Array<{
        organization_id?: string
        workspace_id?: string
        project_id?: string
        is_default_project?: boolean
    }>

    const project = projects.find((candidate) => candidate.is_default_project) ?? projects[0]
    if (!project?.organization_id || !project.workspace_id || !project.project_id) {
        throw new Error("[global-setup] Could not derive OSS organization/workspace/project ids")
    }

    const inviteResponse = await page.request.post(
        `${apiURL}/organizations/${project.organization_id}/workspaces/${project.workspace_id}/invite?project_id=${project.project_id}`,
        {
            data: [{email}],
        },
    )

    if (!inviteResponse.ok()) {
        throw new Error(
            `[global-setup] Failed to invite OSS test user (${inviteResponse.status()}): ${await inviteResponse.text()}`,
        )
    }

    const invitePayload = (await inviteResponse.json()) as {url?: string}
    if (!invitePayload.url) {
        throw new Error("[global-setup] OSS invite response did not include an invite URL")
    }

    return new URL(invitePayload.url, baseURL).toString()
}

async function globalSetup() {
    console.log("[global-setup] Starting global setup for authentication")

    const baseURL = process.env.AGENTA_WEB_URL || "http://localhost:3000"
    const apiURL = getApiURL(baseURL)
    const license = process.env.AGENTA_LICENSE || "oss"
    const storageState = getStorageStatePath()
    console.log(`[global-setup] Base URL: ${baseURL}, License: ${license}`)

    const timeout = 60000
    const inputDelay = 100
    const authMode: AuthMode = "auto"
    const hasTestmailConfig = Boolean(
        process.env.TESTMAIL_API_KEY && process.env.TESTMAIL_NAMESPACE,
    )
    const testmail = hasTestmailConfig ? getTestmailClient() : null
    const ownerEmail = getOssOwnerEmail({testmail})
    const userEmail = createTestEmail(`${license}-user`)
    const ownerPassword =
        process.env.AGENTA_TEST_OSS_OWNER_PASSWORD ||
        process.env.AGENTA_ADMIN_PASSWORD ||
        process.env.AGENTA_TEST_PASSWORD ||
        "TestPass123!"
    const userPassword = process.env.AGENTA_TEST_PASSWORD || ownerPassword

    console.log("[global-setup] Launching browser")
    const browser = await chromium.launch(getChromiumLaunchOptions())
    let authenticatedContext: BrowserContext | null = null
    let authenticatedPage: Page | null = null

    try {
        if (license === "oss") {
            let ownerContext: BrowserContext | null = null

            try {
                ownerContext = await browser.newContext()
                const ownerPage = await ownerContext.newPage()

                console.log(`[global-setup] Authenticating OSS owner: ${ownerEmail}`)
                await authenticateUser({
                    page: ownerPage,
                    entryUrl: `${baseURL}/auth`,
                    email: ownerEmail,
                    password: ownerPassword,
                    authMode,
                    timeout,
                    inputDelay,
                    testmail,
                })

                console.log(`[global-setup] Inviting OSS test user: ${userEmail}`)
                const inviteUrl = await inviteOssUser({
                    page: ownerPage,
                    apiURL,
                    baseURL,
                    email: userEmail,
                })

                authenticatedContext = await browser.newContext()
                authenticatedPage = await authenticatedContext.newPage()

                console.log(`[global-setup] Authenticating invited OSS user: ${userEmail}`)
                await authenticateUser({
                    page: authenticatedPage,
                    entryUrl: inviteUrl,
                    email: userEmail,
                    password: userPassword,
                    authMode,
                    timeout,
                    inputDelay,
                    testmail,
                })
            } finally {
                await ownerContext?.close()
            }
        } else {
            authenticatedContext = await browser.newContext()
            authenticatedPage = await authenticatedContext.newPage()

            console.log(`[global-setup] Authenticating EE user: ${userEmail}`)
            await authenticateUser({
                page: authenticatedPage,
                entryUrl: `${baseURL}/auth`,
                email: userEmail,
                password: userPassword,
                authMode,
                timeout,
                inputDelay,
                testmail,
            })
        }

        mkdirSync(dirname(storageState), {recursive: true})
        await authenticatedPage.context().storageState({path: storageState})
        await maybeCreateEphemeralProject(authenticatedPage, baseURL)
    } catch (error) {
        if (existsSync(storageState)) {
            console.warn(
                "[global-setup] Auth bootstrap failed, reusing existing storage state for this license",
            )
            const cachedContext = await browser.newContext({storageState})
            const cachedPage = await cachedContext.newPage()
            await cachedPage.goto(`${baseURL}/apps`, {timeout, waitUntil: "domcontentloaded"})
            await maybeCreateEphemeralProject(cachedPage, baseURL)
            await cachedContext.close()
            return
        }

        console.error("[global-setup] Error in login flow:", error)
        throw error
    } finally {
        await authenticatedContext?.close()
        await browser.close()
    }
}

async function maybeCreateEphemeralProject(page: Page, baseURL: string): Promise<void> {
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
        const projectMetadataPath = getProjectMetadataPath()

        const projectsResponse = await page.request.get(`${apiURL}/projects/`)
        let originalDefaultProjectId: string | null = null

        if (projectsResponse.ok()) {
            const projects = await projectsResponse.json()
            const defaultProject = projects.find((project: any) => project.is_default_project)
            if (defaultProject) {
                originalDefaultProjectId = defaultProject.project_id
                console.log(
                    `[global-setup] Original default project: ${defaultProject.project_name} (${originalDefaultProjectId})`,
                )
            }
        }

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

        mkdirSync(dirname(projectMetadataPath), {recursive: true})
        writeFileSync(
            projectMetadataPath,
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
