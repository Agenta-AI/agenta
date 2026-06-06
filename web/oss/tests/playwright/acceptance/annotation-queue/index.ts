import {
    createTagString,
    TestCoverage,
    TestPath,
    TestSpeedType,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"

import {expect, test as baseTest} from "./tests"

const QUEUE_NAME_PREFIX = "e2e-annotation-queue"

const annotationQueueTests = () => {
    // WEB-ACC-ANNOTATION-001
    baseTest(
        "should navigate to annotation queues page and see the queue list or empty state",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({navigateToAnnotations, page}) => {
            await navigateToAnnotations()

            // The page should render either the empty state or the queue table
            const hasEmptyState = await page
                .getByText("Create your first annotation queue")
                .isVisible()
                .catch(() => false)
            const hasTableRows = (await page.locator("[data-row-key]").count()) > 0
            expect(hasEmptyState || hasTableRows).toBe(true)

            // The "New Queue" button should always be visible
            await expect(page.getByRole("button", {name: "New Queue"})).toBeVisible()
        },
    )

    // WEB-ACC-ANNOTATION-002
    baseTest(
        "should create a new annotation queue with testcases kind",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({navigateToAnnotations, createAnnotationQueue, page}) => {
            await navigateToAnnotations()

            const queueName = `${QUEUE_NAME_PREFIX}-testcases-${Date.now()}`
            await createAnnotationQueue({name: queueName, kind: "testcases"})

            // After creation, the queue should appear in the list
            await expect(page.getByText(queueName).first()).toBeVisible({timeout: 15000})
        },
    )

    // WEB-ACC-ANNOTATION-003
    baseTest(
        "should create a new annotation queue with traces kind",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
            ],
        },
        async ({navigateToAnnotations, createAnnotationQueue, page}) => {
            await navigateToAnnotations()

            const queueName = `${QUEUE_NAME_PREFIX}-traces-${Date.now()}`
            await createAnnotationQueue({name: queueName, kind: "traces"})

            // After creation, the queue should appear in the list
            await expect(page.getByText(queueName).first()).toBeVisible({timeout: 15000})
        },
    )

    // WEB-ACC-ANNOTATION-004
    baseTest(
        "should open a queue detail page when clicking on a queue row",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
                createTagString("speed", TestSpeedType.SLOW),
            ],
        },
        async ({navigateToAnnotations, createAnnotationQueue, page}, testInfo) => {
            testInfo.setTimeout(120000)

            await navigateToAnnotations()

            const queueName = `${QUEUE_NAME_PREFIX}-detail-${Date.now()}`
            await createAnnotationQueue({name: queueName, kind: "testcases"})

            // Click on the queue row to navigate to detail page
            const queueRow = page.locator("[data-row-key]").filter({hasText: queueName}).first()
            await expect(queueRow).toBeVisible({timeout: 15000})
            await queueRow.click()

            // Should navigate to the queue detail page
            await expect
                .poll(() => new URL(page.url()).pathname, {timeout: 15000})
                .toContain(`${getProjectScopedBasePath(page)}/annotations/`)

            // The queue name should be visible on the detail page
            await expect(page.getByText(queueName).first()).toBeVisible({timeout: 10000})
        },
    )

    // WEB-ACC-ANNOTATION-005
    baseTest(
        "should search for annotation queues by name",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
                createTagString("speed", TestSpeedType.SLOW),
            ],
        },
        async ({navigateToAnnotations, createAnnotationQueue, page}, testInfo) => {
            testInfo.setTimeout(120000)

            await navigateToAnnotations()

            // Create a uniquely named queue so search is deterministic
            const uniqueSuffix = Date.now()
            const queueName = `${QUEUE_NAME_PREFIX}-search-${uniqueSuffix}`
            await createAnnotationQueue({name: queueName, kind: "testcases"})

            // Use the search input to filter
            const searchInput = page.locator('input[placeholder="Search queues"]').first()
            await expect(searchInput).toBeVisible({timeout: 10000})
            await searchInput.click()
            await searchInput.fill("")
            await searchInput.pressSequentially(queueName, {delay: 30})

            // The matching queue should be visible
            await expect(page.getByText(queueName).first()).toBeVisible({timeout: 15000})

            // Non-matching queues should be filtered out (if any other queues exist)
            const allRows = page.locator("[data-row-key]")
            const rowCount = await allRows.count()
            if (rowCount > 0) {
                // All visible rows should contain the search term
                for (let i = 0; i < rowCount; i++) {
                    await expect(allRows.nth(i)).toContainText(queueName)
                }
            }
        },
    )

    // WEB-ACC-ANNOTATION-006
    baseTest(
        "should delete an annotation queue via the actions menu",
        {
            tag: [
                createTagString("scope", TestScope.EVALUATIONS),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
                createTagString("license", "oss"),
                createTagString("speed", TestSpeedType.SLOW),
            ],
        },
        async ({navigateToAnnotations, createAnnotationQueue, page}, testInfo) => {
            testInfo.setTimeout(120000)

            await navigateToAnnotations()

            const queueName = `${QUEUE_NAME_PREFIX}-delete-${Date.now()}`
            await createAnnotationQueue({name: queueName, kind: "testcases"})

            // Find the queue row
            const queueRow = page.locator("[data-row-key]").filter({hasText: queueName}).first()
            await expect(queueRow).toBeVisible({timeout: 15000})

            // Click the actions (gear/more) button in the row
            const actionsButton = queueRow.locator("button").last()
            await actionsButton.click()

            // Click Delete from the dropdown menu
            const deleteMenuItem = page.getByText("Delete", {exact: true}).last()
            await expect(deleteMenuItem).toBeVisible({timeout: 5000})
            await deleteMenuItem.click()

            // Confirm the deletion in the modal/alert
            const confirmButton = page.getByRole("button", {name: /Delete|Confirm|OK/i}).last()
            if (await confirmButton.isVisible().catch(() => false)) {
                await confirmButton.click()
            }

            // The queue should no longer appear in the list
            await expect(page.getByText(queueName)).toBeHidden({timeout: 15000})
        },
    )
}

export default annotationQueueTests
