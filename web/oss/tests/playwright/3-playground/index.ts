import {COMPLETION_MESSAGES, NEW_VARIABLES, PROMPT_MESSAGES} from "./assets/constants"
import {test as basePlaygroundTest} from "./tests"

import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"

const playgroundTests = () => {
    ;((basePlaygroundTest(
        "Should run single view variant for completion",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("scope", TestScope.OBSERVABILITY),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({apiHelpers, navigateToPlayground, runCompletionSingleViewVariant}) => {
            const app = await apiHelpers.getApp("completion")
            const appId = app.app_id

            await navigateToPlayground(appId)

            await runCompletionSingleViewVariant(appId, COMPLETION_MESSAGES)
        },
    ),
    basePlaygroundTest(
        "Should run single view variant for chat",
        {
            tag: [
                createTagString("scope", TestScope.PLAYGROUND),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({apiHelpers, navigateToPlayground, runChatSingleViewVariant}) => {
            const app = await apiHelpers.getApp("chat")
            const appId = app.app_id

            await navigateToPlayground(appId)

            await runChatSingleViewVariant(appId, COMPLETION_MESSAGES)
        },
    )),
        basePlaygroundTest(
            "Should update the prompt and save the changes",
            {
                tag: [
                    createTagString("scope", TestScope.PLAYGROUND),
                    createTagString("coverage", TestCoverage.SMOKE),
                    createTagString("coverage", TestCoverage.LIGHT),
                    createTagString("coverage", TestCoverage.FULL),
                    createTagString("path", TestPath.HAPPY),
                ],
            },
            async ({
                apiHelpers,
                navigateToPlayground,
                addNewPrompt,
                changeVariableKeys,
                saveVariant,
            }) => {
                // 1. get the app
                const app = await apiHelpers.getApp("completion")
                const appId = app.app_id

                // 2. navigate to playground
                await navigateToPlayground(appId)

                // 3. add new prompts
                await addNewPrompt(PROMPT_MESSAGES)

                // 4. change variable keys
                await changeVariableKeys(NEW_VARIABLES)

                // 5. save variant
                await saveVariant("version")
            },
        ))
}

export default playgroundTests
