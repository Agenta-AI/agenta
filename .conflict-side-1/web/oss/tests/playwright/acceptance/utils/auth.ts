import {expect, type Page} from "@playwright/test"

export const expectAuthenticatedSession = async (page: Page) => {
    const storageState = await page.context().storageState()
    const hasCookies = storageState.cookies.length > 0
    const hasLocalStorage = storageState.origins.some((origin) => origin.localStorage.length > 0)

    expect(hasCookies || hasLocalStorage).toBe(true)
}
