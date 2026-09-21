/**
 * Where a blocked popup puts a person back.
 *
 * With popups blocked, authorizing navigates the whole tab, and what returns is a page served
 * by the API that knows the deployment's origin and nothing else. It used to send everyone to a
 * bare `/settings`: on classic that forwards on to the scoped page, so it merely looked slow,
 * and on /m there is no such route at all, so a person who started on mobile came back into the
 * desktop app (UI QA round 3, D1). The tab writes down where it stood before it leaves.
 */
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    isSafeReturnPath,
    MCP_RETURN_PATH_KEY,
    rememberMcpReturnPath,
} from "../../src/mcpEndpoint/core/returnPath"

const store = new Map<string, string>()

beforeEach(() => {
    store.clear()
    vi.stubGlobal("window", {
        sessionStorage: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => void store.set(key, value),
            removeItem: (key: string) => void store.delete(key),
        },
    })
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("remembering where the tab was", () => {
    it("keeps the scoped path and its query, which is the whole point", () => {
        rememberMcpReturnPath({
            pathname: "/m/w/ws-1/p/proj-1/settings",
            search: "?tab=mcpEndpoints",
        })

        expect(store.get(MCP_RETURN_PATH_KEY)).toBe("/m/w/ws-1/p/proj-1/settings?tab=mcpEndpoints")
    })

    it("keeps the surface, so /m comes back to /m", () => {
        rememberMcpReturnPath({pathname: "/m/w/ws-1/p/proj-1/settings", search: ""})

        expect(store.get(MCP_RETURN_PATH_KEY)).toBe("/m/w/ws-1/p/proj-1/settings")
    })

    it("survives a browser that refuses storage", () => {
        vi.stubGlobal("window", {
            sessionStorage: {
                setItem: () => {
                    throw new Error("The user denied storage access.")
                },
            },
        })

        // A private window still authorizes fine; it lands on the fallback path instead.
        expect(() => rememberMcpReturnPath({pathname: "/w/ws/p/p/settings"})).not.toThrow()
    })
})

describe("what may be navigated to", () => {
    it("accepts a path", () => {
        expect(isSafeReturnPath("/w/ws-1/p/proj-1/settings?tab=mcpEndpoints")).toBe(true)
    })

    it("refuses another origin dressed as a path", () => {
        // The value is joined to an origin by the callback page, and a browser reads
        // "//evil.test" as a URL to somewhere else entirely.
        expect(isSafeReturnPath("//evil.test/phish")).toBe(false)
        expect(isSafeReturnPath("https://evil.test")).toBe(false)
        expect(isSafeReturnPath("/\\evil.test")).toBe(false)
    })

    it("refuses what is not a path at all", () => {
        expect(isSafeReturnPath("")).toBe(false)
        expect(isSafeReturnPath("/")).toBe(false)
        expect(isSafeReturnPath("settings")).toBe(false)
        expect(isSafeReturnPath(null)).toBe(false)
        expect(isSafeReturnPath(`/${"x".repeat(4000)}`)).toBe(false)
    })

    it("stores nothing it would refuse to read back", () => {
        rememberMcpReturnPath({pathname: "//evil.test", search: ""})

        expect(store.has(MCP_RETURN_PATH_KEY)).toBe(false)
    })
})
