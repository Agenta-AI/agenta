import {Locator, Page} from "@playwright/test"

export const typeWithDelay = async (page: Page, selector: string, text: string, delay = 50) => {
    const input = page.locator(selector)
    await input.click()
    await input.pressSequentially(text, {delay})
}

export const waitForPath = async (page: Page, path: string) => {
    await page.waitForURL(path, {waitUntil: "domcontentloaded"})
}

export const clickButton = async (page: Page, name: string, locator?: Locator) => {
    const button = (locator || page).getByRole("button", {name}).first()
    await button.click()
}

export const selectOption = async (page: Page, {label, text}: {label?: string; text?: string}) => {
    if (text) {
        if (Array.isArray(text)) {
            const [textValue, options] = text
            await page.getByText(textValue, options).click()
        } else {
            await page.getByText(text).click()
        }
    } else if (label) {
        await page.getByLabel(label).check()
    }
}
