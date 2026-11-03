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

import {sseFulfill} from "./assets/elicitationStream"
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
    async ({page, seedAgentChatApp, navigateToAgentPlayground, testProviderHelpers}) => {
        // API seeding + 2 navigations + file upload + SSE-mocked run + reload is heavier
        // than the 60s default (siblings that do less than this already bump to 120s+, #5695).
        test.setTimeout(120000)
        await expectAuthenticatedSession(page)
        await testProviderHelpers.ensureTestProvider()
        const appId = await seedAgentChatApp()
        await navigateToAgentPlayground(appId)

        let recordsApiUrl = ""
        await page.route("**/invoke*", async (route) => {
            const body = route.request().postDataJSON() as {
                session_id?: string
                data?: {
                    inputs?: {
                        messages?: {
                            parts?: Record<string, unknown>[]
                        }[]
                    }
                }
            }
            const sessionId = body.session_id
            const message = body.data?.inputs?.messages?.at(-1)
            const filePart = message?.parts?.find((part) => part.type === "file")
            const agenta = (filePart?.providerMetadata as {agenta?: Record<string, unknown>})
                ?.agenta
            const attachment = {
                attachmentId: agenta?.attachmentId,
                filename: filePart?.filename,
                mediaType: filePart?.mediaType,
                size: agenta?.size,
            }
            const turnId = `attachment-turn-${Date.now()}`

            expect(sessionId).toBeTruthy()
            expect(attachment).toMatchObject({
                attachmentId: expect.any(String),
                filename: IMAGE_NAME,
                mediaType: "image/png",
                size: IMAGE.length,
            })

            const ingestUrl = new URL(recordsApiUrl)
            const projectId = new URL(route.request().url()).searchParams.get("project_id")
            if (projectId) ingestUrl.searchParams.set("project_id", projectId)
            recordsApiUrl = ingestUrl.toString()

            const records = [
                {
                    record_index: 0,
                    record_source: "user",
                    record_type: "message",
                    attributes: {
                        type: "message",
                        text: "Describe the attached image.",
                        attachments: [attachment],
                    },
                },
                {
                    record_index: 1,
                    record_source: "agent",
                    record_type: "message",
                    attributes: {type: "message", text: "Done."},
                },
                {
                    record_index: 2,
                    record_source: "agent",
                    record_type: "done",
                    attributes: {type: "done", stopReason: "stop"},
                },
            ]
            for (const record of records) {
                const response = await page.request.post(recordsApiUrl, {
                    data: {...record, session_id: sessionId, turn_id: turnId},
                })
                expect(response.ok()).toBe(true)
            }

            const chunks = [
                {type: "start", messageId: `attachment-run-${turnId}`},
                {type: "start-step"},
                {
                    type: "data-session-accepted",
                    data: {sessionId, turnId, executionId: turnId},
                    transient: true,
                },
                {type: "finish-step"},
                {type: "finish", finishReason: "stop"},
            ]
            const stream =
                chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
                "data: [DONE]\n\n"
            await route.fulfill(sseFulfill(stream))
        })

        let contentReads = 0
        page.on("request", (request) => {
            if (new URL(request.url()).pathname.match(/\/sessions\/attachments\/[^/]+\/content$/)) {
                contentReads += 1
            }
        })

        const composer = page.getByRole("textbox").last()
        const attachButton = page.getByRole("button", {name: "Attach files"})
        await expect(attachButton).toBeEnabled()
        await attachButton.click()

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
        const uploadResponse = await uploadResponsePromise
        expect(uploadResponse.ok()).toBe(true)
        recordsApiUrl = uploadResponse
            .url()
            .replace(/\/sessions\/attachments(?:\?.*)?$/, "/sessions/records/ingest")
        await expect(page.getByAltText(IMAGE_NAME)).toBeVisible()

        const runRequestPromise = page.waitForRequest(
            (request) => request.method() === "POST" && request.url().includes("/invoke"),
        )
        await composer.fill("Describe the attached image.")
        await composer.press("Enter")

        const runRequest = await runRequestPromise
        expect(runRequest.postData() ?? "").not.toContain("data:")
        const renderedAttachment = page.locator(
            `img[alt="${IMAGE_NAME}"][src*="/sessions/attachments/"][src*="/content"]`,
        )
        await expect(renderedAttachment.last()).toBeVisible()
        await expect(renderedAttachment.last()).toHaveJSProperty("naturalWidth", 1)
        await expect.poll(() => contentReads).toBeGreaterThanOrEqual(1)
        const contentReadsBeforeReload = contentReads

        await page.reload({waitUntil: "domcontentloaded"})

        await expect(renderedAttachment.last()).toBeVisible()
        await expect(renderedAttachment.last()).toHaveJSProperty("naturalWidth", 1)
        await expect.poll(() => contentReads).toBeGreaterThan(contentReadsBeforeReload)
    },
)
