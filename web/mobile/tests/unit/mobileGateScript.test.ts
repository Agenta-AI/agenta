import {describe, expect, it} from "vitest"

import {mobileGateScript} from "../../src/lib/mobileGateScript"

/** Runs the inline script against a fake page and returns where it sent the browser, if anywhere. */
const run = (href: string, cookie = "", storage = new Map<string, string>(), framed = false) => {
    const url = new URL(href, "http://localhost:3000")
    let replaced: string | null = null
    const location = {
        pathname: url.pathname,
        search: url.search,
        hash: url.hash,
        replace: (to: string) => {
            replaced = to
        },
    }
    const sessionStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
    }
    const window: {top: unknown} = {top: null}
    window.top = framed ? {} : window
    new Function("window", "location", "document", "sessionStorage", mobileGateScript)(
        window,
        location,
        {cookie},
        sessionStorage,
    )
    return replaced
}

const CLASSIC = "agenta-classic-mode=1"

describe("mobileGateScript", () => {
    it("leaves an in-app page alone without Classic mode or ?view", () => {
        expect(run("/m/w/ws1/p/pr1/apps")).toBeNull()
        expect(run("/m/w/ws1/p/pr1/apps", "agenta-classic-mode=0")).toBeNull()
    })

    it("sends a Classic-mode-on load of an in-app page to the gate", () => {
        expect(run("/m/w/ws1/p/pr1/sessions/abc?agent=a", `x=1; ${CLASSIC}`)).toBe(
            `/m/__gate?to=${encodeURIComponent("/w/ws1/p/pr1/sessions/abc?agent=a")}`,
        )
    })

    it("sends ?view=mobile to the gate", () => {
        expect(run("/m/w/ws1/p/pr1/apps?view=mobile")).toBe(
            `/m/__gate?to=${encodeURIComponent("/w/ws1/p/pr1/apps?view=mobile")}`,
        )
    })

    it("stays when the user opted in", () => {
        expect(run("/m/w/ws1/p/pr1/apps", `${CLASSIC}; agenta-mobile-optin=1`)).toBeNull()
    })

    it("leaves the routes the proxy still matches to the proxy", () => {
        for (const path of ["/m", "/m/", "/m/auth", "/m/auth/callback/google", "/m/invite"]) {
            expect(run(path, CLASSIC)).toBeNull()
        }
    })

    it("keeps the hash for the trip back", () => {
        expect(run("/m/w/ws1/p/pr1/apps?view=mobile#files")).toBe(
            `/m/__gate?to=${encodeURIComponent("/w/ws1/p/pr1/apps?view=mobile")}#files`,
        )
    })

    it("leaves a framed load (an embed) alone", () => {
        expect(run("/m/embed/abc", CLASSIC, new Map(), true)).toBeNull()
    })

    it("does not loop when the gate sends the page straight back", () => {
        const storage = new Map<string, string>()
        expect(run("/m/w/ws1/p/pr1/apps", CLASSIC, storage)).not.toBeNull()
        expect(run("/m/w/ws1/p/pr1/apps", CLASSIC, storage)).toBeNull()
    })
})
