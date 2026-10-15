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

import {test} from "./tests"

const tags = buildAcceptanceTags({
    scope: [TestScope.PLAYGROUND],
    coverage: [TestCoverage.LIGHT, TestCoverage.FULL],
    path: TestPath.HAPPY,
    lens: TestLensType.FUNCTIONAL,
    cost: TestCostType.Free,
    license: TestLicenseType.OSS,
    role: TestRoleType.Owner,
    caseType: TestcaseType.EDGE,
    speed: TestSpeedType.SLOW,
})

// ChatLoading in web/mobile/src/features/chat/states/ChatStates.tsx
const LOADING_SELECTOR = '[aria-label="Loading conversation"]'
const SESSION_URL = /\/m\/w\/([^/]+)\/p\/([^/]+)\/sessions\/([^/?#]+)/
const PROJECT_URL = /\/m\/w\/([^/]+)\/p\/([^/]+)/

// What the fixed UI must show instead of the skeleton: a failure state with a retry action.
// Adjust the name if the component's button label differs.
const RETRY_BUTTON = /retry|try again/i

const isApiLike = (urlStr: string) => {
    try {
        const {pathname} = new URL(urlStr)
        return pathname.startsWith("/api/") || pathname.startsWith("/services/")
    } catch {
        return false
    }
}

test(
    "a mobile session whose first message never reached the server must not spin forever",
    {tag: tags},
    async ({page, seedAgentChatApp, testProviderHelpers}) => {
        test.setTimeout(300000)
        page.setDefaultNavigationTimeout(120000)

        const t0 = Date.now()
        const lines: string[] = []
        const log = (message: string) => {
            const line = `+${String(Date.now() - t0).padStart(6)}ms  ${message}`
            lines.push(line)
            console.log(`[hang-repro] ${line}`)
        }

        // "open": everything passes through.
        // "hang-send": only /services/* (the invoke) is swallowed, so the page can still navigate.
        // "hang-all": every API request is swallowed (never continued or aborted = hang, not fail).
        let mode: "open" | "hang-send" | "hang-all" = "open"
        let hungTotal = 0
        const hungByPath = new Map<string, number>()

        try {
            log("start")

            await expectAuthenticatedSession(page)
            await testProviderHelpers.ensureTestProvider() // desktop viewport still
            const appId = await seedAgentChatApp()
            log(`seeded agent app: ${appId}`)

            // Undo the desktop pin from global-setup so the gate lets us into /m
            const ctx = page.context()
            await ctx.clearCookies({name: "agenta-mobile-optout"})
            await ctx.clearCookies({name: "agenta-classic-mode"})
            await page.evaluate(() => {
                const uid = localStorage.getItem("agenta:onboarding:active-user-id")
                for (const k of Object.keys(localStorage)) {
                    if (uid && k.includes(uid) && /simplif|nav/i.test(k)) localStorage.removeItem(k)
                }
            })
            await page.setViewportSize({width: 390, height: 844})

            // Installed once; behaviour is switched by `mode` so handlers never stack.
            await page.route("**/*", async (route) => {
                const url = route.request().url()
                const {pathname} = new URL(url)
                const hang =
                    isApiLike(url) &&
                    (mode === "hang-all" ||
                        (mode === "hang-send" && pathname.startsWith("/services/")))
                if (hang) {
                    hungTotal++
                    hungByPath.set(pathname, (hungByPath.get(pathname) ?? 0) + 1)
                    log(`HUNG (${mode}) ${pathname}`)
                    return // never continue/abort: the request hangs
                }
                await route.continue()
            })

            // 1. Land on the mobile Home composer while the network still works.
            await page.goto("/m", {waitUntil: "domcontentloaded"})
            await page.waitForURL(PROJECT_URL, {timeout: 120000})
            log(`landed on ${page.url()}`)

            const composer = page.getByRole("textbox").last()
            await expect(composer).toBeVisible({timeout: 120000})
            await composer.click()
            await composer.pressSequentially("hello", {delay: 30})
            log("message typed")

            // The composer only enables send once the editor state has the text.
            const send = page.getByRole("button", {name: /send/i}).last()
            await expect(send, "send never enabled: editor did not register the text").toBeEnabled({
                timeout: 30000,
            })

            // 2. Swallow only the send, then click. The page can still load and navigate.
            mode = "hang-send"
            log("send hang armed")
            const sendStart = Date.now()
            await send.click()

            try {
                await page.waitForURL(SESSION_URL, {timeout: 60000})
            } catch (error) {
                log(`NO REDIRECT. url=${page.url()} hung=${[...hungByPath.keys()].join(", ")}`)
                log(
                    `buttons: ${JSON.stringify(
                        await page
                            .getByRole("button")
                            .evaluateAll((els) =>
                                els.map(
                                    (e) =>
                                        `${e.getAttribute("aria-label") ?? e.textContent?.trim()}${
                                            (e as HTMLButtonElement).disabled ? " [disabled]" : ""
                                        }`,
                                ),
                            ),
                    )}`,
                )
                throw error
            }
            log(`redirected after ${Date.now() - sendStart}ms`)

            const sessionMatch = page.url().match(SESSION_URL)
            expect(sessionMatch, `no session id in ${page.url()}`).toBeTruthy()
            const sessionId = sessionMatch![3]
            log(`session ${sessionId}`)

            // Proof the first message never reached the server: the invoke was attempted and swallowed.
            await expect
                .poll(() => [...hungByPath.keys()].some((p) => p.startsWith("/services/")), {
                    message: "the first send never reached the network",
                    timeout: 60000,
                })
                .toBe(true)
            log("first send is hanging")

            // 3. Now cut everything and reload that session URL.
            mode = "hang-all"
            hungByPath.clear()
            hungTotal = 0
            await page.reload({waitUntil: "domcontentloaded"})
            log(`reloaded: ${page.url()}`)

            const sawSkeleton = await page
                .locator(LOADING_SELECTOR)
                .first()
                .waitFor({state: "visible", timeout: 20000})
                .then(() => true)
                .catch(() => false)
            log(`skeleton appeared after reload: ${sawSkeleton}`)
            expect(
                sawSkeleton,
                "reload never showed the loading skeleton; repro is not valid",
            ).toBe(true)

            // Let the app issue its load requests, then record which ones are stuck.
            await page.waitForTimeout(5000)
            expect(hungTotal, "no API requests were intercepted after reload").toBeGreaterThan(0)
            for (const [path, count] of hungByPath.entries()) {
                log(`hung ${count}x ${path}`)
            }

            // Diagnostics BEFORE the bug check, so a failing run still reports what was on screen.
            await page.waitForTimeout(15000)
            log(`skeleton count at +20s: ${await page.locator(LOADING_SELECTOR).count()}`)
            log(
                `read-only text visible: ${await page
                    .getByText(/Read-only/i)
                    .first()
                    .isVisible()
                    .catch(() => false)}`,
            )
            log(`pending hung: ${[...hungByPath.keys()].join(", ")}`)

            await test.info().attach("screenshot-after-hang", {
                body: await page.screenshot(),
                contentType: "image/png",
            })

            // THE BUG CHECK.
            // Unfixed code: the skeleton stays forever, so both assertions FAIL.
            // Fixed code: a failure state with a retry action replaces the skeleton, so it PASSES.
            await expect(
                page.getByRole("button", {name: RETRY_BUTTON}).first(),
                "no failure state with retry appeared while the server hangs",
            ).toBeVisible({timeout: 60000})
            await expect(
                page.locator(LOADING_SELECTOR),
                "loading skeleton never resolved while the server hangs",
            ).toHaveCount(0)

            await test.info().attach("screenshot-resolved", {
                body: await page.screenshot(),
                contentType: "image/png",
            })
            await test.info().attach("body-text", {
                body: await page.locator("body").innerText(),
                contentType: "text/plain",
            })

            log("skeleton resolved")
        } finally {
            await test.info().attach("timeline", {
                body: lines.join("\n"),
                contentType: "text/plain",
            })
            // Release intercepted requests so teardown does not error on pending routes.
            await page.unrouteAll({behavior: "ignoreErrors"}).catch(() => undefined)
        }
    },
)
