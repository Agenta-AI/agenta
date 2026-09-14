import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

import {configureAuth} from "../../src/runtime"
import {
    clearPendingTurnstileToken,
    getTurnstileSiteKey,
    installTurnstileFetchPatch,
    isTurnstileEnabled,
    setPendingTurnstileToken,
    TURNSTILE_HEADER,
} from "../../src/turnstile"

const SITE_KEY = "NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY"
const LICENSE = "NEXT_PUBLIC_AGENTA_LICENSE"

const configure = (values: Record<string, string>) =>
    configureAuth({getEnv: (key) => values[key] ?? "", getApiUrl: () => "https://api.test"})

describe("getTurnstileSiteKey", () => {
    it("is empty unless the deployment is EE", () => {
        configure({[SITE_KEY]: "0xkey"})
        expect(getTurnstileSiteKey()).toBe("")
        expect(isTurnstileEnabled()).toBe(false)
    })

    it("is the configured key on EE and cloud", () => {
        configure({[SITE_KEY]: " 0xkey ", [LICENSE]: "ee"})
        expect(getTurnstileSiteKey()).toBe("0xkey")
        configure({[SITE_KEY]: "0xkey", [LICENSE]: "cloud-eu"})
        expect(isTurnstileEnabled()).toBe(true)
    })

    it("is empty on EE without a key", () => {
        configure({[LICENSE]: "ee"})
        expect(isTurnstileEnabled()).toBe(false)
    })
})

/**
 * The patch is a module-level once-only install, so this suite runs it exactly once and drives
 * everything else through the pending token — the same shape the apps use.
 */
describe("installTurnstileFetchPatch", () => {
    const calls: Request[] = []
    const originalFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Request(input, init))
        return new Response("ok")
    })

    beforeAll(() => {
        Object.assign(globalThis, {
            window: {fetch: originalFetch, location: {origin: "https://app.test"}},
        })
        configure({[SITE_KEY]: "0xkey", [LICENSE]: "ee"})
        installTurnstileFetchPatch()
        expect(window.fetch).not.toBe(originalFetch)
    })

    beforeEach(() => {
        calls.length = 0
        clearPendingTurnstileToken()
    })

    afterEach(() => {
        clearPendingTurnstileToken()
    })

    const header = (request: Request) => request.headers.get(TURNSTILE_HEADER)

    it("stamps the pending token on the guarded auth calls only", async () => {
        setPendingTurnstileToken("tok-1")
        await window.fetch("https://app.test/api/auth/signinup", {method: "POST"})
        await window.fetch("https://app.test/api/auth/signinup/code/", {method: "POST"})
        await window.fetch("https://app.test/api/auth/signinup/code/consume", {method: "POST"})
        await window.fetch("https://app.test/api/profile")

        expect(calls.map(header)).toEqual(["tok-1", "tok-1", null, null])
    })

    it("sends nothing when no token is pending", async () => {
        await window.fetch("https://app.test/api/auth/signin", {method: "POST"})
        expect(header(calls[0])).toBeNull()
    })

    it("keeps the caller's own headers alongside the stamp", async () => {
        setPendingTurnstileToken("tok-2")
        await window.fetch("https://app.test/api/auth/signup", {
            method: "POST",
            headers: {rid: "emailpassword"},
        })
        expect(calls[0].headers.get("rid")).toBe("emailpassword")
        expect(header(calls[0])).toBe("tok-2")
    })

    it("treats a blank token as none", async () => {
        setPendingTurnstileToken("   ")
        await window.fetch("https://app.test/api/auth/signinup", {method: "POST"})
        expect(header(calls[0])).toBeNull()
    })
})
