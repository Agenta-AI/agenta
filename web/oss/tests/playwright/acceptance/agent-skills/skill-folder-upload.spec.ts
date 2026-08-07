import {
    TestCostType,
    TestCoverage,
    TestLensType,
    TestLicenseType,
    TestPath,
    TestRoleType,
    TestScope,
    TestSpeedType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"
import {test as baseTest} from "@agenta/web-tests/tests/fixtures/base.fixture"
import {getProjectScopedBasePath} from "@agenta/web-tests/tests/fixtures/base.fixture/apiHelpers"
import {expect} from "@agenta/web-tests/utils"
import type {Page} from "@playwright/test"
import {strToU8, zipSync} from "fflate"

import {
    AGENT_APPS_UNAVAILABLE_REASON,
    archiveWorkflow,
    queryWorkflowAgentState,
    resolveApiBase,
} from "../utils/agentApps"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const test = baseTest.extend<{
    registerAgentAppForCleanup: (appId: string) => void
}>({
    registerAgentAppForCleanup: async ({apiHelpers}, use) => {
        let appId: string | undefined
        await use((createdAppId) => {
            appId = createdAppId
        })
        if (appId) {
            await apiHelpers.archiveApp(appId)
        }
    },
})

const scenarios = createScenarios(test)

const tags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const SKILL_NAME = "e2e-upload-skill"
const FOLDED_DESCRIPTION =
    "Runs the end-to-end upload scenario for bundled skill files and checks the folded description."
const ALPHA_MARKER = "ALPHA_MARKER_e2e_alpha_resource"
const BETA_MARKER = "BETA_MARKER_e2e_beta_resource"

/** SKILL.md with a folded `>-` description spanning two source lines (the #5541 repro). */
const SKILL_MARKDOWN = [
    "---",
    `name: ${SKILL_NAME}`,
    "description: >-",
    "  Runs the end-to-end upload scenario for bundled skill files",
    "  and checks the folded description.",
    "---",
    "# E2E upload skill",
    "",
    "Body used by the skill-folder-upload acceptance test.",
    "",
].join("\n")

const ALPHA_CONTENT = `# Alpha resource\n\n${ALPHA_MARKER}\n`
const BETA_CONTENT = `print("${BETA_MARKER}")\n`

/** The whole package as one in-memory zip, the only multi-file shape the file input accepts. */
const buildSkillZip = (): Buffer =>
    Buffer.from(
        zipSync({
            [`${SKILL_NAME}/SKILL.md`]: strToU8(SKILL_MARKDOWN),
            [`${SKILL_NAME}/resources/alpha.md`]: strToU8(ALPHA_CONTENT),
            [`${SKILL_NAME}/resources/beta.py`]: strToU8(BETA_CONTENT),
        }),
    )

/** The open skill config drawer (create or edit), identified by its Form/JSON view toggle. */
const skillDrawer = (page: Page) =>
    page
        .getByRole("dialog")
        .filter({has: page.getByText("Form", {exact: true})})
        .last()

/** The bundled-file code editor inside the drawer (the only contenteditable in the file branch). */
const fileEditor = (page: Page) => skillDrawer(page).locator('[contenteditable="true"]').last()

const escapeForRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Select a file row by its visible label (row a11y names can append the remove control's label). */
const selectBundledFile = async (page: Page, label: string) => {
    await skillDrawer(page)
        .getByRole("button", {name: new RegExp(escapeForRegExp(label))})
        .first()
        .click()
}

test(
    "uploading a skill package parses the folded description and keeps bundled files isolated",
    {tag: tags},
    async ({page, uiHelpers, registerAgentAppForCleanup}) => {
        const appName = `e2e-skill-upload-${Date.now()}`
        const descriptionField = () =>
            skillDrawer(page).getByPlaceholder("When the agent should reach for this skill")

        await scenarios.given("the user is authenticated", async () => {
            await expectAuthenticatedSession(page)
        })

        await scenarios.and("the user creates a new agent app", async () => {
            const basePath = getProjectScopedBasePath(page)
            await page.goto(`${basePath}/prompts`, {waitUntil: "domcontentloaded"})
            await expect(page.getByRole("heading", {name: "Prompts"}).first()).toBeVisible({
                timeout: 15000,
            })

            // "Create new" → hover "New prompt" (antd submenu opens on hover) → "Agent".
            await page.getByTestId("prompts-create-new-trigger").first().click()
            const newPromptMenuItem = page.getByTestId("prompts-new-prompt-menu-item").first()
            await expect(newPromptMenuItem).toBeVisible({timeout: 5000})
            await newPromptMenuItem.hover()
            await page.getByRole("menuitem", {name: "Agent", exact: true}).click()

            const appCreateDrawer = page
                .getByRole("dialog")
                .filter({has: page.getByTestId("app-create-name-input")})
                .last()
            const nameInput = page.getByTestId("app-create-name-input").first()
            await expect(nameInput).toBeVisible({timeout: 15000})
            await nameInput.fill(appName)
            await nameInput.blur()

            const createResponsePromise = page.waitForResponse(
                (response) =>
                    response.url().includes("/workflows") &&
                    response.request().method() === "POST" &&
                    (response.request().postData() ?? "").includes(appName),
                {timeout: 90000},
            )
            await uiHelpers.clickButton("Create", appCreateDrawer)
            const confirmModal = page
                .locator(".ant-modal-wrap")
                .filter({has: page.getByRole("button", {name: "Create", exact: true})})
                .last()
            await expect(confirmModal).toBeVisible({timeout: 15000})
            await confirmModal.getByRole("button", {name: "Create", exact: true}).click()

            const createResponse = await createResponsePromise
            expect(createResponse.ok()).toBe(true)
            const created = (await createResponse.json()) as {workflow: {id: string}}
            registerAgentAppForCleanup(created.workflow.id)

            // Environments without the agent platform (e.g. OSS previews with the feature
            // flags off) silently create a prompt-type app here, so the Skills UI under test
            // can never render. Skip only on that definitive signal — and archive the app
            // first so the misclassified leftover cannot pollute other specs' app lists.
            const projectId = basePath.match(/\/p\/([^/]+)/)?.[1] ?? ""
            const apiBase = resolveApiBase(page)
            const agentState = projectId
                ? await queryWorkflowAgentState(page, apiBase, projectId, created.workflow.id)
                : "unknown"
            if (agentState === "not-agent") {
                await archiveWorkflow(page, apiBase, projectId, created.workflow.id)
            }
            test.skip(agentState === "not-agent", AGENT_APPS_UNAVAILABLE_REASON)

            await page.goto(
                `${getProjectScopedBasePath(page)}/apps/${created.workflow.id}/playground`,
                {waitUntil: "domcontentloaded"},
            )
            await expect(page.getByText("Skills", {exact: true}).first()).toBeVisible({
                timeout: 30000,
            })
        })

        await scenarios.and("the user opens the new-skill drawer", async () => {
            const addSkillLink = page.getByRole("button", {name: "add a skill", exact: true})
            if (!(await addSkillLink.isVisible())) {
                await page.getByRole("button", {name: /^Skills\b/}).click()
            }
            await expect(addSkillLink).toBeVisible({timeout: 5000})
            await addSkillLink.click()
            await expect(skillDrawer(page)).toBeVisible({timeout: 10000})
        })

        await scenarios.when("the user uploads the skill package zip", async () => {
            await skillDrawer(page)
                .locator('input[type="file"]')
                .setInputFiles({
                    name: `${SKILL_NAME}.zip`,
                    mimeType: "application/zip",
                    buffer: buildSkillZip(),
                })
        })

        await scenarios.then("the Description field holds the folded description", async () => {
            await expect(descriptionField()).toHaveValue(FOLDED_DESCRIPTION, {timeout: 10000})
        })

        await scenarios.and("each bundled file shows only its own content", async () => {
            await selectBundledFile(page, "resources/alpha.md")
            await expect(fileEditor(page)).toContainText(ALPHA_MARKER, {timeout: 10000})
            await expect(fileEditor(page)).not.toContainText(BETA_MARKER)

            await selectBundledFile(page, "resources/beta.py")
            await expect(fileEditor(page)).toContainText(BETA_MARKER, {timeout: 10000})
            await expect(fileEditor(page)).not.toContainText(ALPHA_MARKER)
        })

        await scenarios.and("an edit followed by an immediate file switch stays put", async () => {
            await selectBundledFile(page, "resources/alpha.md")
            await expect(fileEditor(page)).toContainText(ALPHA_MARKER, {timeout: 10000})
            await fileEditor(page).click()
            await page.keyboard.press("ControlOrMeta+End")
            await page.keyboard.type(" alpha edit")
            // Switch immediately: with debounce this is what dropped/moved the keystrokes.
            await selectBundledFile(page, "resources/beta.py")
            await expect(fileEditor(page)).toContainText(BETA_MARKER, {timeout: 10000})
            await expect(fileEditor(page)).not.toContainText("alpha edit")

            await selectBundledFile(page, "resources/alpha.md")
            await expect(fileEditor(page)).toContainText("alpha edit", {timeout: 10000})
        })

        await scenarios.and("the saved skill reopens with the same content", async () => {
            await skillDrawer(page).getByRole("button", {name: "Create", exact: true}).click()
            await expect(skillDrawer(page)).toBeHidden({timeout: 10000})

            // The committed skill is listed in the Skills section; reopen it.
            await page
                .getByRole("button", {name: new RegExp(escapeForRegExp(SKILL_NAME))})
                .first()
                .click()
            await expect(skillDrawer(page)).toBeVisible({timeout: 10000})

            await expect(descriptionField()).toHaveValue(FOLDED_DESCRIPTION, {timeout: 10000})
            await selectBundledFile(page, "resources/alpha.md")
            await expect(fileEditor(page)).toContainText("alpha edit", {timeout: 10000})
            await expect(fileEditor(page)).not.toContainText(BETA_MARKER)
            await selectBundledFile(page, "resources/beta.py")
            await expect(fileEditor(page)).toContainText(BETA_MARKER, {timeout: 10000})
            await expect(fileEditor(page)).not.toContainText("alpha edit")
        })
    },
)
