import {expect, Locator, Page} from "@playwright/test"

export const typeWithDelay = async (page: Page, selector: string, text: string, delay = 50) => {
    const input = page.locator(selector)
    await input.click()
    await input.pressSequentially(text, {delay})
}

export const waitForPath = async (page: Page, path: string) => {
    // Strip protocol+host if full URL is passed, then match by pathname suffix
    // to support workspace-scoped URLs (/w/{id}/p/{id}/path)
    const pathname = path.replace(/^https?:\/\/[^/]+/, "")
    await page.waitForURL((url) => url.pathname.endsWith(pathname), {
        waitUntil: "domcontentloaded",
    })
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

export const expectNoText = async (page: Page, text: string) => {
    await expect(page.getByText(text)).not.toBeVisible()
}

export const selectOptions = async (page: Page, labels: string[]) => {
    for (const label of labels) {
        await page.getByLabel(label).check()
    }
}

export const expectText = async (
    page: Page,
    text: string,
    options: {
        role?: Parameters<Locator["getByRole"]>[0]
        name?: string
        exact?: boolean
        multiple?: boolean
    } & Parameters<Locator["getByRole"]>[1],
) => {
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

// Clicks a tab by its visible name (role=tab)
export const clickTab = async (page: Page, name: string) => {
    const tab = page.getByRole("tab", {name})
    await tab.click()
}

// Clicks a button inside a specific table row by row text and button name
// Clicks a button inside a specific table row by row text and button name, with robust visibility and debug support
/**
 * Clicks on a table row that contains the specified text
 * @param page - The Playwright Page object
 * @param rowText - The text content or regex pattern to identify the row
 */
export const clickTableRow = async (page: Page, rowText: string | RegExp) => {
    // Wait for the row to be visible
    const row = page.getByRole("row", {name: rowText}).first()
    await expect(row).toBeVisible()

    // Click the row
    await row.click()
}

/**
 * Selects a checkbox or radio button in a table row based on row text
 * @param page - The Playwright Page object
 * @param rowText - The text content or regex pattern to identify the row
 * @param inputType - The type of input to select ('checkbox' or 'radio')
 * @param checked - Whether the input should be checked (default: true)
 */
export const selectTableRowInput = async ({
    page,
    rowText,
    inputType,
    checked,
}: {
    page: Page
    rowText?: string | RegExp
    inputType: "checkbox" | "radio"
    checked: boolean
}) => {
    // Find the row
    let row: Locator

    if (!rowText) {
        row = page
            .getByRole("row")
            .filter({has: page.getByRole(inputType)})
            .first()
    } else {
        row = page
            .getByRole("row")
            .filter({hasText: rowText})
            .filter({has: page.getByRole(inputType)})
            .first()
    }
    await expect(row).toBeVisible()

    // Find the checkbox or radio button within the row
    const input = await row.getByRole(inputType).first()

    await expect(input).toBeVisible()

    // Check or uncheck based on the 'checked' parameter
    const currentState = await input.isChecked()
    if (currentState !== checked) {
        await input.check()
    }
}

/**
 * Clicks a button inside a specific table row by row text and button name
 * @param page - The Playwright Page object
 * @param rowText - The text content or regex pattern to identify the row
 * @param buttonName - The name or regex pattern of the button to click
 */
export const clickTableRowButton = async (
    page: Page,
    {rowText, buttonName}: {rowText: string | RegExp; buttonName: string | RegExp},
) => {
    // Wait for the row to be visible
    const row = page.getByRole("row", {name: rowText})
    await expect(row).toBeVisible()

    // Try to find the button by exact or regex match
    let button = await row.getByRole("button", {name: buttonName}).first()
    console.log("button", {button, count: await button.count(), row: await row.textContent()})
    if ((await button.count()) === 0) {
        // Debug: print all button names in the row
        const allButtons = await row.getByRole("button")
        if ((await allButtons.count()) === 0) {
            console.error(
                `No button named '${buttonName}' found in row '${rowText}'. Available buttons:`,
            )
            throw new Error(`No button named '${buttonName}' found in row '${rowText}'.`)
        } else {
            console.log("button found")
            button = allButtons.first()
        }
    }
    await expect(button).toBeVisible()
    console.log("button visible")
    await button.click()
}

// Clicks an icon (e.g., edit/delete) inside a specific table row by row text and icon aria-label or title
export const clickTableRowIcon = async (
    page: Page,
    {rowText, icon}: {rowText: string; icon: string},
) => {
    const row = page.getByRole("row", {name: rowText})
    // Try aria-label first, fallback to title attribute, then fallback to first svg (for raw SVG icons)
    let iconLocator = row.locator(`[aria-label='${icon}'], [title='${icon}']`).first()
    if ((await iconLocator.count()) === 0) {
        // Fallback: click the first SVG in the row (for AntD icons rendered as raw SVG)
        iconLocator = row.locator("svg").first()
    }
    await iconLocator.click()
}

// Confirms a modal dialog by clicking a button named 'Confirm' (case-insensitive)
export const confirmModal = async (page: Page, buttonText: string | RegExp = /Confirm/i) => {
    // Wait for any Ant Design modal to be visible
    const modalLocator = page.locator(".ant-modal")
    await modalLocator.waitFor({state: "visible"})

    // Try to find the confirm button inside the modal
    const confirmButton = modalLocator.getByRole("button", {name: buttonText}).first()
    if ((await confirmButton.count()) === 0) {
        // Debug: log all visible buttons in the modal
        const allButtons = await modalLocator.getByRole("button").all()
        const buttonNames = await Promise.all(
            allButtons.map(async (btn) => await btn.textContent()),
        )
        console.error(
            `[confirmModal] No button with text '${buttonText}' found. Visible buttons:`,
            buttonNames,
        )
        throw new Error(`[confirmModal] No button with text '${buttonText}' found in modal.`)
    }
    await confirmButton.waitFor({state: "visible"})
    await confirmButton.click()
}
