import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"

import type {AnnotationQueueFixtures} from "./assets/types"

const getAnnotationsPath = (page: Page) =>
    `${getProjectScopedBasePath(page)}/annotations`

const waitForQueueListLoad = async (page: Page) => {
    // Wait for the annotations page to finish loading — either the table
    // renders rows or the empty state appears.
    await expect
        .poll(
            async () => {
                const hasTable = (await page.locator("[data-row-key]").count()) > 0
                const hasEmptyState = await page
                    .getByText("Create your first annotation queue")
                    .isVisible()
                    .catch(() => false)
                const hasNewQueueButton = await page
                    .getByRole("button", {name: "New Queue"})
                    .isVisible()
                    .catch(() => false)
                return hasTable || hasEmptyState || hasNewQueueButton
            },
            {timeout: 30000},
        )
        .toBe(true)
}

const testWithAnnotationFixtures = baseTest.extend<AnnotationQueueFixtures>({
    navigateToAnnotations: async ({page}, use) => {
        await use(async () => {
            const annotationsPath = getAnnotationsPath(page)
            await page.goto(annotationsPath, {waitUntil: "domcontentloaded"})
            await expect.poll(() => new URL(page.url()).pathname).toBe(annotationsPath)
            await waitForQueueListLoad(page)
        })
    },

    createAnnotationQueue: async ({page}, use) => {
        await use(async ({name, kind}) => {
            // Click the "New Queue" button
            const newQueueButton = page.getByRole("button", {name: "New Queue"})
            await expect(newQueueButton).toBeVisible({timeout: 10000})
            await newQueueButton.click()

            // Wait for the drawer to open
            const drawer = page.locator(".ant-drawer-content-wrapper").last()
            await expect(drawer).toBeVisible({timeout: 10000})
            await expect(drawer.getByText("Create annotation queue")).toBeVisible()

            // Fill in the queue name
            const nameInput = drawer.locator('input[placeholder="Enter name"]').first()
            await expect(nameInput).toBeVisible()
            await nameInput.click()
            await nameInput.fill("")
            await nameInput.pressSequentially(name, {delay: 20})
            await expect(nameInput).toHaveValue(name)

            // Select queue type if different from default ("traces")
            if (kind === "testcases") {
                const kindSelect = drawer.locator(".ant-select").first()
                await kindSelect.click()
                const testcaseOption = page.getByText("Test cases", {exact: true}).last()
                await expect(testcaseOption).toBeVisible()
                await testcaseOption.click()
            }

            // Click Create button
            const createButton = drawer.getByRole("button", {name: "Create"}).last()
            await expect(createButton).toBeEnabled({timeout: 10000})
            await createButton.click()

            // Wait for drawer to close (indicating success)
            await expect(drawer).toBeHidden({timeout: 30000})
        })
    },
})

export {testWithAnnotationFixtures as test, expect}
