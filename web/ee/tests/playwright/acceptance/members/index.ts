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

import {expectAuthenticatedSession} from "@agenta/oss/tests/playwright/acceptance/utils/auth"
import {createScenarios} from "@agenta/oss/tests/playwright/acceptance/utils/scenarios"
import {buildAcceptanceTags} from "@agenta/oss/tests/playwright/acceptance/utils/tags"

const scenarios = createScenarios(test)

const lightFastTags = buildAcceptanceTags({
    scope: [TestScope.MEMBERS],
    coverage: [TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.EE,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const membersTests = () => {
    // WEB-ACC-MEMBERS-002
    test(
        "should invite a member and verify pending state",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.setTimeout(60000)
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
                    timeout: 15000,
                })
            })

            await scenarios.when(
                "the user clicks Invite Members, fills in an email address and selects a role",
                async () => {
                    await page.getByRole("button", {name: "Invite Members"}).click()

                    const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
                    await expect(inviteModal).toBeVisible({timeout: 10000})

                    const emailInput = inviteModal.getByPlaceholder("member@organization.com")
                    await expect(emailInput).toBeVisible({timeout: 5000})
                    await emailInput.fill(testEmail)

                    // EE renders a role selector; select "Viewer" (default) or leave as-is
                    const roleSelect = inviteModal.locator(".ant-select").first()
                    if (await roleSelect.isVisible()) {
                        // Role selector is present in EE; keep the default selection
                        await expect(roleSelect).toBeVisible()
                    }
                },
            )

            await scenarios.and("the user submits the invitation", async () => {
                const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
                await inviteModal.getByRole("button", {name: "Invite"}).click()
                // EE: email is sent, modal closes, success toast appears
                await expect(inviteModal).not.toBeVisible({timeout: 15000})
            })

            await scenarios.then(
                "the invited member appears in the members list with an Invitation Pending tag",
                async () => {
                    // After the modal closes the members table refreshes
                    await expect(page.getByText("Invitation Pending").first()).toBeVisible({
                        timeout: 15000,
                    })

                    // Confirm the invited email appears alongside the pending tag
                    await expect(page.getByText(testEmail)).toBeVisible({timeout: 10000})
                },
            )
        },
    )
}

export default membersTests
