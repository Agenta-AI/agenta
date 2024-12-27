/**
 * App Creation Flow Tests
 *
 * This test verifies that cloud authentication is required before accessing the app.
 * Flow:
 * 1. Attempt to access /app directly
 * 2. Get redirected to auth
 * 3. Complete authentication
 * 4. Successfully reach app page
 */

import {test, expect} from "../fixtures/loginWithEmail.fixture"
import {
    TestScope,
    TestCoverage,
    TestPath,
    TestFeatureScope,
    createTagString,
} from "../../playwright/config/testTags"

test.describe("App Creation", () => {
    test(
        "requires authentication before accessing app",
        {
            tag: [
                // Identify test categories
                createTagString("scope", TestScope.AUTH),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("path", TestPath.HAPPY),
                // Mark as cloud-only feature since it requires authentication
                createTagString("feature-scope", TestFeatureScope.CLOUD_ONLY),
            ],
        },
        async ({page, loginWithEmail}) => {
            // Try accessing app without auth
            await page.goto("/app")
            await expect(page).toHaveURL(/auth/)

            // Complete authentication
            await loginWithEmail()

            // Verify successful redirection to app
            await expect(page).toHaveURL(/app/)
        },
    )
})
