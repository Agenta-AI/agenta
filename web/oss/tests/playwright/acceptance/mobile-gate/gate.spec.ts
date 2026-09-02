import {expect, test} from "@playwright/test"

const IPHONE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

const gateEnabled = process.env.AGENTA_MOBILE_GATE !== "false"
const reverseGateEnabled = process.env.AGENTA_MOBILE_REVERSE_GATE !== "false"

test.describe("mobile gate: forward direction", () => {
    test.skip(!gateEnabled, "mobile gate opted out (AGENTA_MOBILE_GATE=false)")
    test.use({
        userAgent: IPHONE_UA,
        extraHTTPHeaders: {"sec-ch-ua-mobile": "?1"},
        storageState: undefined,
    })

    test("mobile UA on a desktop route lands in /m", async ({page}) => {
        await page.goto("/w")
        await expect(page).toHaveURL(/\/m\/?$/)
    })

    test("observability session deep link maps to the mobile session chat", async ({page}) => {
        await page.goto("/w/ws1/p/pr1/observability?session=abc")
        // Pre-WP4 the target 404s inside /m; the URL mapping is the contract.
        await expect(page).toHaveURL(/\/m\/w\/ws1\/p\/pr1\/sessions\/abc$/)
    })

    test("auth maps to the mobile sign-in", async ({page}) => {
        await page.goto("/auth")
        await expect(page).toHaveURL(/\/m\/auth$/)
    })

    test("?view=desktop sets the opt-out and pins the desktop site", async ({page, context}) => {
        await page.goto("/w?view=desktop")
        expect(page.url()).not.toContain("/m")
        const cookies = await context.cookies()
        expect(cookies.some((c) => c.name === "agenta-mobile-optout")).toBe(true)
        await page.goto("/w")
        expect(page.url()).not.toContain("/m")
    })
})

test.describe("mobile gate: reverse direction", () => {
    test.skip(
        !reverseGateEnabled,
        "reverse mobile gate opted out (AGENTA_MOBILE_REVERSE_GATE=false)",
    )
    test.use({storageState: undefined})

    test("desktop UA on /m is sent to the desktop app", async ({page}) => {
        await page.goto("/m/")
        expect(new URL(page.url()).pathname.startsWith("/m")).toBe(false)
    })

    test("desktop UA on a mobile session URL lands on the session drawer link", async ({page}) => {
        await page.goto("/m/w/ws1/p/pr1/sessions/abc")
        await expect(page).toHaveURL(/\/w\/ws1\/p\/pr1\/observability\?session=abc/)
    })
})
