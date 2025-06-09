import {test as baseTest, tags as _tags} from "./test"
import {AppType} from "./types"

export const tags = _tags
export {baseTest as test}

const tests = () => {
    baseTest(
        `creates new completion prompt app`,
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
