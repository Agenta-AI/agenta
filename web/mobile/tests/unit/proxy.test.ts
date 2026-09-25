import {NextRequest} from "next/server"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {proxy} from "../../src/proxy"

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
const DESKTOP_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

const req = (path: string, headers: Record<string, string>) =>
    new NextRequest(`http://localhost:3000${path}`, {headers})

const doc = (ua: string, extra: Record<string, string> = {}) => ({
    "user-agent": ua,
    "sec-fetch-dest": "document",
    ...extra,
})

const CLASSIC_ON = {cookie: "agenta-classic-mode=1"}

/** The retired env keys. A stale value in an env file must change nothing. */
const RETIRED_KEYS = [
    "AGENTA_MOBILE_GATE",
    "AGENTA_MOBILE_REVERSE_GATE",
    "AGENTA_MOBILE_ENABLED",
] as const
const saved: Partial<Record<(typeof RETIRED_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
    for (const key of RETIRED_KEYS) {
        saved[key] = process.env[key]
        delete process.env[key]
    }
})

afterEach(() => {
    for (const key of RETIRED_KEYS) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
    }
})

describe("mobile reverse gate proxy", () => {
    it("lets a desktop browser stay on /m", () => {
        expect(proxy(req("/m/", doc(DESKTOP_UA))).headers.get("location")).toBeNull()
        expect(
            proxy(req("/m/w/ws1/p/pr1/sessions/abc", doc(DESKTOP_UA))).headers.get("location"),
        ).toBeNull()
    })

    it("lets a phone stay on /m", () => {
        expect(proxy(req("/m/", doc(MOBILE_UA))).headers.get("location")).toBeNull()
    })

    it("returns a Classic-mode-on user to the desktop equivalent, phone included", () => {
        // Unit tests hit the handler without the Next server, so the /m basePath is still
        // present in nextUrl; the proxy strips it defensively.
        for (const ua of [DESKTOP_UA, MOBILE_UA]) {
            const res = proxy(req("/m/w/ws1/p/pr1/sessions/abc", doc(ua, CLASSIC_ON)))
            expect(res.status).toBe(307)
            expect(res.headers.get("location")).toBe(
                "http://localhost:3000/w/ws1/p/pr1/observability?session=abc",
            )
            expect(proxy(req("/m", doc(ua, CLASSIC_ON))).headers.get("location")).toBe(
                "http://localhost:3000/w",
            )
        }
    })

    it("keeps a Classic-mode-on user on /m when they opted in", () => {
        const res = proxy(
            req("/m/", doc(DESKTOP_UA, {cookie: "agenta-classic-mode=1; agenta-mobile-optin=1"})),
        )
        expect(res.headers.get("location")).toBeNull()
    })

    it("ignores stale AGENTA_MOBILE_GATE, AGENTA_MOBILE_REVERSE_GATE and AGENTA_MOBILE_ENABLED values", () => {
        for (const value of ["false", "true"]) {
            for (const key of RETIRED_KEYS) process.env[key] = value
            expect(proxy(req("/m/", doc(DESKTOP_UA))).headers.get("location")).toBeNull()
            expect(proxy(req("/m", doc(DESKTOP_UA, CLASSIC_ON))).headers.get("location")).toBe(
                "http://localhost:3000/w",
            )
        }
    })

    it("does not redirect non-document requests", () => {
        const res = proxy(
            req("/m/", {"user-agent": DESKTOP_UA, "sec-fetch-dest": "empty", ...CLASSIC_ON}),
        )
        expect(res.headers.get("location")).toBeNull()
    })

    it("?view=mobile sets the opt-in cookie and stays in /m", () => {
        const res = proxy(req("/m/?view=mobile", doc(DESKTOP_UA)))
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe("http://localhost:3000/m/")
        const setCookie = res.headers.get("set-cookie") ?? ""
        expect(setCookie).toContain("agenta-mobile-optin=1")
        expect(setCookie).toContain("Path=/")
    })

    it("never bounces an OAuth callback landing off /m", () => {
        const res = proxy(req("/m/auth/callback/google?code=abc", doc(DESKTOP_UA, CLASSIC_ON)))
        expect(res.headers.get("location")).toBeNull()
    })
})
