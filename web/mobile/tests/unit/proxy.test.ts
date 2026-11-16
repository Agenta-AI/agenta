import {NextRequest} from "next/server"
import {describe, expect, it, vi} from "vitest"

import {config, proxy} from "../../src/proxy"

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

describe("non-legacy paths", () => {
    it("pass through, whatever the device or the old gate cookies say", () => {
        const cookie = {cookie: "agenta-classic-mode=1; agenta-mobile-optin=1"}
        for (const ua of [DESKTOP_UA, MOBILE_UA]) {
            for (const path of ["/m", "/m/", "/m/auth", "/m/?view=mobile", "/m/invite"]) {
                expect(proxy(req(path, doc(ua, cookie))).headers.get("location")).toBeNull()
            }
        }
    })
})

describe("legacy desktop URLs at /legacy", () => {
    const legacy = (path: string, headers: Record<string, string> = doc(DESKTOP_UA)) =>
        proxy(req(`/m/legacy${path}`, headers))

    it("answers with the /m page, 307, the developer views counted as on", () => {
        const res = legacy("/w/ws1/p/pr1/evaluations/results/run1")
        expect(res.status).toBe(307)
        expect(res.headers.get("location")).toBe(
            "http://localhost:3000/m/w/ws1/p/pr1/evaluations/results/run1",
        )
    })

    it("keeps the trace of an SDK trace link", () => {
        expect(legacy("/w/ws1/p/pr1/observability?trace=t1").headers.get("location")).toBe(
            "http://localhost:3000/m/w/ws1/p/pr1/observability?trace=t1",
        )
    })

    it("answers every request, not only document loads", () => {
        expect(legacy("/w/ws1/p/pr1/sessions/s1", {}).headers.get("location")).toBe(
            "http://localhost:3000/m/w/ws1/p/pr1/sessions/s1",
        )
    })

    it("sends an unknown path to the /m root and logs the path without the query", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        try {
            const res = legacy("/no/such/page?token=secret")
            expect(res.status).toBe(307)
            expect(res.headers.get("location")).toBe("http://localhost:3000/m/")
            expect(warn).toHaveBeenCalledTimes(1)
            expect(String(warn.mock.calls[0][0])).toContain("/no/such/page")
            expect(String(warn.mock.calls[0][0])).not.toContain("secret")
        } finally {
            warn.mockRestore()
        }
    })

    it("does not log a path it maps", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
        try {
            legacy("/w/ws1/p/pr1/agents")
            expect(warn).not.toHaveBeenCalled()
        } finally {
            warn.mockRestore()
        }
    })
})

describe("proxy matcher", () => {
    it("matches legacy URLs only, so client navigations skip the proxy", () => {
        expect(config.matcher).toEqual(["/legacy/:path*"])
    })
})
