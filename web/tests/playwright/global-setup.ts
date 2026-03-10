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
import {getTestmailClient} from "../utils/testmail"
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

function getOptionalTestmailClient(): TestmailClient | null {
    try {
        return getTestmailClient()
    } catch {
        return null
    }
}

function createFallbackEmail(scope: string): string {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    return `${scope}-${suffix}@test.agenta.ai`
}

function createTestEmail(scope: string, testmail: TestmailClient | null): string {
    if (!testmail) {
        return createFallbackEmail(scope)
    }

    return testmail.generateTestEmail({
        scope,
        branch: process.env.BRANCH_NAME,
    })
}

function isTestmailInboxEmail(email: string, namespace?: string): boolean {
    if (!email.endsWith("@inbox.testmail.app")) {
        return false
    }

    if (!namespace) {
        return true
    }

    return email.startsWith(`${namespace}.`)
}

function getOssOwnerEmail({
    authMode,
    testmail,
}: {
    authMode: AuthMode
    testmail: TestmailClient | null
}): string {
    const configuredEmail = process.env.AGENTA_TEST_OSS_OWNER_EMAIL?.trim().toLowerCase()
    const namespace = process.env.TESTMAIL_NAMESPACE

    if (configuredEmail) {
        if (authMode !== "otp" || isTestmailInboxEmail(configuredEmail, namespace)) {
            return configuredEmail
        }

        console.warn(
            "[global-setup] AGENTA_TEST_OSS_OWNER_EMAIL is not a Testmail inbox; generating an OTP-capable OSS owner email instead",
        )
    }

    return createTestEmail("oss-owner", testmail)
}

async function fillOTPDigits(page: Page, otp: string, delay: number): Promise<void> {
    const digits = otp.split("")
    for (let i = 0; i < digits.length; i += 1) {
        await typeWithDelay(page, `[aria-label='OTP Input ${i + 1}']`, digits[i], delay)
    }
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
    const timestamp = Date.now()
    const namespace = process.env.TESTMAIL_NAMESPACE

    console.log(`[global-setup] Navigating to auth entry: ${entryUrl}`)
    await page.goto(entryUrl, {timeout, waitUntil: "domcontentloaded"})

    const emailInput = page.locator('input[type="email"]').first()
    await emailInput.waitFor({state: "visible", timeout})

    const emailInputIsEditable = await emailInput.isEditable().catch(() => false)
    if (emailInputIsEditable) {
        await typeWithDelay(page, 'input[type="email"]', email)

        const continueWithEmail = page.getByRole("button", {name: "Continue with email"})
        const continueButton = page.getByRole("button", {name: "Continue", exact: true})

        if (await continueWithEmail.isVisible().catch(() => false)) {
            await continueWithEmail.click()
        } else if (await continueButton.isVisible().catch(() => false)) {
            await continueButton.click()
        }
    }

    const verifyEmailLocator = page.getByText("Verify your email")
    const passwordInput = page.locator("input[type='password']").first()

    if (authMode === "password") {
        await passwordInput.waitFor({state: "visible", timeout})
    } else if (authMode === "otp") {
        await verifyEmailLocator.waitFor({state: "visible", timeout})
    } else {
        await Promise.race([
            verifyEmailLocator.waitFor({state: "visible", timeout}),
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

    if (authMode === "password") {
        throw new Error("AGENTA_TEST_AUTH_MODE=password requested but OTP flow was rendered")
    }

    if (!testmail) {
        throw new Error(
            "OTP auth was rendered, but TESTMAIL_API_KEY and TESTMAIL_NAMESPACE are not configured",
        )
    }

    if (!isTestmailInboxEmail(email, namespace)) {
        throw new Error(`OTP auth requires a Testmail inbox email, got '${email}'`)
    }

    console.log("[global-setup] OTP flow detected")
    const otp = await testmail.waitForOTP(email, {
        timeout,
        timestamp_from: timestamp,
    })
    const responsePromise = waitForApiResponse<AuthResponse>(page, {
        route: "/api/auth/signinup/code/consume",
        validateStatus: true,
    })

    await fillOTPDigits(page, otp, inputDelay)
    await clickButton(page, "Next")
    const responseData = await responsePromise

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
    const authModeRaw = (process.env.AGENTA_TEST_AUTH_MODE || "auto").toLowerCase()
    if (!["auto", "password", "otp"].includes(authModeRaw)) {
        throw new Error(
            `Invalid AGENTA_TEST_AUTH_MODE='${authModeRaw}'. Supported values: auto, password, otp`,
        )
    }
    const authMode = authModeRaw as AuthMode
    console.log(`[global-setup] Auth mode: ${authMode}`)

    const testmail = getOptionalTestmailClient()
    if (authMode === "otp" && !testmail) {
        throw new Error(
            "AGENTA_TEST_AUTH_MODE=otp requires TESTMAIL_API_KEY and TESTMAIL_NAMESPACE",
        )
    }

    const ownerEmail = getOssOwnerEmail({authMode, testmail})
    const userEmail = createTestEmail(`${license}-user`, testmail)
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
