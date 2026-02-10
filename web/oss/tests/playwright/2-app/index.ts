import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {AppType} from "./assets/types"
import {test as baseTest} from "./test"

const tag = [
    createTagString("scope", TestScope.APPS),
    createTagString("scope", TestScope.PLAYGROUND), //This is important for the playground tests
    createTagString("scope", TestScope.EVALUATIONS),
    createTagString("scope", TestScope.DEPLOYMENT),
    createTagString("scope", TestScope.OBSERVABILITY),
    createTagString("coverage", TestCoverage.SMOKE),
    createTagString("coverage", TestCoverage.LIGHT),
    createTagString("path", TestPath.HAPPY),
]

const tests = () => {
    baseTest(
        `creates new completion prompt app`,
        {tag},
        async ({navigateToApps, createNewApp, verifyAppCreation}) => {
            await navigateToApps()

            const appName = `test-app-${Date.now()}`
            await createNewApp(appName, AppType.COMPLETION_PROMPT)

            // Verify creation
            await verifyAppCreation(appName)
        },
    )

    baseTest(
        `creates new chat prompt app`,
        {tag},
        async ({navigateToApps, createNewApp, verifyAppCreation}) => {
            await navigateToApps()

            const appName = `test-app-${Date.now()}`
            await createNewApp(appName, AppType.CHAT_PROMPT)

            // Verify creation
            await verifyAppCreation(appName)
        },
    )
}

export default tests
export {baseTest as test}
