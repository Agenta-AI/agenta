import {Page} from "@playwright/test"

import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import type {ApiHelpers, ApiHandlerOptions} from "./types"

export const waitForApiResponse = async <T>(
    page: Page,
    options: ApiHandlerOptions<T>,
): Promise<T> => {
    const {route, method = "POST", validateStatus = true, responseHandler} = options

    const response = await page.waitForResponse((response) => {
        const url = response.url()
        return (
            (route instanceof RegExp ? route.test(url) : url.includes(route)) &&
            response.request().method() === method
        )
    })

    if (validateStatus && response.status() !== 200) {
        throw new Error(`Response status ${response.status()}`)
    }

    const data = (await response.json()) as T
    if (responseHandler) await responseHandler(data)
    return data
}

export const apiHelpers = () => {
    return async ({page}: FixtureContext, use: UseFn<ApiHelpers>) => {
        await use({
            waitForApiResponse: async <T>(options: ApiHandlerOptions<T>) => {
                return await waitForApiResponse<T>(page, options)
            },
        })
    }
}
