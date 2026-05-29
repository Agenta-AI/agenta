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

const createInviteEmail = (scope: string) =>
    `${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@agenta.test`

const waitForInviteResponse = async (page: any) => {
    const response = await page.waitForResponse(
        (res: any) =>
            res.request().method() === "POST" &&
            res.url().includes("/workspaces/") &&
            res.url().includes("/invite?"),
        {timeout: 15000},
    )

    if (!response.ok()) {
        throw new Error(`Invite request failed (${response.status()}): ${await response.text()}`)
    }
}

const waitForRemoveResponse = async (page: any) => {
    const response = await page.waitForResponse(
        (res: any) =>
            res.request().method() === "DELETE" &&
            res.url().includes("/workspaces/") &&
            res.url().includes("/users") &&
            ![301, 302, 303, 307, 308].includes(res.status()),
        {timeout: 15000},
    )

    if (!response.ok()) {
        throw new Error(
            `Remove member request failed (${response.status()}): ${await response.text()}`,
        )
    }
}

/**
 * Invite a member via the EE flow (email sent) and wait for their row to appear
 * in the members table with "Invitation Pending" status.
 * Returns the invited email so callers can locate the row.
 */
const invitePendingMember = async (page: any, apiHelpers: any, uiHelpers: any): Promise<string> => {
    const testEmail = createInviteEmail("test-member")

    const basePath = apiHelpers.getProjectScopedBasePath()
    await page.goto(`${basePath}/settings`, {waitUntil: "domcontentloaded"})
    await uiHelpers.expectPath("/settings")

    const inviteButton = page.getByRole("button", {name: "Invite Members"})
    await expect(inviteButton).toBeVisible({timeout: 20000})
    await inviteButton.click()

    const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
    const emailInput = inviteModal.getByPlaceholder("member@organization.com")
    // Wait for the email input rather than just the dialog — the InviteUsersModal
    // is a dynamic() import, so the form body can lag behind the modal wrapper.
    // Waiting for the input guarantees the chunk has fully rendered.
    await expect(emailInput).toBeVisible({timeout: 20000})
    await emailInput.fill(testEmail)

    await Promise.all([
        waitForInviteResponse(page),
        inviteModal.getByRole("button", {name: "Invite"}).click(),
    ])
    await expect(inviteModal).not.toBeVisible({timeout: 15000})

    // Wait for the pending row to appear in the refreshed table
    await expect(page.getByText(testEmail)).toBeVisible({timeout: 15000})

    return testEmail
}

const membersTests = () => {
    // WEB-ACC-MEMBERS-002
    test(
        "should invite a member and verify pending state",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            test.setTimeout(60000)
            const testEmail = createInviteEmail("test-member-invite")

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Members settings page", async () => {
                const basePath = apiHelpers.getProjectScopedBasePath()
                await page.goto(`${basePath}/settings`, {waitUntil: "domcontentloaded"})
                await uiHelpers.expectPath("/settings")
                await expect(page.getByRole("button", {name: "Invite Members"})).toBeVisible({
                    timeout: 20000,
                })
            })

            await scenarios.when(
                "the user clicks Invite Members, fills in an email address and selects a role",
                async () => {
                    await page.getByRole("button", {name: "Invite Members"}).click()

                    const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
                    const emailInput = inviteModal.getByPlaceholder("member@organization.com")
                    // Wait for the input directly — the InviteUsersModal is a dynamic()
                    // import so the form body can lag behind the modal wrapper appearing.
                    await expect(emailInput).toBeVisible({timeout: 20000})
                    await emailInput.fill(testEmail)

                    // EE renders a role selector; keep the default selection
                    const roleSelect = inviteModal.locator(".ant-select").first()
                    if (await roleSelect.isVisible()) {
                        await expect(roleSelect).toBeVisible()
                    }
                },
            )

            await scenarios.and("the user submits the invitation", async () => {
                const inviteModal = page.getByRole("dialog", {name: "Invite Members"})
                await Promise.all([
                    waitForInviteResponse(page),
                    inviteModal.getByRole("button", {name: "Invite"}).click(),
                ])
                await expect(inviteModal).not.toBeVisible({timeout: 15000})
            })

            await scenarios.then(
                "the invited member appears in the members list with an Invitation Pending tag",
                async () => {
                    await expect(page.getByText("Invitation Pending").first()).toBeVisible({
                        timeout: 15000,
                    })
                    await expect(page.getByText(testEmail)).toBeVisible({timeout: 10000})
                },
            )
        },
    )

    // WEB-ACC-MEMBERS-003
    test(
        "should resend an invitation and confirm success",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            // invitePendingMember runs a full invite flow as setup — give enough
            // headroom for navigation + modal interaction + the resend action.
            test.setTimeout(90000)

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            let testEmail = ""

            await scenarios.and("a pending member invite exists", async () => {
                testEmail = await invitePendingMember(page, apiHelpers, uiHelpers)
            })

            await scenarios.when("the user opens the actions menu for that member", async () => {
                const memberRow = page.locator("tr").filter({hasText: testEmail})
                await expect(memberRow).toBeVisible({timeout: 10000})
                // ⋯ button is the last button in the row
                await memberRow.locator("button").last().click()
            })

            await scenarios.and("the user clicks Resend invitation", async () => {
                await page
                    .locator(".ant-dropdown-menu-item")
                    .filter({hasText: "Resend invitation"})
                    .click()
            })

            await scenarios.then("a success confirmation is shown", async () => {
                await expect(page.getByText("Invitation sent!")).toBeVisible({timeout: 10000})
            })
        },
    )

    // WEB-ACC-MEMBERS-004
    test(
        "should remove a pending member from the workspace",
        {tag: lightFastTags},
        async ({page, apiHelpers, uiHelpers}) => {
            // invitePendingMember runs a full invite flow as setup — give enough
            // headroom for navigation + modal interaction + the remove action.
            test.setTimeout(90000)

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            let testEmail = ""

            await scenarios.and("a pending member invite exists", async () => {
                testEmail = await invitePendingMember(page, apiHelpers, uiHelpers)
            })

            await scenarios.when("the user opens the actions menu for that member", async () => {
                const memberRow = page.locator("tr").filter({hasText: testEmail})
                await expect(memberRow).toBeVisible({timeout: 10000})
                await memberRow.locator("button").last().click()
            })

            await scenarios.and("the user clicks Remove and confirms", async () => {
                await page.locator(".ant-dropdown-menu-item").filter({hasText: "Remove"}).click()

                // AlertPopup renders as a modal.confirm dialog — title "Remove member"
                const confirmDialog = page.getByRole("dialog", {name: "Remove member"})
                await expect(confirmDialog).toBeVisible({timeout: 10000})
                await Promise.all([
                    waitForRemoveResponse(page),
                    confirmDialog.getByRole("button", {name: "Remove"}).click(),
                ])
            })

            await scenarios.then("the member no longer appears in the members list", async () => {
                await expect(page.getByText(testEmail)).not.toBeVisible({timeout: 15000})
            })
        },
    )
}

export default membersTests
