import {existsSync, readFileSync} from "fs"

import {expect, Locator, Page, Response} from "@playwright/test"

import {EvaluationRun} from "../../../../../oss/src/lib/hooks/usePreviewEvaluations/types"
import {SnakeToCamelCaseKeys, testset} from "../../../../../oss/src/lib/Types"
import {getProjectMetadataPath} from "../../../../playwright/config/runtime.ts"
import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import type {ApiHandlerOptions, ApiHelpers, CreateTestsetInput, CreatedTestset} from "./types"

type APP_TYPE = "completion" | "chat" | "custom"

interface ListAppsItem {
    id: string
    name: string
    app_type: APP_TYPE
    flags: {
        is_chat?: boolean
        is_custom?: boolean
        is_application?: boolean
        is_evaluator?: boolean
    } | null
    created_at: string | null
    [key: string]: any
}

interface ApiVariant {
    id: string
    name: string | null
    slug: string | null
    workflow_id: string | null
    artifact_id: string | null
    flags: {
        is_chat?: boolean
        is_custom?: boolean
        is_application?: boolean
        is_evaluator?: boolean
    } | null
    created_at: string | null
    updated_at: string | null
}

const APP_TYPE_LABELS: Record<APP_TYPE, string> = {
    completion: "Completion",
    chat: "Chat",
    custom: "Custom Prompt",
}

const latestRevisionIdByAppId = new Map<string, string>()

interface TestProjectMetadata {
    project_id?: string
    workspace_id?: string
}

interface SimpleTestsetApiResponse {
    count: number
    testset?: {
        id?: string
        name?: string
        revision_id?: string
    }
}

export const getKnownLatestRevisionId = (appId: string): string | null => {
    return latestRevisionIdByAppId.get(appId) ?? null
}

const readTestProjectMetadata = (): TestProjectMetadata | null => {
    const metadataPath = getProjectMetadataPath()

    if (!existsSync(metadataPath)) {
        return null
    }

    try {
        return JSON.parse(readFileSync(metadataPath, "utf8")) as TestProjectMetadata
    } catch {
        return null
    }
}

