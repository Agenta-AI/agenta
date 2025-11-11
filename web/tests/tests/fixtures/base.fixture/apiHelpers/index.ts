import {expect, Page} from "@playwright/test"

import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import {ApiVariant, APP_TYPE, ListAppsItem, testset} from "../../../../../oss/src/lib/Types"
import type {ApiHandlerOptions, ApiHelpers} from "./types"

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
        expect(response.status()).toBe(200)
    }

    const data = await response.json()
    if (responseHandler) await responseHandler(data)
    return data as T
}

export const getApp = async (page: Page, type?: APP_TYPE) => {
    await page.goto("/apps")
    await page.waitForURL("/apps")

    const appsResponse = await waitForApiResponse<ListAppsItem[]>(page, {
        route: "/api/apps",
        method: "GET",
    })
    const apps = await appsResponse

    expect(Array.isArray(apps)).toBe(true)
    expect(apps.length).toBeGreaterThan(0)

    let targetApp
    if (type) {
        const app = apps.find((app) => app.app_type === type)
        if (!app) {
            targetApp = apps[0] // Fallback to first app if requested type not found
        } else if (Array.isArray(app)) {
            targetApp = app[0]
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

export const getTestsets = async (page: Page) => {
    // 2. Fetch testsets from API
    const testsetsResponse = await waitForApiResponse<testset[]>(page, {
        route: "/api/testsets",
        method: "GET",
    })
    const testsets = await testsetsResponse
    expect(testsets.length).toBeGreaterThan(0)

    return testsets
}

export const getVariants = async (page: Page, appId: string) => {
    // Wait for and extract variants from the API using apiHelpers
    // Debug: log outgoing requests to see the actual URL
    await page.goto(`/apps/${appId}/overview`)

    page.on("request", (request) => {
        if (request.url().includes("/variants")) {
            console.log("[E2E Debug] Outgoing request URL:", request.url())
        }
    })

    const variantsResponse = await waitForApiResponse<(ApiVariant & {name: string})[]>(page, {
        route: `/apps/${appId}/variants`,
        method: "GET",
    })

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

export const apiHelpers = () => {
    return async ({page}: FixtureContext, use: UseFn<ApiHelpers>) => {
        await use({
            waitForApiResponse: async <T>(options: ApiHandlerOptions<T>) => {
                return await waitForApiResponse<T>(page, options)
            },
            getApp: async (type?: APP_TYPE): Promise<ListAppsItem> => {
                return await getApp(page, type)
            },
            getTestsets: async () => {
                return await getTestsets(page)
            },
            getVariants: async (appId: string) => {
                return await getVariants(page, appId)
            },
        })
    }
}
