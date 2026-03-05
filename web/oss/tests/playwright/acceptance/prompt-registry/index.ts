import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const promptRegistryTests = () => {
    test(
        "should open prompt details from prompt registry",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, uiHelpers}) => {
            await page.goto("/prompts", {waitUntil: "domcontentloaded"})
            await uiHelpers.expectPath("/prompts")

            await expect(page.getByRole("heading", {name: /prompts|recent prompts/i}).first()).toBeVisible()

            const promptsTable = page.getByRole("table").first()
            await expect(promptsTable).toBeVisible()

            const firstDataRow = promptsTable.getByRole("row").nth(1)
            await expect(firstDataRow).toBeVisible()
            await firstDataRow.click()

            await expect(page.locator(".ant-drawer-content-wrapper")).toBeVisible()
            await expect(page.getByRole("tab", {name: /overview|variant|json/i}).first()).toBeVisible()
        },
    )
}

export default promptRegistryTests
