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

const openInviteMembersModal = async (page: any) => {
    const inviteButton = page.getByRole("button", {name: "Invite Members"}).first()
    await expect(inviteButton).toBeVisible({timeout: 20000})
    await expect(inviteButton).toBeEnabled()

    const inviteModal = page.getByRole("dialog", {name: "Invite Members"})

    // Use a PAGE-LEVEL (unscoped) locator for the email input.
    //
    // Scoping through `inviteModal.getByPlaceholder(...)` is unreliable here because:
    //   1. InviteUsersModal is a `dynamic()` import — the form mounts AFTER the modal
    //      wrapper becomes visible, so the dialog-scoped locator resolves to zero elements
    //      until the JS chunk fully evaluates.
    //   2. rc-dialog briefly UNMOUNTS content while its `animatedVisible` useEffect
    //      settles (fires on the next frame after first render), making a dialog-scoped
    //      locator transiently stale.
    // Searching the entire page avoids both issues while remaining unique in practice
    // (only one invite form is ever present at a time).
    const emailInput = page.getByPlaceholder("member@organization.com").first()

    for (let attempt = 0; attempt < 3; attempt++) {
        // Ensure any previous dialog is closed before clicking again.
        const alreadyOpen = await inviteModal.isVisible().catch(() => false)
        if (!alreadyOpen) {
            await inviteButton.click()
        }

        // Wait for the email input to become visible. This is the most reliable
        // signal that both the modal wrapper AND its dynamic content are ready.
        const inputAppeared = await emailInput
            .waitFor({state: "visible", timeout: 15000})
            .then(() => true)
            .catch(() => false)

        if (inputAppeared) {
            return {inviteModal, emailInput}
        }

        // Form never appeared — dismiss any partial modal and retry.
        await page.keyboard.press("Escape")
        await page.waitForTimeout(500)
    }

    // Final assertion: surfaces a clear error if the input never appeared.
    await expect(emailInput).toBeVisible({timeout: 15000})
    return {inviteModal, emailInput}
}

const submitInviteMembersModal = async (inviteModal: any) => {
    await inviteModal.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit())
    await expect(inviteModal).not.toBeVisible({timeout: 30000})
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

    const {inviteModal, emailInput} = await openInviteMembersModal(page)
    // Wait for the email input rather than just the dialog — the InviteUsersModal
    // is a dynamic() import, so the form body can lag behind the modal wrapper.
    // Waiting for the input guarantees the chunk has fully rendered.
    // Click before fill: rc-component/dialog briefly unmounts while animatedVisible
    // catches up (useEffect fires after first render), which makes the locator
    // stale. A click forces Playwright to wait for the element to be fully
    // interactive before fill attempts to interact.
    await emailInput.click()
    await emailInput.fill(testEmail)

    // Submit the form and wait for the modal to close as the success signal.
    // The InviteUsersModal only closes its onSuccess callback after the API
    // returns successfully — so modal closure == invite accepted.
    // Waiting for the network response by URL is fragile (URL-pattern drift,
    // timing races between listener registration and the async form submit).
    await submitInviteMembersModal(inviteModal)

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
            // 90 s: navigation + up to 3 modal-open attempts × 15 s + fill + submit + assertion
            test.setTimeout(90000)
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
                    const {inviteModal, emailInput} = await openInviteMembersModal(page)
                    // Wait for the input directly — the InviteUsersModal is a dynamic()
                    // import so the form body can lag behind the modal wrapper appearing.
                    // Click before fill: rc-component/dialog briefly unmounts the panel
                    // while animatedVisible settles (useEffect fires after first render),
                    // making the locator transiently stale. Clicking first ensures the
                    // element is fully interactive before fill runs.
                    await emailInput.click()
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
                // Submit the form and wait for the modal to dismiss as the success signal.
                // The InviteUsersModal only closes after the API returns successfully,
                // so modal closure is equivalent to a successful invite response.
                await submitInviteMembersModal(inviteModal)
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
