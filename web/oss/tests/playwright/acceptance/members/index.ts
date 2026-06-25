import {
    TestCoverage,
    TestcaseType,
    TestPath,
    TestScope,
    TestLensType,
    TestCostType,
    TestLicenseType,
    TestRoleType,
    TestSpeedType,
} from "@agenta/web-tests/playwright/config/testTags"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(test)

const lightFastTags = buildAcceptanceTags({
    scope: [TestScope.MEMBERS],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const membersTests = () => {
    // WEB-ACC-MEMBERS-001
    test(
        "should invite a member and show the invite link modal",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            // 90 s: settings page load (~5 s) + invite API call (~15 s) + modal assertions
            test.setTimeout(90000)
            const testEmail = `test-member-invite-${Date.now()}@agenta-e2e.test`

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Members settings page", async () => {
                const basePath = apiHelpers.getProjectScopedBasePath()
                await page.goto(`${basePath}/settings`, {waitUntil: "domcontentloaded"})
                await uiHelpers.expectPath("/settings")
                // The default tab is "workspace" which renders the Members section
                await expect(page.getByRole("button", {name: "Invite Members"})).toBeVisible({
                    timeout: 20000,
                })
            })

            await scenarios.when(
                "the user clicks Invite Members and fills in an email address",
                async () => {
                    await page.getByRole("button", {name: "Invite Members"}).click()

                    const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
                    await expect(inviteModal).toBeVisible({timeout: 10000})

                    const emailInput = inviteModal.getByPlaceholder("member@organization.com")
                    await expect(emailInput).toBeVisible({timeout: 5000})
                    await emailInput.fill(testEmail)
                },
            )

            await scenarios.and("the user submits the invitation", async () => {
                const inviteModal = page.getByRole("dialog", {name: "Invite Members"})

                // Set up the API response listener BEFORE clicking so we don't miss the
                // response if the API is fast.
                const inviteResponsePromise = page
                    .waitForResponse(
                        (r) => /\/invite/i.test(r.url()) && r.request().method() === "POST",
                        {timeout: 30000},
                    )
                    .catch(() => null)

                await inviteModal.getByRole("button", {name: "Invite"}).click()

                // Wait for the API call to complete before asserting modal state.
                await inviteResponsePromise

                // Invite modal should close once the server responds with the invite link.
                await expect(inviteModal).not.toBeVisible({timeout: 20000})
            })

            await scenarios.then(
                "the invited user link modal appears with a shareable URL",
                async () => {
                    const linkModal = page.getByRole("dialog", {name: "Invited user link"})
                    await expect(linkModal).toBeVisible({timeout: 20000})

                    // Verify the modal shows the invited email
                    await expect(linkModal.getByText(testEmail)).toBeVisible({timeout: 10000})

                    // Verify the invite URL is present
                    await expect(linkModal.getByText(/https?:\/\//)).toBeVisible({timeout: 5000})

                    // Close via the X button — "Copy & Close" calls navigator.clipboard which
                    // throws in headless CI, preventing onCancel from being called.
                    const closeButton = linkModal
                        .locator('button[aria-label="Close"]')
                        .or(linkModal.getByRole("button", {name: "Close"}))
                        .first()
                    await closeButton.click()
                    await expect(linkModal).not.toBeVisible({timeout: 10000})
                },
            )
        },
    )
}

export default membersTests