export const getProjectScopedBasePath = (page: Page): string => {
    const currentUrl = page.url()
    if (currentUrl) {
        const pathname = new URL(currentUrl).pathname
        const match = pathname.match(/(\/w\/[^/]+\/p\/[^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const configuredUrl = process.env.AGENTA_WEB_URL
    if (configuredUrl) {
        const pathname = new URL(configuredUrl).pathname
        const match = pathname.match(/(\/w\/[^/]+\/p\/[^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const testProject = readTestProjectMetadata()
    if (testProject?.workspace_id && testProject?.project_id) {
        return `/w/${testProject.workspace_id}/p/${testProject.project_id}`
    }

    throw new Error(`Could not derive project scoped path from current URL: ${page.url()}`)
}

const getApiURL = (page: Page): string => {
    if (process.env.AGENTA_API_URL) {
        return process.env.AGENTA_API_URL
    }

    const currentUrl = page.url() || process.env.AGENTA_WEB_URL || "http://localhost:3000"
    const parsed = new URL(currentUrl)
    return `${parsed.origin}/api`
}

const getProjectId = (page: Page): string => {
    const currentUrl = page.url()
    if (currentUrl) {
        const pathname = new URL(currentUrl).pathname
        const match = pathname.match(/\/p\/([^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const configuredUrl = process.env.AGENTA_WEB_URL
    if (configuredUrl) {
        const pathname = new URL(configuredUrl).pathname
        const match = pathname.match(/\/p\/([^/]+)/)
        if (match?.[1]) {
            return match[1]
        }
    }

    const testProject = readTestProjectMetadata()
    if (testProject?.project_id) {
        return testProject.project_id
    }

    throw new Error(`Could not derive project ID from current URL: ${page.url()}`)
}

export const waitForApiResponse = async <T>(page: Page, options: ApiHandlerOptions<T>) => {
    const {route, method = "POST", validateStatus = true, responseHandler} = options

    const response = await page.waitForResponse((response) => {
        const url = response.url()
        return (
            (route instanceof RegExp ? route.test(url) : url.includes(route)) &&
            response.request().method() === method
        )
    })

    if (validateStatus) {
        expect(response.ok()).toBe(true)
    }

    // Safely attempt to parse JSON if available
    let data: any = null
    const text = await response.text()

    try {
        data = text ? JSON.parse(text) : null
    } catch (e) {
        // Could log or ignore if expected
        console.warn("Response is not valid JSON:", e)
    }

    if (responseHandler && data) {
        await responseHandler(data)
    }

    return data
}

const waitForMatchingResponses = async (
    page: Page,
    predicate: (response: Response) => boolean,
    count: number,
) => {
    return await new Promise<Response[]>((resolve) => {
        const matches: Response[] = []

        const handleResponse = (response: Response) => {
            if (!predicate(response)) return

            matches.push(response)
            if (matches.length >= count) {
                page.off("response", handleResponse)
                resolve(matches)
            }
        }

        page.on("response", handleResponse)
    })
}

const selectCreatePromptType = async (dialog: Locator, appTypeLabel: string) => {
    await expect(dialog.getByText("Choose the prompt type", {exact: true})).toBeVisible({
        timeout: 15000,
    })

    const appTypeCards = dialog.locator(".ant-card")
    await expect(appTypeCards.first()).toBeVisible({timeout: 15000})

    const matchingCards = appTypeCards.filter({hasText: new RegExp(appTypeLabel, "i")})
    await expect.poll(async () => await matchingCards.count(), {timeout: 15000}).toBeGreaterThan(0)

    const appTypeCard = matchingCards.first()
    await expect(appTypeCard).toBeVisible({timeout: 15000})

    const appTypeRadio = appTypeCard.locator('input[type="radio"]').first()
    const isSelected = async () => {
        if ((await appTypeRadio.count().catch(() => 0)) > 0) {
            return await appTypeRadio.isChecked().catch(() => false)
        }

        const checkedRadio = appTypeCard.locator(".ant-radio-checked").first()
        return await checkedRadio.isVisible().catch(() => false)
    }

    if (!(await isSelected())) {
        await appTypeCard.click()
    }

    await expect.poll(isSelected, {timeout: 15000}).toBe(true)
}

async function createApp(page: Page, type: APP_TYPE): Promise<ListAppsItem> {
    await page.goto(`${getProjectScopedBasePath(page)}/apps`, {waitUntil: "domcontentloaded"})
    await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})

    const appName = `e2e-${type}-${Date.now()}`
    const dialog = page.getByRole("dialog").last()
    const createEntryPoints = [
        page.getByRole("button", {name: "Create New Prompt"}).first(),
        page.getByRole("button", {name: /Click here to create your first prompt/i}).first(),
        page.getByText("Create a prompt", {exact: true}).first(),
    ]

    await expect
        .poll(
            async () => {
                for (const entryPoint of createEntryPoints) {
                    if (await entryPoint.isVisible().catch(() => false)) {
                        return true
                    }
                }

                return false
            },
            {timeout: 15000},
        )
        .toBe(true)

    let dialogVisible = false
    for (const entryPoint of createEntryPoints) {
        const entryPointVisible = await entryPoint.isVisible().catch(() => false)
        if (!entryPointVisible) {
            continue
        }

        await entryPoint.click()
        dialogVisible = await dialog.isVisible({timeout: 5000}).catch(() => false)
        if (dialogVisible) {
            break
        }
    }

    await expect(dialog).toBeVisible({timeout: 15000})
    let nameFilled = false
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const nameInput = dialog.getByRole("textbox", {name: "Enter a name"})
        await expect(nameInput).toBeVisible({timeout: 15000})

        try {
            await nameInput.fill(appName)
            nameFilled = true
            break
        } catch (error) {
            if (attempt === 2) {
                throw error
            }
        }
    }

    expect(nameFilled).toBe(true)

    const appTypeLabel = APP_TYPE_LABELS[type]
    if (!appTypeLabel) {
        throw new Error(`App creation is not implemented for app type '${type}'.`)
    }

    await selectCreatePromptType(dialog, appTypeLabel)

    // 1. POST /workflows/ — create the workflow
    const createWorkflowPromise = page.waitForResponse((response) => {
        if (
            !response.url().includes("/workflows") ||
            response.url().includes("/query") ||
            response.url().includes("/variants") ||
            response.url().includes("/revisions") ||
            response.request().method() !== "POST"
        ) {
            return false
        }
        const payload = response.request().postData() || ""
        return payload.includes(appName)
    })

    // 2. POST /workflows/variants/ — create the default variant
    const createVariantPromise = page.waitForResponse((response) => {
        return (
            response.url().includes("/workflows/variants") &&
            !response.url().includes("/query") &&
            response.request().method() === "POST"
        )
    })

    // 3/4. POST /workflows/revisions/commit — app creation commits twice:
    // seed revision (v0), then the configured revision (v1). Collect both responses
    // explicitly so the "latest revision" cache never resolves to the first commit.
    const revisionCommitsPromise = waitForMatchingResponses(
        page,
        (response) =>
            response.url().includes("/workflows/revisions/commit") &&
            response.request().method() === "POST",
        2,
    )

    const submitButton = dialog.getByRole("button", {
        name: "Create New Prompt",
    })
    await expect(submitButton).toBeVisible({timeout: 15000})
    await expect(submitButton).toBeEnabled({timeout: 15000})
    await submitButton.click()

    // Wait for workflow creation
    const workflowResponse = await createWorkflowPromise
    expect(workflowResponse.ok()).toBe(true)
    const createdApp = (await workflowResponse.json()) as {workflow: ListAppsItem}
    const createdWorkflow = createdApp.workflow
    expect(createdWorkflow.id).toBeTruthy()

    // Wait for variant creation
    const variantResponse = await createVariantPromise
    expect(variantResponse.ok()).toBe(true)
    const variantData = await variantResponse.json()
    expect(variantData.workflow_variant?.id).toBeTruthy()

    // Wait for both revision commits
    const [seedResponse, dataResponse] = await revisionCommitsPromise
    expect(seedResponse.ok()).toBe(true)
    expect(dataResponse.ok()).toBe(true)

    const revisionData = await dataResponse.json()
    const latestRevisionId = revisionData.workflow_revision?.id ?? null
    if (latestRevisionId) {
        latestRevisionIdByAppId.set(createdWorkflow.id, latestRevisionId)
    }

    return {
        ...createdWorkflow,
        app_type: type,
    } as ListAppsItem
}

export const getApp = async (page: Page, type: APP_TYPE = "completion") => {
    const appsResponse = waitForApiResponse<{workflows: ListAppsItem[]; count: number}>(page, {
        route: "/workflows/query",
        method: "POST",
    })

    await page.goto(`${getProjectScopedBasePath(page)}/apps`, {waitUntil: "domcontentloaded"})
    await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})

    const data = await appsResponse
    const apps = data.workflows ?? []

    expect(Array.isArray(apps)).toBe(true)

    const appMatchesType = (app: ListAppsItem) => {
        if (type === "chat") return !!app.flags?.is_chat
        if (type === "custom") return !!app.flags?.is_custom
        return !app.flags?.is_chat && !app.flags?.is_custom
    }

    let targetApp
    if (!apps.length) {
        targetApp = await createApp(page, type)
    } else if (type) {
        const app = apps.find(appMatchesType)
        if (!app) {
            targetApp = await createApp(page, type)
        } else {
            targetApp = app
        }
    } else {
        targetApp = apps[0]
    }
    const appId = targetApp.id

    if (!appId) {
        console.error("[App Fixture] App not found")
        throw new Error("App not found")
    }

    return targetApp
}

export const getAppById = async (page: Page, appId: string) => {
    const appsResponse = waitForApiResponse<{workflows: ListAppsItem[]; count: number}>(page, {
        route: "/workflows/query",
        method: "POST",
    })

    // Trigger the API call by going to apps page if not already there
    const currentUrl = page.url()
    if (!currentUrl.includes("/apps")) {
        await page.goto(`${getProjectScopedBasePath(page)}/apps`, {waitUntil: "domcontentloaded"})
        await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})
    }

    const data = await appsResponse
    const apps = data.workflows ?? []

    const app = apps.find((app) => app.id === appId)
    if (!app) {
        console.error(`[App Fixture] App not found with ID: ${appId}`)
        throw new Error(`App not found with ID: ${appId}`)
    }

    return app
}

export const getTestsets = async (page: Page) => {
    const testsetsResponse = waitForApiResponse<{testsets: testset[]}>(page, {
        route: "/api/testsets/query",
        method: "POST",
    })

    await page.goto(`${getProjectScopedBasePath(page)}/testsets`, {waitUntil: "domcontentloaded"})
    const response = await testsetsResponse
    const testsets = response.testsets
    expect(testsets.length).toBeGreaterThan(0)

    return testsets
}

export const createTestset = async (
    page: Page,
    {name, rows, description}: CreateTestsetInput,
): Promise<CreatedTestset> => {
    const projectId = getProjectId(page)
    const slugBase = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    const slug = `${slugBase || "e2e-testset"}-${Date.now()}`

    const apiUrl = `${getApiURL(page)}/simple/testsets/?project_id=${projectId}`

    let response = await page.request.post(apiUrl, {
        data: {
            testset: {
                slug,
                name,
                description,
                data: {
                    testcases: rows.map((row) => ({data: row})),
                },
            },
        },
    })

    // On first failure, wait briefly and retry once — handles transient 5xx/network errors.
    if (!response.ok()) {
        await page.waitForTimeout(2000)
        response = await page.request.post(apiUrl, {
            data: {
                testset: {
                    slug: `${slug}-r`,
                    name,
                    description,
                    data: {
                        testcases: rows.map((row) => ({data: row})),
                    },
                },
            },
        })
    }

    if (!response.ok()) {
        const body = await response.text().catch(() => "<unreadable>")
        throw new Error(
            `createTestset('${name}') failed: HTTP ${response.status()} ${response.statusText()}.\n` +
                `URL: ${apiUrl}\n` +
                `Response body: ${body}`,
        )
    }

    const data = (await response.json()) as SimpleTestsetApiResponse
    const testset = data.testset

    if (!testset?.id || !testset.name) {
        throw new Error(`Failed to create testset '${name}'. Response: ${JSON.stringify(data)}`)
    }

    const listQueryPayload = {
        testset: {
            name: testset.name,
        },
        windowing: {
            limit: 10,
            order: "descending" as const,
        },
    }
    const queryUrl = `${getApiURL(page)}/testsets/query?project_id=${projectId}`
    const timeoutAt = Date.now() + 15000
    let isVisibleInList = false

    while (Date.now() < timeoutAt) {
        const queryResponse = await page.request.post(queryUrl, {
            data: listQueryPayload,
        })
        expect(queryResponse.ok()).toBe(true)

        const queryData = (await queryResponse.json()) as {
            testsets?: {id?: string; name?: string}[]
        }
        isVisibleInList = (queryData.testsets ?? []).some(
            (item) => item.id === testset.id || item.name === testset.name,
        )

        if (isVisibleInList) {
            break
        }

        await page.waitForTimeout(500)
    }

    if (!isVisibleInList) {
        throw new Error(`Testset '${testset.name}' was created but never appeared in testsets list`)
    }

    return {
        id: testset.id,
        name: testset.name,
        revisionId: testset.revision_id,
    }
}

export const getVariants = async (page: Page, appId: string) => {
    await page.goto(`${getProjectScopedBasePath(page)}/apps`, {waitUntil: "domcontentloaded"})
    const overviewPath = `${getProjectScopedBasePath(page)}/apps/${appId}/overview`

    const variantsResponse = waitForApiResponse<{workflow_variants: ApiVariant[]; count: number}>(
        page,
        {
            route: `/workflows/variants/query`,
            method: "POST",
        },
    )

    await page.goto(overviewPath, {waitUntil: "domcontentloaded"})
    const data = await variantsResponse

    const variants = data.workflow_variants || []
    const variantsCount = data.count || 0
    expect(Array.isArray(variants)).toBe(true)
    expect(variantsCount).toBeGreaterThan(0)
    expect(variants.length).toBeGreaterThan(0)

    // Log the API response for debugging
    if (!variants.length) {
        console.error("[App Fixture] No variants found")
        throw new Error("No variants found")
    }

    console.log("[Playground E2E] Variants API response:", JSON.stringify(variants, null, 2))
    return variants
}

export const getEvaluationRuns = async (page: Page) => {
    const evaluationRunsResponse = waitForApiResponse<{
        runs: SnakeToCamelCaseKeys<EvaluationRun>[]
        count: number
    }>(page, {
        route: `/api/evaluations/runs/query`,
        method: "POST",
    })

    await page.goto(`${getProjectScopedBasePath(page)}/evaluations`, {
        waitUntil: "domcontentloaded",
    })
    const evaluationRuns = await evaluationRunsResponse

    // Fix: Check for .runs array in the response
    expect(Array.isArray(evaluationRuns.runs)).toBe(true)
    expect(evaluationRuns.runs.length).toBeGreaterThan(0)

    if (!evaluationRuns.runs.length) {
        console.error("[App Fixture] No evaluation runs found")
        throw new Error("No evaluation runs found")
    }

    console.log(
        "[Playground E2E] Evaluation runs API response:",
        JSON.stringify(evaluationRuns, null, 2),
    )
    return evaluationRuns.runs
}

export const apiHelpers = () => {
    return async ({page}: FixtureContext, use: UseFn<ApiHelpers>) => {
        await use({
            waitForApiResponse: async <T>(options: ApiHandlerOptions<T>) => {
                return await waitForApiResponse<T>(page, options)
            },
            createApp: async (type?: APP_TYPE): Promise<ListAppsItem> => {
                return await createApp(page, type ?? "completion")
            },
            getApp: async (type?: APP_TYPE): Promise<ListAppsItem> => {
                return await getApp(page, type)
            },
            getAppById: async (appId: string): Promise<ListAppsItem> => {
                return await getAppById(page, appId)
            },
            getTestsets: async () => {
                return await getTestsets(page)
            },
            createTestset: async (input: CreateTestsetInput) => {
                return await createTestset(page, input)
            },
            getVariants: async (appId: string) => {
                return await getVariants(page, appId)
            },
            getEvaluationRuns: async () => {
                return await getEvaluationRuns(page)
            },
            getProjectScopedBasePath: () => {
                return getProjectScopedBasePath(page)
            },
        })
    }
}
