import {expect} from "@playwright/test"

import {UseFn} from "../../types"
import {FixtureContext} from "../types"

import {
    clickButton,
    clickTab,
    clickTableRowButton,
    clickTableRowIcon,
    confirmModal,
    expectNoText,
    expectText,
    selectOption,
    selectOptions,
    typeWithDelay,
    waitForPath,
    clickTableRow,
    selectTableRowInput
} from "./helpers"
import {UIHelpers} from "./types"

export const uiHelpers = () => {
    return async ({page}: FixtureContext, use: UseFn<UIHelpers>) => {
        await use({
            clickTab: async (name) => {
                await clickTab(page, name)
            },
            clickTableRow: async (rowText: string) => {
                await clickTableRow(page, rowText)
            },
            clickTableRowButton: async ({rowText, buttonName}: {rowText: string | RegExp; buttonName: string | RegExp}) => {
                await clickTableRowButton(page, {rowText, buttonName})
            },
            clickTableRowIcon: async ({rowText, icon}: {rowText: string; icon: string}) => {
                await clickTableRowIcon(page, {rowText, icon})
            },
            confirmModal: async (buttonText?: string | RegExp) => {
                await confirmModal(page, buttonText)
            },
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
                await selectOption(page, {label, text: text as string})
            },

            selectOptions: async (labels) => {
                await selectOptions(page, labels)
            },

            expectPath: async (path) => {
                await expect(page).toHaveURL(new RegExp(path))
            },

            waitForPath: async (path: string) => {
                await waitForPath(page, path)
            },

            waitForLoadingState: async (text) => {
                const loading = page.getByText(text)
                await expect(loading).toBeVisible()
                await expect(loading).not.toBeVisible()
            },

            selectTableRowInput: async ({rowText, inputType, checked}) => {
                await selectTableRowInput({page, rowText, inputType, checked})
            },  
        })
    }
}
