import {describe, expect, it} from "vitest"

import {
    GATE_COOKIE_MAX_AGE,
    MOBILE_OPTIN_COOKIE,
    MOBILE_OPTOUT_COOKIE,
    decideDesktopGate,
    decideMobileGate,
    isDocumentNavigation,
    isMobileDevice,
    mapDesktopToMobile,
    mapMobileToDesktop,
    type GateInput,
} from "../../src/utils/mobileGate"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const input = (overrides: Partial<GateInput> & {headers?: Record<string, string>}): GateInput => {
    const {headers = {}, ...rest} = overrides
    const cookies: Record<string, string> = {}
    return {
        pathname: "/w",
        search: "",
        method: "GET",
        header: (name) => headers[name.toLowerCase()] ?? null,
        cookie: (name) => cookies[name],
        gateEnabled: true,
        ...rest,
    }
}

const docHeaders = (ua: string, extra: Record<string, string> = {}) => ({
    "user-agent": ua,
    "sec-fetch-dest": "document",
    ...extra,
})

describe("isMobileDevice", () => {
    it("leaves a token-bearing auth link on desktop", () => {
        // SuperTokens password-reset and invite links carry a one-time ?token=. Redirecting
        // drops it twice over: mapDesktopToMobile returns a bare /m/auth, and mobile has no
        // screen that consumes a token.
        for (const pathname of ["/auth", "/auth/reset-password"]) {
            expect(
                decideDesktopGate(
                    input({pathname, search: "?token=abc123", headers: docHeaders(MOBILE_UA)}),
                ),
            ).toEqual({kind: "pass"})
        }
    })

    it("still redirects a plain auth link with no token", () => {
        expect(
            decideDesktopGate(input({pathname: "/auth", headers: docHeaders(MOBILE_UA)})),
        ).toEqual({kind: "redirect", location: "/m/auth"})
    })

    it("trusts sec-ch-ua-mobile ?1 over a desktop UA", () => {
        expect(
            isMobileDevice(
                (n) => ({"sec-ch-ua-mobile": "?1", "user-agent": DESKTOP_UA})[n] ?? null,
            ),
        ).toBe(true)
    })
    it("trusts sec-ch-ua-mobile ?0 over a mobile UA", () => {
        expect(
            isMobileDevice((n) => ({"sec-ch-ua-mobile": "?0", "user-agent": MOBILE_UA})[n] ?? null),
        ).toBe(false)
    })
    it("falls back to the UA regex when the hint is absent (Safari/Firefox)", () => {
        expect(isMobileDevice((n) => ({"user-agent": MOBILE_UA})[n] ?? null)).toBe(true)
        expect(isMobileDevice((n) => ({"user-agent": DESKTOP_UA})[n] ?? null)).toBe(false)
    })
    it("treats missing headers as desktop", () => {
        expect(isMobileDevice(() => null)).toBe(false)
    })
})

describe("isDocumentNavigation", () => {
    it("accepts GET document navigations", () => {
        expect(isDocumentNavigation(input({headers: docHeaders(MOBILE_UA)}))).toBe(true)
    })
    it("rejects POST", () => {
        expect(isDocumentNavigation(input({method: "POST", headers: docHeaders(MOBILE_UA)}))).toBe(
            false,
        )
    })
    it("rejects fetch/XHR (sec-fetch-dest: empty)", () => {
        expect(
            isDocumentNavigation(
                input({headers: {"user-agent": MOBILE_UA, "sec-fetch-dest": "empty"}}),
            ),
        ).toBe(false)
    })
    it("falls back to Accept when sec-fetch-dest is absent", () => {
        expect(
            isDocumentNavigation(input({headers: {"user-agent": MOBILE_UA, accept: "text/html"}})),
        ).toBe(true)
        expect(
            isDocumentNavigation(
                input({headers: {"user-agent": MOBILE_UA, accept: "application/json"}}),
            ),
        ).toBe(false)
    })
})

