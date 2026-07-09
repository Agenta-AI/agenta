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
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

import {ELICITATION_PAYLOAD} from "./assets/elicitationStream"
import {test as baseAgentChatTest} from "./tests"

const scenarios = createScenarios(baseAgentChatTest)

const sharedTags = {
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
}

const elicitationTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    ...sharedTags,
})

const agentChatTests = () => {
    // ── Spec 1: round-trip (mock-only; no reload) ──────────────────────────────────────────────
    baseAgentChatTest(
        "Elicitation round-trip: form renders, accept resumes with the submitted values",
        {tag: elicitationTags},
        async ({
            page,
            seedAgentChatApp,
            navigateToAgentPlayground,
            mockElicitationInvoke,
            sendChatMessage,
        }) => {
            baseAgentChatTest.setTimeout(120000)
            let appId = ""
            let mock!: Awaited<ReturnType<typeof mockElicitationInvoke>>

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("a rendered agent app is open in the playground", async () => {
                appId = await seedAgentChatApp()
                await navigateToAgentPlayground(appId)
            })

            await scenarios.and("the agent run is mocked to request input", async () => {
                mock = await mockElicitationInvoke()
                mock.setResumeText("First Name: Ada · Favorite Color: green")
            })

            await scenarios.when("the user sends a message", async () => {
                await sendChatMessage("hi")
            })

            await scenarios.then(
                "the elicitation form renders (not JSON, not the apology)",
                async () => {
                    await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible({
                        timeout: 30000,
                    })
                    await expect(page.getByText(/Asked by .*request_input/)).toBeVisible()
                    await expect(
                        page.getByRole("button", {name: "Accept", exact: true}),
                    ).toBeVisible()
                },
            )

            await scenarios.and("the user fills the required field and accepts", async () => {
                // First-run: confirm the field locator against the live SchemaForm DOM
                // (labels above fields; key by the schema `title`).
                await page.getByLabel("First Name").fill("Ada")
                await page.getByRole("button", {name: "Accept", exact: true}).click()
            })

            await scenarios.then("the run resumes with the submitted values", async () => {
                await expect(page.getByText("Provided the requested input.")).toBeVisible({
                    timeout: 30000,
                })
                await expect(page.getByText("First Name: Ada")).toBeVisible()
                // The resume POST carried the settled output back through the same /invoke path.
                expect(mock.calls.length).toBeGreaterThanOrEqual(2)
                expect(JSON.stringify(mock.calls[1] ?? {})).toContain("Ada")
            })
        },
    )

    // ── Spec 2: required-field gate (mock-only; regression) ─────────────────────────────────────
    baseAgentChatTest(
        "Elicitation required-field gate: empty Accept shows an inline error and does not resume",
        {tag: elicitationTags},
        async ({
            page,
            seedAgentChatApp,
            navigateToAgentPlayground,
            mockElicitationInvoke,
            sendChatMessage,
        }) => {
            baseAgentChatTest.setTimeout(120000)

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            let mock!: Awaited<ReturnType<typeof mockElicitationInvoke>>
            await scenarios.and("a mocked elicitation run is open", async () => {
                const appId = await seedAgentChatApp()
                await navigateToAgentPlayground(appId)
                mock = await mockElicitationInvoke()
            })

            await scenarios.when(
                "the user sends a message and accepts with an empty required field",
                async () => {
                    await sendChatMessage("hi")
                    await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible({
                        timeout: 30000,
                    })
                    await page.getByRole("button", {name: "Accept", exact: true}).click()
                },
            )

            await scenarios.then("the form stays and the run does not resume", async () => {
                await expect(page.getByText(/required/i)).toBeVisible()
                await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible()
                // No auto-resume fired: only the initial run POST was made.
                expect(mock.calls.length).toBe(1)
            })
        },
    )

    // ── Spec 3: settled-state replay after reload ───────────────────────────────────────────────
    // NOTE (first-run): reload rehydration source is the open question for the mock approach. A
    // real run records a server-side session transcript; a MOCKED run does not. If reload rehydrates
    // the chat from client persistence, this passes as-is; if it loads from the server transcript,
    // the mock must also seed/serve the session history (add a route for the history endpoint). Do
    // NOT assume — confirm on first run and adjust.
    baseAgentChatTest(
        "Elicitation settled replay: after accept, a reload shows the read-only chip (no live form)",
        {tag: elicitationTags},
        async ({
            page,
            seedAgentChatApp,
            navigateToAgentPlayground,
            mockElicitationInvoke,
            sendChatMessage,
        }) => {
            baseAgentChatTest.setTimeout(120000)

            await expectAuthenticatedSession(page)
            const appId = await seedAgentChatApp()
            await navigateToAgentPlayground(appId)
            const mock = await mockElicitationInvoke()
            mock.setResumeText("Recorded.")

            await sendChatMessage("hi")
            await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible({timeout: 30000})
            await page.getByLabel("First Name").fill("Ada")
            await page.getByRole("button", {name: "Accept", exact: true}).click()
            await expect(page.getByText("Provided the requested input.")).toBeVisible({
                timeout: 30000,
            })

            await scenarios.when("the user reloads the page", async () => {
                await page.reload({waitUntil: "domcontentloaded"})
            })

            await scenarios.then("the settled chip replays read-only", async () => {
                await expect(page.getByText("Provided the requested input.")).toBeVisible({
                    timeout: 30000,
                })
                await expect(page.getByRole("button", {name: "Accept", exact: true})).toHaveCount(0)
            })
        },
    )

    // ── Spec 4: reload-while-PENDING then accept (design's riskiest transition) ──────────────────
    // Same reload-rehydration caveat as spec 3 — but here the form is PENDING (pre-settle), which the
    // design states replays from localStorage before the server store. Confirm the source on first run.
    baseAgentChatTest(
        "Elicitation reload-while-pending: the live form re-renders and still accepts",
        {tag: elicitationTags},
        async ({
            page,
            seedAgentChatApp,
            navigateToAgentPlayground,
            mockElicitationInvoke,
            sendChatMessage,
        }) => {
            baseAgentChatTest.setTimeout(120000)

            await expectAuthenticatedSession(page)
            const appId = await seedAgentChatApp()
            await navigateToAgentPlayground(appId)
            const mock = await mockElicitationInvoke()
            mock.setResumeText("First Name: Ada")

            await sendChatMessage("hi")
            await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible({timeout: 30000})

            await scenarios.when("the user reloads while the form is pending", async () => {
                await page.reload({waitUntil: "domcontentloaded"})
            })

            await scenarios.then("the live form re-renders and accept resumes", async () => {
                await expect(page.getByText(ELICITATION_PAYLOAD.message)).toBeVisible({
                    timeout: 30000,
                })
                await page.getByLabel("First Name").fill("Ada")
                await page.getByRole("button", {name: "Accept", exact: true}).click()
                await expect(page.getByText("Provided the requested input.")).toBeVisible({
                    timeout: 30000,
                })
                await expect(page.getByText("First Name: Ada")).toBeVisible()
            })
        },
    )
}

export default agentChatTests
