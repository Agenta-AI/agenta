import {
    TestCostType,
    TestCoverage,
    TestLicenseType,
    TestPath,
    TestRoleType,
    TestScope,
    TestSpeedType,
    TestLensType,
    TestcaseType,
} from "@agenta/web-tests/playwright/config/testTags"
import {expect} from "@agenta/web-tests/utils"

import {expectAuthenticatedSession} from "../utils/auth"
import {buildAcceptanceTags} from "../utils/tags"

import {test} from "./tests"

const tags = buildAcceptanceTags({
    scope: [TestScope.APPS],
    coverage: [TestCoverage.SMOKE],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.TYPICAL,
    speed: TestSpeedType.SLOW,
})

// ChatLoading in web/mobile/src/features/chat/states/ChatStates.tsx
const LOADING_SELECTOR = '[aria-label="Loading conversation"]'

const HANG_PREFIXES = [
    "/api/sessions",
    "/api/workflows",
    "/api/mounts",
    "/api/channels",
    "/api/tools",
    "/api/access",
    "/api/spans",
    "/services/",
]

const isBackendApi = (urlStr: string) => {
    try {
        const {pathname} = new URL(urlStr)

        if (pathname.startsWith("/_next/") || pathname.startsWith("/static/")) {
            return false
        }

        return HANG_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    } catch {
        return false
    }
}

