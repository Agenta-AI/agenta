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
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {buildAcceptanceTags} from "../utils/tags"

import {resumeTextTurn, sseFulfill} from "./assets/elicitationStream"
import {test} from "./tests"

const tags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.SMOKE, TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

const IMAGE_NAME = "attachment-round-trip.png"
const IMAGE = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zc1sAAAAASUVORK5CYII=",
    "base64",
)

test(
    "an uploaded attachment renders after send and after reload",
    {tag: tags},
    async ({page, seedAgentChatApp, navigateToAgentPlayground}) => {
        // API seeding + 2 navigations + file upload + SSE-mocked run + reload is heavier
        // than the 60s default (siblings that do less than this already bump to 120s+, #5695).
        test.setTimeout(120000)
        await expectAuthenticatedSession(page)
        const appId = await seedAgentChatApp()
        await navigateToAgentPlayground(appId)

        let run = 0
        await page.route("**/invoke*", async (route) => {
            run += 1
            await route.fulfill(
                sseFulfill(resumeTextTurn({messageId: `attachment-run-${run}`, text: "Done."})),
            )
        })

        let contentReads = 0
        page.on("request", (request) => {
            if (new URL(request.url()).pathname.match(/\/sessions\/attachments\/[^/]+\/content$/)) {
                contentReads += 1
            }
        })

        const composer = page.getByRole("textbox").last()
        await page.getByRole("button", {name: "Attach files"}).click()

        const uploadResponsePromise = page.waitForResponse((response) => {
            const url = new URL(response.url())
            return (
                response.request().method() === "POST" &&
                url.pathname.endsWith("/sessions/attachments") &&
                url.searchParams.has("session_id")
            )
        })
        await page.locator('input[type="file"][multiple]').last().setInputFiles({
            name: IMAGE_NAME,
            mimeType: "image/png",
            buffer: IMAGE,
        })
        expect((await uploadResponsePromise).ok()).toBe(true)
        await expect(page.getByAltText(IMAGE_NAME)).toBeVisible()

        const runRequestPromise = page.waitForRequest(
            (request) => request.method() === "POST" && request.url().includes("/invoke"),
        )
        await composer.fill("Describe the attached image.")
        await composer.press("Enter")

        const runRequest = await runRequestPromise
        expect(runRequest.postData() ?? "").not.toContain("data:")
        // FileCard (@ant-design/x) renders an image attachment as just an <img>, with the
        // filename only in `alt` — there is no separate visible text caption for images
        // (unlike the file/audio/video card types, which do render a name label).
        await expect(page.getByAltText(IMAGE_NAME).last()).toBeVisible()
        await expect.poll(() => contentReads).toBeGreaterThanOrEqual(1)

        await page.reload({waitUntil: "domcontentloaded"})

        await expect(page.getByAltText(IMAGE_NAME).last()).toBeVisible()
        await expect.poll(() => contentReads).toBeGreaterThanOrEqual(2)
    },
)
