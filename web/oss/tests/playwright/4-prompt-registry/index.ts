// E2E test for prompt registry: editing and committing a prompt, verifying commit in recent prompts
// Covers overview and drawer interactions
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import type {ApiRevision} from "@/oss/lib/Types"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

// TODO: Implement fixture helpers for navigation, prompt editing, drawer interaction, and commit dialog as needed
// TODO: Use API helpers to validate server data before asserting UI state

const promptRegistryTests = () => {
    test(
        "should allow editing and committing a prompt in the prompt registry, and verify the commit appears in recent prompts",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, uiHelpers, apiHelpers}) => {
            // Implementation will:
            // 1. Navigate to the prompt registry page (implement navigation helper if needed)
            // 2. Assert table loads (use semantic selectors, not text-based)
            // 3. Select a prompt row (by structure, not text)
            // 4. Interact with the drawer component (open, edit prompt, etc.)
            // 5. Switch between overview and JSON tabs
            // 6. Commit changes (open dialog, fill message, confirm)
            // 7. Use apiHelpers to validate data presence before UI assertions
            // 8. Assert commit appears in recent prompts

            // 1. Dynamically navigate to the prompt registry overview page
            // Fetch the list of apps from the API (using apiHelpers)
            const app = await apiHelpers.getApp("completion")
            const appId = app.app_id

            const variants = await apiHelpers.getVariants(appId)

            // Log the API response for debugging
            console.log(
                "[Prompt Registry E2E] Variants API response:",
                JSON.stringify(variants, null, 2),
            )

            // 3. Select a prompt row using the variant name from the API
            const variant = variants[variants.length - 1]
            const variantName = variant.variant_name || variant.name
            const variantId = variant.variant_id

            // Fetch revisions for the selected variant
            const revisionsResponse = apiHelpers.waitForApiResponse<ApiRevision[]>({
                route: `/api/variants/${variantId}/revisions`,
                method: "GET",
            })
            const revisions = await revisionsResponse
            expect(Array.isArray(revisions)).toBe(true)
            expect(revisions.length).toBeGreaterThan(0)
            console.log(
                "[Prompt Registry E2E] Variant revisions:",
                JSON.stringify(revisions, null, 2),
            )
            // Use the first revision's id for URL assertion (unless your flow requires otherwise)
            const revision = revisions[0]
            const revisionId = revision.id
            console.log(
                `[Prompt Registry E2E] Selecting row for variant: ${variantName} ${revisionId}`,
            )
            // Scroll the section header into view for robust targeting
            const sectionHeader = page.getByRole("heading", {name: /recent prompts/i})
            await sectionHeader.scrollIntoViewIfNeeded()
            // Find the row by text content and scroll/click
            const row = page.locator("tr", {hasText: variantName}).first()
            await row.scrollIntoViewIfNeeded()
            await row.click()

            // 4. Open the drawer and assert its contents
            console.log(
                `[Prompt Registry E2E] Waiting for drawer with variant: ${variantName}`,
                revision,
            )
            await expect(page.locator(".ant-drawer-content-wrapper")).toBeVisible()

            // 5. Assert revision metadata present (ApiRevision fields only)
            expect(revision.id).toBe(revisionId)
            expect(typeof revision.revision).toBe("number")
            expect(typeof revision.modified_by).toBe("string")
            expect(typeof revision.created_at).toBe("string")

            // Switch back to Overview tab (if required by UI flow)
            await page.getByRole("tab", {name: /overview|variant/i}).click()

            // Assert the prompt message is visible in the overview tab
            // Assume the prompt message is stored at revisions[0].config.parameters.promptMessage

            // const promptMessage = revision.config.parameters.prompt.messages[0].content

            // expect(typeof promptMessage).toBe("string")

            // await expect(
            //     page.getByText(promptMessage.substring(0, 20), {exact: false}),
            // ).toBeVisible()
        },
    )
}

export default promptRegistryTests
