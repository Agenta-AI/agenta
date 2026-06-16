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

import {COMPLETION_MESSAGES} from "../playground/assets/constants"
import {test as basePlaygroundTest} from "../playground/tests"
import {expectAuthenticatedSession} from "../utils/auth"
import {createScenarios} from "../utils/scenarios"
import {buildAcceptanceTags} from "../utils/tags"

const scenarios = createScenarios(basePlaygroundTest)

const onboardingEventTags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    speed: TestSpeedType.SLOW,
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
})

/**
 * Reads the scoped onboarding widget-events store from localStorage and reports whether the
 * given event id has been recorded. The store is keyed per user as
 * `agenta:onboarding:{userId}:widget-events`; we scan for that key so the assertion does not
 * depend on knowing the userId in the test.
 */
const hasRecordedWidgetEvent = (eventId: string) =>
    `(() => {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && /^agenta:onboarding:.+:widget-events$/.test(key)) {
                try {
                    const value = JSON.parse(localStorage.getItem(key) || "{}")
                    if (value && typeof value === "object" && ${JSON.stringify(eventId)} in value) {
                        return true
                    }
                } catch (_e) {
                    // ignore malformed entries
                }
            }
        }
        return false
    })()`

const onboardingTests = () => {
    basePlaygroundTest(
        "Should record the playground_ran_prompt onboarding event when a chat variant runs",
        {tag: onboardingEventTags},
        async ({
            page,
            apiHelpers,
            navigateToPlayground,
            runChatSingleViewVariant,
            testProviderHelpers,
        }) => {
            basePlaygroundTest.setTimeout(120000)
            let appId = ""

            await scenarios.given("the user is authenticated", async () => {
                await expectAuthenticatedSession(page)
            })

            await scenarios.and("the active project has a configured test provider", async () => {
                await testProviderHelpers.ensureTestProvider()
            })

            await scenarios.and("the user is on the playground for a chat app", async () => {
                const app = await apiHelpers.getApp("chat")
                appId = app.id
                await navigateToPlayground(appId)
            })

            await scenarios.when("the user runs the chat variant", async () => {
                await runChatSingleViewVariant(appId, COMPLETION_MESSAGES)
            })

            await scenarios.then(
                "the onboarding widget records the playground_ran_prompt event (fired by the playground-ui ControlsBar via @agenta/onboarding/state)",
                async () => {
                    await expect
                        .poll(
                            async () =>
                                page.evaluate(hasRecordedWidgetEvent("playground_ran_prompt")),
                            {
                                timeout: 15000,
                                message:
                                    "expected playground_ran_prompt to be recorded in the onboarding widget-events store after a chat run",
                            },
                        )
                        .toBe(true)
                },
            )
        },
    )
}

export default onboardingTests
