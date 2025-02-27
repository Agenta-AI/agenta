import {test, tags} from "../../../tests/tests/app/test"
import {AppType} from "../../../tests/tests/app/types"

export const tests = () => {
    test("creates new completion prompt app", async ({
        navigateToApps,
        createNewApp,
        verifyAppCreation,
    }) => {
        await navigateToApps()

        const appName = `test-app-${Date.now()}`
        await createNewApp(appName, AppType.COMPLETION_PROMPT)

        // Verify creation
        await verifyAppCreation(appName)
    })

    test("creates new chat prompt app", async ({
        navigateToApps,
        createNewApp,
        verifyAppCreation,
    }) => {
        await navigateToApps()

        const appName = `test-app-${Date.now()}`
        await createNewApp(appName, AppType.CHAT_PROMPT)

        // Verify creation
        await verifyAppCreation(appName)
    })
}

// Tags can now be added directly to the describe block title
test.describe(`App Creation Flow ${tags}`, () => {
    tests()
})
