import {expect, Locator, Page} from "@playwright/test"

import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import {clickButton, selectOption, typeWithDelay, waitForPath} from "./helpers"
import {UIHelpers} from "./types"

export const expectText = async (page: Page, text: string, options = {}) => {
    let locator
    const role = options.role
    if (role) {
        locator = page.getByRole(role, {name: text})
    } else {
        locator = page.getByText(text, {exact: options.exact})
    }

    if (options.multiple) {
        const count = await locator.count()
        expect(count).toBeGreaterThan(0)
    } else {
        await expect(locator).toBeVisible()
    }
}

export const expectNoText = async (page: Page, text: string) => {
    await expect(page.getByText(text)).not.toBeVisible()
}

export const selectOptions = async (page: Page, labels: string[]) => {
    for (const label of labels) {
        await page.getByLabel(label).check()
    }
}

export const uiHelpers = () => {
    return async ({page}: FixtureContext, use: UseFn<UIHelpers>) => {
        await use({
            expectText: async (text: string, options = {}) => {
                await expectText(page, text, options)
            },

            expectNoText: async (text) => {
                await expectNoText(page, text)
            },

            typeWithDelay: async (selector, text, delay = 50) => {
                await typeWithDelay(page, selector, text, delay)
            },

            clickButton: async (name, locator) => {
                await clickButton(page, name, locator)
            },

            selectOption: async ({label, text}) => {
                await selectOption(page, {label, text})
            },

            selectOptions: async (labels) => {
                await selectOptions(page, labels)
            },

            expectPath: async (path) => {
                await expect(page).toHaveURL(new RegExp(path))
            },

            waitForPath: async (path) => {
                await waitForPath(page, path)
            },

            waitForLoadingState: async (text) => {
                const loading = page.getByText(text)
                await expect(loading).toBeVisible()
                await expect(loading).not.toBeVisible()
            },
        })
    }
}
