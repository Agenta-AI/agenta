import {describe, expect, it} from "vitest"

import {SESSION_QUERY_PARAM} from "../../src/utils/sessionParam"
import {
    CLASSIC_MODE_COOKIE,
    GATE_COOKIE_MAX_AGE,
    MOBILE_AUTH_CALLBACK_COOKIE,
    MOBILE_OPTIN_COOKIE,
    MOBILE_OPTOUT_COOKIE,
    decideDesktopGate,
    decideMobileGate,
    isDocumentNavigation,
    isMobileDevice,
    mapDesktopToMobile,
    mapMobileToDesktop,
    mobileRouteFor,
    resolveGateEnabled,
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

    // axiosConfig's 403 handler sends the user to /auth?auth_error=… so they can complete
    // required SSO; mapDesktopToMobile returns a bare /m/auth and would drop the reason.
    it("leaves a policy auth_error link on desktop", () => {
        for (const err of ["upgrade_required", "sso_denied"]) {
            expect(
                decideDesktopGate(
                    input({
                        pathname: "/auth",
                        search: `?auth_error=${err}`,
                        headers: docHeaders(MOBILE_UA),
                    }),
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
    it("maps a project-scoped route to the mobile screen showing the same thing", () => {
        expect(mapDesktopToMobile("/w/ws1/p/pr1/apps/app1/playground", "?revisions=r1")).toBe(
            "/m/w/ws1/p/pr1/agents/app1",
        )
        expect(mapDesktopToMobile("/w/ws1/p/pr1/agents", "")).toBe("/m/w/ws1/p/pr1/agents")
    })
    it("sends a page /m does not have to the mobile root, for the DEVICE gate only", () => {
        // A phone cannot use the desktop test-sets table either way, so the device gate lands
        // it somewhere usable. The classic-mode gate reads the same map's null and passes.
        expect(mapDesktopToMobile("/w/ws1/p/pr1/testsets", "")).toBe("/m/")
        expect(mobileRouteFor("/w/ws1/p/pr1/testsets", "")).toBeNull()
    })
    it("maps context-free routes to the mobile root resolver", () => {
        expect(mapDesktopToMobile("/w", "")).toBe("/m/")
        expect(mapDesktopToMobile("/w/ws1", "")).toBe("/m/")
        expect(mapDesktopToMobile("/settings", "")).toBe("/m/")
    })
})

describe("mobileRouteFor", () => {
    const cases: [string, string, string | null][] = [
        // Home is /apps on both apps.
        ["/w/ws1/p/pr1", "", "/m/w/ws1/p/pr1/apps"],
        ["/w/ws1/p/pr1/apps", "", "/m/w/ws1/p/pr1/apps"],
        ["/w/ws1/p/pr1/agents", "", "/m/w/ws1/p/pr1/agents"],
        ["/w/ws1/p/pr1/agents/a1", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/sessions", "", "/m/w/ws1/p/pr1/sessions"],
        ["/w/ws1/p/pr1/observability", "", "/m/w/ws1/p/pr1/observability"],
        ["/w/ws1/p/pr1/settings", "", "/m/w/ws1/p/pr1/settings"],
        ["/w/ws1/p/pr1/apps/agent-templates", "", "/m/w/ws1/p/pr1/templates"],
        ["/w/ws1/p/pr1/apps/agent-templates/k1", "", "/m/w/ws1/p/pr1/templates/k1"],
        // Every app-scoped page collapses to the agent screen — the only one /m has.
        ["/w/ws1/p/pr1/apps/a1", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/apps/a1/overview", "", "/m/w/ws1/p/pr1/agents/a1"],
        ["/w/ws1/p/pr1/apps/a1/playground", "", "/m/w/ws1/p/pr1/agents/a1"],
        // Desktop-only areas.
        ["/w/ws1/p/pr1/evaluations", "", null],
        ["/w/ws1/p/pr1/testsets", "", null],
        ["/w/ws1/p/pr1/prompts", "", null],
        ["/w/ws1/p/pr1/evaluators", "", null],
        ["/w/ws1/p/pr1/annotations", "", null],
        ["/w/ws1/p/pr1/apps/a1/variants", "", "/m/w/ws1/p/pr1/agents/a1"],
        // Archived lists are not agent ids, and /m has no archive.
        ["/w/ws1/p/pr1/apps/archived", "", null],
        ["/w/ws1/p/pr1/agents/archived", "", null],
        ["/settings", "", null],
        ["/workspaces/accept", "", null],
    ]

    it.each(cases)("maps %s → %s", (pathname, search, expected) => {
        expect(mobileRouteFor(pathname, search)).toBe(expected)
    })

    it("opens the linked session's chat, since /m has no playground route", () => {
        // The session page IS the playground there; ?agent= names the agent a session with no
        // turns cannot name for itself.
        expect(
            mobileRouteFor("/w/ws1/p/pr1/apps/a1/playground", `?${SESSION_QUERY_PARAM}=s1`),
        ).toBe("/m/w/ws1/p/pr1/sessions/s1?agent=a1")
    })
})

describe("mapMobileToDesktop", () => {
    it("opens a linked session on its agent's playground", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions/abc", "?agent=a1")).toBe(
            `/w/ws1/p/pr1/apps/a1/playground?${SESSION_QUERY_PARAM}=abc`,
        )
    })
    it("falls back to the observability drawer when the mobile URL names no agent", () => {
        // The desktop playground is an agent's page; with no agent to open it on, the drawer
        // still shows the session.
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions/abc")).toBe(
            "/w/ws1/p/pr1/observability?session=abc",
        )
    })
    it("maps the lists and tabs to their desktop counterparts", () => {
        expect(mapMobileToDesktop("/w/ws1/p/pr1/sessions")).toBe("/w/ws1/p/pr1/sessions")
        expect(mapMobileToDesktop("/w/ws1/p/pr1/agents")).toBe("/w/ws1/p/pr1/agents")
        expect(mapMobileToDesktop("/w/ws1/p/pr1/agents/a1")).toBe("/w/ws1/p/pr1/apps/a1/playground")
        expect(mapMobileToDesktop("/w/ws1/p/pr1/apps")).toBe("/w/ws1/p/pr1/apps")
        expect(mapMobileToDesktop("/w/ws1/p/pr1/templates")).toBe(
            "/w/ws1/p/pr1/apps/agent-templates",
        )
        expect(mapMobileToDesktop("/w/ws1/p/pr1/settings")).toBe("/w/ws1/p/pr1/settings")
    })
    it("maps mobile auth to desktop auth and unknown paths to /w", () => {
        expect(mapMobileToDesktop("/auth")).toBe("/auth")
        expect(mapMobileToDesktop("/")).toBe("/w")
    })
})

describe("resolveGateEnabled", () => {
    // The gate ships ON so that no deployment needs an env key to give phones /m.
    // Only the exact string "false" opts out.
    it("is on when the key is unset", () => {
        expect(resolveGateEnabled(undefined)).toBe(true)
    })
    it('is on for "true"', () => {
        expect(resolveGateEnabled("true")).toBe(true)
    })
    it('is off for "false"', () => {
        expect(resolveGateEnabled("false")).toBe(false)
    })
    it("stays on for an empty or unrecognized value", () => {
        // An empty value comes from a compose `KEY=` line; anything else is a typo.
        // Neither may silently hide the mobile app.
        for (const raw of ["", "0", "off", "no", "FALSE", null]) {
            expect(resolveGateEnabled(raw)).toBe(true)
        }
    })
})

describe("decideDesktopGate — classic mode", () => {
    /** A desktop browser whose user has Classic mode off, with the device gate switched off. */
    const classicOff = (
        overrides: Partial<GateInput> & {headers?: Record<string, string>} = {},
    ) => {
        const i = input({gateEnabled: false, headers: docHeaders(DESKTOP_UA), ...overrides})
        i.cookie = (name) => (name === CLASSIC_MODE_COOKIE ? "0" : undefined)
        return i
    }

    it("redirects a Classic-mode-off user on a desktop browser", () => {
        expect(decideDesktopGate(classicOff({pathname: "/w/ws1/p/pr1/agents"}))).toEqual({
            kind: "redirect",
            location: "/m/w/ws1/p/pr1/agents",
        })
    })

    it("carries the linked session over to its /m chat", () => {
        expect(
            decideDesktopGate(
                classicOff({
                    pathname: "/w/ws1/p/pr1/apps/a1/playground",
                    search: `?${SESSION_QUERY_PARAM}=s1`,
                }),
            ),
        ).toEqual({kind: "redirect", location: "/m/w/ws1/p/pr1/sessions/s1?agent=a1"})
    })

    it("leaves desktop-only areas alone — /m has no screen for them", () => {
        for (const pathname of [
            "/w/ws1/p/pr1/evaluations",
            "/w/ws1/p/pr1/testsets",
            "/w/ws1/p/pr1/prompts",
            "/w/ws1/p/pr1/evaluators",
            "/w/ws1/p/pr1/annotations",
        ]) {
            expect(decideDesktopGate(classicOff({pathname}))).toEqual({kind: "pass"})
        }
    })

    it("passes when Classic mode is on", () => {
        const i = input({gateEnabled: false, headers: docHeaders(DESKTOP_UA)})
        i.cookie = (name) => (name === CLASSIC_MODE_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })

    it("passes when the cookie is absent — unknown is never treated as off", () => {
        // The preference is per-browser; someone who has not loaded either app since this
        // shipped has no cookie, and guessing would move users who never chose anything.
        expect(
            decideDesktopGate(input({gateEnabled: false, headers: docHeaders(DESKTOP_UA)})),
        ).toEqual({kind: "pass"})
    })

    it("passes when the classic gate is disabled for the deployment", () => {
        expect(
            decideDesktopGate(
                classicOff({classicGateEnabled: false, pathname: "/w/ws1/p/pr1/agents"}),
            ),
        ).toEqual({kind: "pass"})
    })

    it("honors the opt-out cookie", () => {
        const i = classicOff({pathname: "/w/ws1/p/pr1/agents"})
        i.cookie = (name) =>
            name === CLASSIC_MODE_COOKIE ? "0" : name === MOBILE_OPTOUT_COOKIE ? "1" : undefined
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })

    it("never bounces the documented desktop-only links", () => {
        for (const pathname of ["/auth/callback", "/post-signup", "/workspaces/accept"]) {
            expect(decideDesktopGate(classicOff({pathname}))).toEqual({kind: "pass"})
        }
        expect(decideDesktopGate(classicOff({pathname: "/auth", search: "?token=abc123"}))).toEqual(
            {kind: "pass"},
        )
        expect(
            decideDesktopGate(classicOff({pathname: "/auth", search: "?auth_error=sso_denied"})),
        ).toEqual({kind: "pass"})
    })

    it("does not touch non-document navigations", () => {
        expect(
            decideDesktopGate(classicOff({pathname: "/w/ws1/p/pr1/agents", method: "POST"})),
        ).toEqual({kind: "pass"})
        expect(
            decideDesktopGate(
                classicOff({
                    pathname: "/w/ws1/p/pr1/agents",
                    headers: {"user-agent": DESKTOP_UA, "sec-fetch-dest": "empty"},
                }),
            ),
        ).toEqual({kind: "pass"})
    })

    it("the device gate wins for a phone, mapped route or not", () => {
        // Both reasons apply; the device one is total, so an unmapped page still lands in /m.
        const i = input({
            gateEnabled: true,
            pathname: "/w/ws1/p/pr1/testsets",
            headers: docHeaders(MOBILE_UA),
        })
        i.cookie = (name) => (name === CLASSIC_MODE_COOKIE ? "0" : undefined)
        expect(decideDesktopGate(i)).toEqual({kind: "redirect", location: "/m/"})
    })
})

describe("decideDesktopGate", () => {
    it("passes when the flag is off, whatever the device", () => {
        expect(
            decideDesktopGate(
                input({
                    gateEnabled: false,
                    classicGateEnabled: false,
                    headers: docHeaders(MOBILE_UA),
                }),
            ),
        ).toEqual({kind: "pass"})
    })
    it("redirects a mobile document navigation into /m", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/w/ws1/p/pr1/agents", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({kind: "redirect", location: "/m/w/ws1/p/pr1/agents"})
    })
    it("never redirects the documented exceptions", () => {
        for (const pathname of ["/auth/callback", "/post-signup", "/workspaces/accept"]) {
            expect(decideDesktopGate(input({pathname, headers: docHeaders(MOBILE_UA)}))).toEqual({
                kind: "pass",
            })
        }
    })
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

    it("forwards an OAuth callback the mobile app started to /m, query intact", () => {
        const i = input({
            pathname: "/auth/callback/google",
            search: "?code=abc&state=xyz",
            headers: docHeaders(MOBILE_UA),
        })
        i.cookie = (name) => (name === MOBILE_AUTH_CALLBACK_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({
            kind: "redirect",
            location: "/m/auth/callback/google?code=abc&state=xyz",
        })
    })
    it("forwards the mobile callback for a desktop UA too (the cookie is the intent)", () => {
        const i = input({pathname: "/auth/callback/github", headers: docHeaders(DESKTOP_UA)})
        i.cookie = (name) => (name === MOBILE_AUTH_CALLBACK_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({
            kind: "redirect",
            location: "/m/auth/callback/github",
        })
    })
    it("leaves the other desktop-only exceptions alone even with the callback cookie", () => {
        for (const pathname of ["/post-signup", "/workspaces/accept"]) {
            const i = input({pathname, headers: docHeaders(MOBILE_UA)})
            i.cookie = (name) => (name === MOBILE_AUTH_CALLBACK_COOKIE ? "1" : undefined)
            expect(decideDesktopGate(i)).toEqual({kind: "pass"})
        }
    })
    it("still passes an OAuth callback with no mobile marker", () => {
        expect(
            decideDesktopGate(
                input({pathname: "/auth/callback/google", headers: docHeaders(MOBILE_UA)}),
            ),
        ).toEqual({kind: "pass"})
    })
    // A deployment that opts out with AGENTA_MOBILE_GATE=false still runs /m, so a mobile SSO
    // sign-in only ever completes if the handback runs regardless of the flag. It used to sit
    // below the gate-disabled return.
    it("hands a mobile-started callback to /m even when the gate is disabled", () => {
        const i = input({
            pathname: "/auth/callback/google",
            search: "?code=abc&state=xyz",
            headers: docHeaders(MOBILE_UA),
        })
        i.gateEnabled = false
        i.cookie = (name) => (name === MOBILE_AUTH_CALLBACK_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({
            kind: "redirect",
            location: "/m/auth/callback/google?code=abc&state=xyz",
        })
    })

    it("leaves an ordinary callback alone when the gate is disabled", () => {
        const i = input({pathname: "/auth/callback/google", headers: docHeaders(MOBILE_UA)})
        i.gateEnabled = false
        expect(decideDesktopGate(i)).toEqual({kind: "pass"})
    })

    it("lets ?view=desktop win over the callback marker", () => {
        const i = input({
            pathname: "/auth/callback/google",
            search: "?view=desktop",
            headers: docHeaders(MOBILE_UA),
        })
        i.cookie = (name) => (name === MOBILE_AUTH_CALLBACK_COOKIE ? "1" : undefined)
        expect(decideDesktopGate(i)).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTOUT_COOKIE,
            clearCookie: MOBILE_OPTIN_COOKIE,
            location: "/auth/callback/google",
        })
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
    it("never bounces an OAuth callback landing off /m", () => {
        expect(
            decideMobileGate(
                input({
                    pathname: "/auth/callback/google",
                    search: "?code=abc",
                    headers: docHeaders(DESKTOP_UA),
                }),
            ),
        ).toEqual({kind: "pass"})
    })
    it("still bounces the mobile sign-in page for desktop UAs", () => {
        expect(
            decideMobileGate(input({pathname: "/auth", headers: docHeaders(DESKTOP_UA)})),
        ).toEqual({kind: "redirect", location: "/auth"})
    })
    it("passes desktop UAs when only the reverse gate is disabled", () => {
        expect(
            decideMobileGate(
                input({
                    reverseGateEnabled: false,
                    pathname: "/w/ws1/p/pr1/sessions",
                    headers: docHeaders(DESKTOP_UA),
                }),
            ),
        ).toEqual({kind: "pass"})
    })
    it("does not bounce a Classic-mode-off user out of /m", () => {
        // The loop this prevents: the desktop gate sends them here for the preference, this gate
        // sends them back for the device, and the cookie that started it never changes. Both
        // gates on, desktop UA, so every other branch would redirect.
        const i = input({
            gateEnabled: true,
            pathname: "/w/ws1/p/pr1/sessions",
            headers: docHeaders(DESKTOP_UA),
        })
        i.cookie = (name) => (name === CLASSIC_MODE_COOKIE ? "0" : undefined)
        expect(decideMobileGate(i)).toEqual({kind: "pass"})

        // The desktop half of the same request must still want them here, or the loop is only
        // hidden rather than broken.
        expect(decideDesktopGate(i)).toEqual({
            kind: "redirect",
            location: "/m/w/ws1/p/pr1/sessions",
        })
    })

    it("still bounces a desktop UA out of /m when the classic gate is disabled", () => {
        const i = input({
            gateEnabled: true,
            classicGateEnabled: false,
            pathname: "/w/ws1/p/pr1/sessions",
            headers: docHeaders(DESKTOP_UA),
        })
        i.cookie = (name) => (name === CLASSIC_MODE_COOKIE ? "0" : undefined)
        expect(decideMobileGate(i)).toEqual({kind: "redirect", location: "/w/ws1/p/pr1/sessions"})
    })

    it("reverse gate off does not touch the forward gate", () => {
        expect(
            decideDesktopGate(
                input({
                    reverseGateEnabled: false,
                    pathname: "/w/ws1/p/pr1/observability",
                    headers: docHeaders(MOBILE_UA),
                }),
            ),
        ).toEqual({kind: "redirect", location: "/m/w/ws1/p/pr1/observability"})
    })
    it("still sets the opt-in cookie with the reverse gate off", () => {
        expect(
            decideMobileGate(
                input({
                    reverseGateEnabled: false,
                    pathname: "/",
                    search: "?view=mobile",
                    headers: docHeaders(DESKTOP_UA),
                }),
            ),
        ).toEqual({
            kind: "set-cookie-redirect",
            cookie: MOBILE_OPTIN_COOKIE,
            clearCookie: MOBILE_OPTOUT_COOKIE,
            location: "/",
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
