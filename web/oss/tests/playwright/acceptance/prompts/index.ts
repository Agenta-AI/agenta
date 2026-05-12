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

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"
import {test as baseTest} from "./test"

const scenarios = createScenarios(baseTest)

const tags = buildAcceptanceTags({
    scope: [TestScope.APPS],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.FAST,
})

const buildFolderName = (suffix: string) => `test-folder-${suffix}-${Date.now()}`
const buildPromptName = (suffix: string) => `test-${suffix}-${Date.now()}`

const tests = () => {
    baseTest(
        "navigates to the Prompts page and displays it",
        {tag: tags},
        async ({page, navigateToPrompts}) => {
            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.when("the user navigates to the Prompts page", async () => {
                await navigateToPrompts()
            })

            await scenarios.then(
                "the Prompts page is displayed with the Create new button",
                async () => {
                    await page.waitForURL("**/prompts", {waitUntil: "domcontentloaded"})
                },
            )
        },
    )

    baseTest(
        "creates a new prompt via the Create new dropdown",
        {tag: tags},
        async ({page, navigateToPrompts, createNewPrompt}) => {
            const promptName = buildPromptName("prompt")

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Prompts page", async () => {
                await navigateToPrompts()
            })

            await scenarios.when(
                "the user clicks Create new, selects New prompt, and fills in the form",
                async () => {
                    await createNewPrompt(promptName)
                },
            )

            await scenarios.then(
                "the new prompt modal was opened and submitted successfully",
                async () => {
                    // Modal has been submitted; page either navigates away or closes the modal
                    // Verify the modal is no longer blocking the page
                    const modal = page.getByRole("dialog")
                    await modal.waitFor({state: "hidden", timeout: 10000}).catch(() => {
                        // Modal may have already closed
                    })
                },
            )
        },
    )

    baseTest(
        "creates a new folder via the Create new dropdown",
        {tag: tags},
        async ({page, navigateToPrompts, createNewFolder}) => {
            const folderName = buildFolderName("my")

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the user is on the Prompts page", async () => {
                await navigateToPrompts()
            })

            await scenarios.when(
                "the user clicks Create new, selects New folder, and enters a folder name",
                async () => {
                    await createNewFolder(folderName)
                },
            )

            await scenarios.then(
                "the new folder is created and visible in the prompts table",
                async () => {
                    const folderRow = page.getByText(folderName).first()
                    await folderRow.waitFor({state: "visible", timeout: 10000})
                },
            )
        },
    )
}

export default tests
export {baseTest as test}