describe("mapDesktopToMobile", () => {
    it("maps desktop auth to the mobile sign-in page", () => {
        expect(mapDesktopToMobile("/auth", "")).toBe("/m/auth")
        expect(mapDesktopToMobile("/auth/reset-password", "")).toBe("/m/auth")
    })
    it("maps an observability session deep link to the mobile chat", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/observability", "?session=abc&span=s1")).toBe(
            "/m/w/ws1/p/pr1/sessions/abc",
        )
    })
    it("maps any project-scoped route to the sessions list", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/apps/app1/playground", "?revisions=r1")).toBe(
            "/m/w/ws1/p/pr1/sessions",
        )
        expect(mapDesktopToMobile("/w/ws1/p/pr1/agents", "")).toBe("/m/w/ws1/p/pr1/sessions")
        expect(mapDesktopToMobile("/w/ws1/p/pr1/testsets", "")).toBe("/m/w/ws1/p/pr1/sessions")
    })
    it("maps context-free routes to the mobile root resolver", () => {
        expect(mapDesktopToMobile("/w", "")).toBe("/m/")
        expect(mapDesktopToMobile("/w/ws1", "")).toBe("/m/")
        expect(mapDesktopToMobile("/settings", "")).toBe("/m/")
    })
})

describe("mapMobileToDesktop", () => {
    it("maps a mobile session chat to the observability session drawer", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions/abc")).toBe(
            "/w/ws1/p/pr1/observability?session=abc",
        )
    })
    it("maps the sessions list to observability", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions")).toBe("/w/ws1/p/pr1/observability")
    })
    it("maps mobile auth to desktop auth and unknown paths to /w", () => {
        expect(mapMobileToDesktop("/auth")).toBe("/auth")
        expect(mapMobileToDesktop("/")).toBe("/w")
    })
})

describe("decideDesktopGate", () => {
    it("passes when the flag is off, whatever the device", () => {
        expect(
            decideDesktopGate(input({gateEnabled: false, headers: docHeaders(MOBILE_UA)})),
        ).toEqual({kind: "pass"})
    })
    it("redirects a mobile document navigation into /m", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/w/ws1/p/pr1/agents", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({kind: "redirect", location: "/m/w/ws1/p/pr1/sessions"})
    })
    it("never redirects the documented exceptions", () => {
        for (const pathname of ["/auth/callback", "/post-signup", "/workspaces/accept"]) {
            expect(decideDesktopGate(input({pathname, headers: docHeaders(MOBILE_UA)}))).toEqual({
                kind: "pass",
            })
        }
    })
    it("redirects mobile devices on desktop /auth to the mobile sign-in", () => {
        expect(
            decideDesktopGate(input({pathname: "/auth", headers: docHeaders(MOBILE_UA)})),
        ).toEqual({kind: "redirect", location: "/m/auth"})
    })
    it("honors the opt-out cookie", () => {
        const i = input({headers: docHeaders(MOBILE_UA)})
        i.cookie = (name) => (name === MOBILE_OPTOUT_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })
    it("passes desktop devices through", () => {
        expect(decideDesktopGate(input({headers: docHeaders(DESKTOP_UA)}))).toEqual({kind: "pass"})
    })
    it("sets the opt-out cookie and strips the reserved param on ?view=desktop", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/w", search: "?view=desktop", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTOUT_COOKIE,
            clearCookie: MOBILE_OPTIN_COOKIE,
            location: "/w",
        })
    })
    it("never hard-fails: a throwing header reader falls through to pass", () => {
        const i = input({})
        i.header = () => {
            throw new Error("boom")
        }
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })
})

describe("decideMobileGate", () => {
    it("passes when the flag is off", () => {
        expect(
            decideMobileGate(
                input({gateEnabled: false, pathname: "/", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({kind: "pass"})
    })
    it("redirects a desktop document navigation to the desktop equivalent", () => {
        expect(
            decideMobileGate(
                input({pathname: "/w/ws1/p/pr1/sessions/abc", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({kind: "redirect", location: "/w/ws1/p/pr1/observability?session=abc"})
    })
    it("honors the opt-in cookie (desktop user chose mobile)", () => {
        const i = input({pathname: "/", headers: docHeaders(DESKTOP_UA)})
        i.cookie = (name) => (name === MOBILE_OPTIN_COOKIE ? "1" : undefined)
        expect(decideMobileGate(i)).toEqual({kind: "pass"})
    })
    it("passes mobile devices through", () => {
        expect(decideMobileGate(input({pathname: "/", headers: docHeaders(MOBILE_UA)}))).toEqual({
            kind: "pass",
        })
    })
    it("sets the opt-in cookie and strips the reserved param on ?view=mobile", () => {
        expect(
            decideMobileGate(
                input({pathname: "/", search: "?view=mobile", headers: docHeaders(DESKTOP_UA)}),
            ),
        ).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTIN_COOKIE,
            clearCookie: MOBILE_OPTOUT_COOKIE,
            location: "/",
        })
    })
})

describe("cookie policy", () => {
    it("cookies persist ~180 days", () => {
        expect(GATE_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 180)
    })
})
