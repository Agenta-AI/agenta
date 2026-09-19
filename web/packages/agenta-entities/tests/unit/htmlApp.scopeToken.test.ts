/**
 * The browser half of the server-side folder rule.
 *
 * The important behaviours are the unglamorous ones: a failure to mint must NOT stop the app
 * running (the token narrows, so no token is exactly what shipped before), a burst of parallel
 * fs calls must produce one mint rather than five, and a token must be re-minted before it
 * lapses so a long-open app never has a call fail on expiry.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const post = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {
        post: (...args: unknown[]) => post(...args),
    },
    getAgentaApiUrl: () => "http://api.test",
}))

import {
    clearScopeTokens,
    getScopeToken,
    scopeHeaders,
    SCOPE_HEADER,
} from "../../src/drive/htmlApp/scopeToken"

const MOUNT = "m1"
const PROJECT = "p1"
const DIR = "apps/board"

/** `expires_at` is seconds, as the API sends it. */
const ok = (token: string, secondsFromNow: number) => ({
    data: {token, expires_at: Math.floor(Date.now() / 1000) + secondsFromNow},
})

beforeEach(() => {
    post.mockReset()
    clearScopeTokens()
})

afterEach(() => {
    vi.useRealTimers()
})

describe("getScopeToken", () => {
    it("mints once and reuses the token", async () => {
        post.mockResolvedValue(ok("tok-1", 1800))

        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read-write")).toBe("tok-1")
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read-write")).toBe("tok-1")
        expect(post).toHaveBeenCalledTimes(1)
    })

    it("asks for the folder and level it was given", async () => {
        post.mockResolvedValue(ok("tok-1", 1800))
        await getScopeToken(MOUNT, PROJECT, DIR, "read")

        const [url, body, config] = post.mock.calls[0] as [
            string,
            Record<string, unknown>,
            Record<string, unknown>,
        ]
        expect(url).toBe("http://api.test/mounts/m1/apps/scope")
        expect(body).toEqual({dir: DIR, level: "read"})
        expect(config).toEqual({params: {project_id: PROJECT}})
    })

    it("keeps separate tokens per folder and per level", async () => {
        post.mockResolvedValueOnce(ok("read-tok", 1800)).mockResolvedValueOnce(
            ok("write-tok", 1800),
        )

        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBe("read-tok")
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read-write")).toBe("write-tok")
        expect(post).toHaveBeenCalledTimes(2)
    })

    it("collapses a burst of parallel calls onto one mint", async () => {
        // An app that reads three files on boot must not mint three tokens.
        post.mockResolvedValue(ok("tok-1", 1800))
        const all = await Promise.all([
            getScopeToken(MOUNT, PROJECT, DIR, "read"),
            getScopeToken(MOUNT, PROJECT, DIR, "read"),
            getScopeToken(MOUNT, PROJECT, DIR, "read"),
        ])
        expect(all).toEqual(["tok-1", "tok-1", "tok-1"])
        expect(post).toHaveBeenCalledTimes(1)
    })

    it("re-mints before the token lapses, not after", async () => {
        // 30s left is inside the refresh margin: a call now would otherwise land expired.
        post.mockResolvedValueOnce(ok("stale", 30)).mockResolvedValueOnce(ok("fresh", 1800))

        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBe("stale")
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBe("fresh")
        expect(post).toHaveBeenCalledTimes(2)
    })

    it("returns null when the server cannot issue one, so the app still runs", async () => {
        // A deployment without the endpoint. The token narrows; its absence is the old behaviour,
        // not a reason to refuse to open the app.
        post.mockRejectedValue(new Error("404"))
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBeNull()
    })

    it("returns null on a malformed response rather than sending junk", async () => {
        post.mockResolvedValue({data: {token: 42}})
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBeNull()
    })

    it("does not cache a failure", async () => {
        post.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(ok("tok-1", 1800))
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBeNull()
        expect(await getScopeToken(MOUNT, PROJECT, DIR, "read")).toBe("tok-1")
    })
})

describe("scopeHeaders", () => {
    it("sends the header only when there is a token", () => {
        expect(scopeHeaders("tok-1")).toEqual({[SCOPE_HEADER]: "tok-1"})
        expect(scopeHeaders(null)).toEqual({})
    })

    it("uses the header name the API reads", () => {
        expect(SCOPE_HEADER).toBe("X-Agenta-App-Scope")
    })
})
