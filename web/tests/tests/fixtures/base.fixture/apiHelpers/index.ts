import {expect, Page} from "@playwright/test"

import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import {
    ApiVariant,
    APP_TYPE,
    ListAppsItem,
    SnakeToCamelCaseKeys,
    testset,
} from "../../../../../oss/src/lib/Types"
import {EvaluationRun} from "../../../../../oss/src/lib/hooks/usePreviewEvaluations/types"
import type {ApiHandlerOptions, ApiHelpers} from "./types"

const APP_TYPE_LABELS: Record<APP_TYPE, string> = {
    completion: "Completion Prompt",
    chat: "Chat Prompt",
    custom: "Custom Prompt",
}

const latestRevisionIdByAppId = new Map<string, string>()

export const getKnownLatestRevisionId = (appId: string): string | null => {
    return latestRevisionIdByAppId.get(appId) ?? null
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

async function createApp(page: Page, type: APP_TYPE): Promise<ListAppsItem> {
    const appName = `e2e-${type}-${Date.now()}`
    const createAppResponse = page.waitForResponse((response) => {
        if (!response.url().includes("/api/apps") || response.request().method() !== "POST") {
            return false
        }

        const payload = response.request().postData() || ""
        return payload.includes(appName)
    })
    const createVariantResponse = page.waitForResponse((response) => {
        return (
            response.url().includes("/variant/from-template") &&
            response.request().method() === "POST"
        )
    })
    const updateVariantParametersResponse = page.waitForResponse((response) => {
        return response.url().includes("/api/variants/") && response.request().method() === "PUT"
    })

    const createButton = page.getByRole("button", {name: "Create New Prompt"}).first()
    await expect(createButton).toBeVisible({timeout: 15000})
    await createButton.click()

    const dialog = page.getByRole("dialog").first()
    await expect(dialog).toBeVisible({timeout: 15000})
    await dialog.getByPlaceholder("Enter a name").fill(appName)

    const appTypeLabel = APP_TYPE_LABELS[type]
    if (!appTypeLabel) {
        throw new Error(`App creation is not implemented for app type '${type}'.`)
    }

    await page.getByText(appTypeLabel, {exact: true}).first().click()
    await dialog.getByRole("button", {name: "Create New Prompt"}).click()

    const response = await createAppResponse
    expect(response.ok()).toBe(true)

    const createdApp = await response.json()
    const createdAppId = createdApp.app_id

    expect(createdAppId).toBeTruthy()

    const createdVariantResponse = await createVariantResponse
    expect(createdVariantResponse.ok()).toBe(true)

    const createdVariant = await createdVariantResponse.json()
    const createdVariantId =
        createdVariant.variant_id ?? createdVariant.variantId ?? createdVariant.id ?? null

    const parametersResponse = await updateVariantParametersResponse
    expect(parametersResponse.ok()).toBe(true)

    const updatedRevision = await parametersResponse.json()
    const latestRevisionId = updatedRevision?.id ?? null

    if (createdVariantId && latestRevisionId) {
        latestRevisionIdByAppId.set(createdAppId, latestRevisionId)
    }

    return {
        ...createdApp,
        app_id: createdAppId,
        app_name: createdApp.app_name ?? appName,
        app_type: type,
    } as ListAppsItem
}

export const getApp = async (page: Page, type: APP_TYPE = "completion") => {
    const appsResponse = waitForApiResponse<ListAppsItem[]>(page, {
        route: "/api/apps",
        method: "GET",
    })

    await page.goto("/apps", {waitUntil: "domcontentloaded"})
    await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})

    const apps = await appsResponse

    expect(Array.isArray(apps)).toBe(true)

    let targetApp
    if (!apps.length) {
        targetApp = await createApp(page, type)
    } else if (type) {
        const app = apps.find((app) => app.app_type === type)
        if (!app) {
            targetApp = await createApp(page, type)
        } else {
            targetApp = app
        }
    } else {
        targetApp = apps[0]
    }
    const appId = targetApp.app_id

    if (!appId) {
        console.error("[App Fixture] App not found")
        throw new Error("App not found")
    }

    return targetApp
}

export const getAppById = async (page: Page, appId: string) => {
    const appsResponse = waitForApiResponse<ListAppsItem[]>(page, {
        route: "/api/apps",
        method: "GET",
    })

    // Trigger the API call by going to apps page if not already there
    const currentUrl = page.url()
    if (!currentUrl.includes("/apps")) {
        await page.goto("/apps", {waitUntil: "domcontentloaded"})
        await page.waitForURL("**/apps", {waitUntil: "domcontentloaded"})
    }

    const apps = await appsResponse

    const app = apps.find((app) => app.app_id === appId)
    if (!app) {
        console.error(`[App Fixture] App not found with ID: ${appId}`)
        throw new Error(`App not found with ID: ${appId}`)
    }

    return app
}

export const getTestsets = async (page: Page) => {
    const testsetsResponse = waitForApiResponse<{testsets: testset[]}>(page, {
        route: "/api/preview/testsets/query",
        method: "POST",
    })

    await page.goto("/testsets", {waitUntil: "domcontentloaded"})
    const response = await testsetsResponse
    const testsets = response.testsets
    expect(testsets.length).toBeGreaterThan(0)

    return testsets
}

export const getVariants = async (page: Page, appId: string) => {
    await page.goto("/apps", {waitUntil: "domcontentloaded"})
    const appsPathname = new URL(page.url()).pathname
    const appsSuffix = "/apps"
    const scopedPrefix = appsPathname.endsWith(appsSuffix)
        ? appsPathname.slice(0, -appsSuffix.length)
        : ""
    const overviewPath = `${scopedPrefix}/apps/${appId}/overview`

    const variantsResponse = waitForApiResponse<(ApiVariant & {name: string})[]>(page, {
        route: `/apps/${appId}/variants`,
        method: "GET",
    })

    await page.goto(overviewPath, {waitUntil: "domcontentloaded"})
    const variants = await variantsResponse
    expect(Array.isArray(variants)).toBe(true)
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
        route: `/api/preview/evaluations/runs/query`,
        method: "POST",
    })

    await page.goto("/evaluations", {waitUntil: "domcontentloaded"})
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
            getApp: async (type?: APP_TYPE): Promise<ListAppsItem> => {
                return await getApp(page, type)
            },
            getAppById: async (appId: string): Promise<ListAppsItem> => {
                return await getAppById(page, appId)
            },
            getTestsets: async () => {
                return await getTestsets(page)
            },
            getVariants: async (appId: string) => {
                return await getVariants(page, appId)
            },
            getEvaluationRuns: async () => {
                return await getEvaluationRuns(page)
            },
        })
    }
}