test(
    "mobile session whose first message never reached the server shows loading spinner forever on reload",
    {tag: tags},
    async ({page, seedAgentChatApp, testProviderHelpers}) => {
        test.setTimeout(600000)
        page.setDefaultNavigationTimeout(300000)
        await page.setViewportSize({width: 590, height: 844})

        const t0 = Date.now()
        const lines: string[] = []

        const log = (message: string) => {
            const line = `+${String(Date.now() - t0).padStart(6)}ms  ${message}`
            lines.push(line)
            console.log(`[hang-repro] ${line}`)
        }

        const hungByPath = new Map<string, number>()

        let armed = false
        let hungTotal = 0
        let sessionId: string | undefined

        try {
            log("start")

            await expectAuthenticatedSession(page)
            await testProviderHelpers.ensureTestProvider()

            const appId = await seedAgentChatApp()
            log(`seeded agent app: ${appId}`)

            // Undo the desktop pin from global-setup so the gate lets us into /m
            const ctx = page.context()

            await ctx.clearCookies({name: "agenta-mobile-optout"})
            await ctx.clearCookies({name: "agenta-classic-mode"})

            await page.evaluate(() => {
                const uid = localStorage.getItem("agenta:onboarding:active-user-id")

                for (const k of Object.keys(localStorage)) {
                    if (uid && k.includes(uid) && /simplif|nav/i.test(k)) {
                        localStorage.removeItem(k)
                    }
                }
            })

            await page.setViewportSize({width: 390, height: 844})

            await page.goto("/m", {waitUntil: "domcontentloaded"})

            await page.waitForURL(/\/m\/w\/[^/]+\/p\/[^/]+/, {
                timeout: 120000,
            })

            const ids = page.url().match(/\/m\/w\/([^/]+)\/p\/([^/]+)/)

            expect(ids, `no /m/w/<ws>/p/<project> in ${page.url()}`).toBeTruthy()

            const [, workspaceId, projectId] = ids!

            log(`workspace=${workspaceId} project=${projectId}`)

            await page.route("**/*", async (route) => {
                const request = route.request()
                const url = request.url()
                const pathname = new URL(url).pathname

                if (!armed) {
                    await route.continue()
                    return
                }

                // The first message is sent through /invoke.
                // Capture the client-minted session ID, but do NOT
                // allow the request to reach the backend.
                if (url.includes("/invoke")) {
                    try {
                        const body = request.postDataJSON() as {
                            session_id?: string
                        }

                        sessionId = body.session_id

                        log(`invoke sessionId: ${sessionId ?? "undefined"}`)

                        if (!sessionId) {
                            log(`INVOKE BODY: ${request.postData() ?? "<empty>"}`)
                        }
                    } catch {
                        log(`could not parse invoke body: ${request.postData() ?? "<empty>"}`)
                    }

                    const count = hungByPath.get(pathname) ?? 0
                    hungByPath.set(pathname, count + 1)
                    hungTotal += 1

                    if (count === 0) {
                        log(`HUNG: ${request.method()} ${pathname}`)
                    }

                    // Intentionally neither fulfill nor abort nor continue.
                    // The invoke never reaches the backend.
                    return
                }

                // Keep all other backend APIs hanging.
                // This is important after we navigate/reload the session URL:
                // conversation hydration requests must never complete.
                if (isBackendApi(url)) {
                    const count = hungByPath.get(pathname) ?? 0
                    hungByPath.set(pathname, count + 1)
                    hungTotal += 1

                    if (count === 0) {
                        log(`HUNG: ${request.method()} ${pathname}`)
                    }

                    // Intentionally leave the request pending.
                    return
                }

                await route.continue()
            })

            // Start from the mobile app screen while the network still works.
            await page.goto(`/m/w/${workspaceId}/p/${projectId}/apps`, {
                waitUntil: "domcontentloaded",
            })

            const composer = page.getByRole("textbox").last()

            await expect(composer).toBeVisible({
                timeout: 120000,
            })

            await composer.fill("hello")

            log("message typed")

            // Arm interception immediately before the first send.
            armed = true
            log("network hang armed BEFORE first message")

            log("sending first message; /invoke will be intercepted")

            await composer.press("Enter")

            // The browser does not necessarily navigate to the session URL.
            // The session ID is client-minted and is available in the /invoke body.
            await expect
                .poll(() => sessionId, {
                    timeout: 60000,
                    message: "first /invoke request did not expose a session ID",
                })
                .toBeTruthy()

            log(`client-minted session captured: ${sessionId}`)

            const sessionUrl = `/m/w/${workspaceId}/p/${projectId}/sessions/${sessionId}`

            log(`session URL: ${sessionUrl}`)

            // The invoke request is intentionally hanging, so wait for the
            // client-side send failure UI.
            await page.waitForTimeout(60000)

            const notSent = await page.getByText(/The message was not sent\./i).isVisible()

            log(`"message was not sent" visible: ${notSent}`)

            // Navigate directly to the exact client-minted session URL.
            // There was no guaranteed browser navigation during the failed send.
            await page.goto(sessionUrl, {
                waitUntil: "domcontentloaded",
            })

            log(`opened session URL: ${page.url()}`)

            // Now perform the actual reload of that exact session URL.
            await page.reload({
                waitUntil: "domcontentloaded",
            })

            log(`reloaded: ${page.url()}`)

            const sawSkeleton = await page
                .locator(LOADING_SELECTOR)
                .first()
                .waitFor({
                    state: "visible",
                    timeout: 20000,
                })
                .then(() => true)
                .catch(() => false)

            log(`skeleton appeared after reload: ${sawSkeleton}`)

            await page.waitForTimeout(10000)

            expect(hungTotal, "no API requests were intercepted and left pending").toBeGreaterThan(
                0,
            )

            for (const [path, count] of hungByPath.entries()) {
                log(`hung ${count}x ${path}`)
            }

            await test.info().attach("screenshot-after-hang", {
                body: await page.screenshot(),
                contentType: "image/png",
            })

            await test.info().attach("body-text", {
                body: await page.locator("body").innerText(),
                contentType: "text/plain",
            })

            // THE BUG CHECK.
            //
            // Unfixed:
            //   The skeleton remains forever because the locally-created,
            //   never-accepted session is still treated as hydrating.
            //
            // Fixed:
            //   Hydration resolves and the empty composer / appropriate
            //   empty/error state is rendered.
            await expect(
                page.locator(LOADING_SELECTOR),
                "loading skeleton never resolved",
            ).toHaveCount(0, {
                timeout: 60000,
            })

            log("skeleton resolved")
        } finally {
            await test.info().attach("timeline", {
                body: lines.join("\n"),
                contentType: "text/plain",
            })
        }
    },
)
