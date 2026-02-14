import {test, expect} from "@playwright/test"

test("smoke: auth works and can navigate to apps", async ({page}) => {
    test.setTimeout(10000)
    await page.goto("/apps")
    await page.waitForURL("**/apps", {timeout: 5000})
    await expect(page).toHaveURL(/apps/)
    console.log("[smoke] Current URL:", page.url())
})
