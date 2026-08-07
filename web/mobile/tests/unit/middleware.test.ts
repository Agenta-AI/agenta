import {NextRequest} from "next/server"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {middleware} from "../../src/middleware"

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

let savedFlag: string | undefined

beforeEach(() => {
    savedFlag = process.env.AGENTA_MOBILE_GATE
    process.env.AGENTA_MOBILE_GATE = "true"
})

afterEach(() => {
    if (savedFlag === undefined) delete process.env.AGENTA_MOBILE_GATE
    else process.env.AGENTA_MOBILE_GATE = savedFlag
})

describe("mobile reverse gate middleware", () => {
    it("passes everything through when the flag is off", () => {
        process.env.AGENTA_MOBILE_GATE = "false"
        const res = middleware(req("/m/", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBeNull()
    })

    it("redirects a desktop UA on a mobile session URL to the desktop equivalent", () => {
        // Unit tests hit the handler without the Next server, so the /m
        // basePath is still present in nextUrl — the middleware strips it
        // defensively (at runtime Next strips it before the handler runs).
        const res = middleware(req("/m/w/ws1/p/pr1/sessions/abc", doc(DESKTOP_UA)))
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe(
            "http://localhost:3000/w/ws1/p/pr1/observability?session=abc",
        )
    })

    it("redirects the mobile root to /w for desktop UAs", () => {
        const res = middleware(req("/m", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBe("http://localhost:3000/w")
    })

    it("lets mobile devices through (sec-ch-ua-mobile wins over UA)", () => {
        const res = middleware(req("/m/", doc(DESKTOP_UA, {"sec-ch-ua-mobile": "?1"})))
        expect(res.headers.get("location")).toBeNull()
    })

    it("honors the opt-in cookie for desktop UAs", () => {
        const res = middleware(req("/m/", doc(DESKTOP_UA, {cookie: "agenta-mobile-optin=1"})))
        expect(res.headers.get("location")).toBeNull()
    })

    it("does not redirect non-document requests", () => {
        const res = middleware(req("/m/", {"user-agent": DESKTOP_UA, "sec-fetch-dest": "empty"}))
        expect(res.headers.get("location")).toBeNull()
    })

    it("?view=mobile sets the opt-in cookie and stays in /m", () => {
        const res = middleware(req("/m/?view=mobile", doc(DESKTOP_UA)))
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe("http://localhost:3000/m/")
        const setCookie = res.headers.get("set-cookie") ?? ""
        expect(setCookie).toContain("agenta-mobile-optin=1")
        expect(setCookie).toContain("Path=/")
    })

    it("never bounces an OAuth callback landing off /m", () => {
        const res = middleware(req("/m/auth/callback/google?code=abc", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBeNull()
    })

    it("still bounces the mobile sign-in page for desktop UAs", () => {
        const res = middleware(req("/m/auth", doc(DESKTOP_UA)))
        expect(res.headers.get("location")).toBe("http://localhost:3000/auth")
    })

    it("mobile UA passes untouched (no cookie, no redirect)", () => {
        const res = middleware(req("/m/", doc(MOBILE_UA)))
        expect(res.headers.get("location")).toBeNull()
        expect(res.headers.get("set-cookie")).toBeNull()
    })
})
