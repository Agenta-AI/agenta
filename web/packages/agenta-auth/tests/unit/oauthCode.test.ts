import {beforeEach, describe, expect, it, vi} from "vitest"

import {claimOAuthCode} from "../../src/oauthCode"

// The package's vitest env is node; sessionStorage is all this module touches.
const store = new Map<string, string>()
vi.stubGlobal("window", {
    sessionStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
    },
})

describe("claimOAuthCode", () => {
    beforeEach(() => store.clear())

    it("lets a code through once per tab", () => {
        expect(claimOAuthCode("abc")).toBe(true)
        expect(claimOAuthCode("abc")).toBe(false)
    })

    it("lets a fresh code through after a used one", () => {
        claimOAuthCode("abc")
        expect(claimOAuthCode("def")).toBe(true)
    })

    it("never blocks when there is no code or no storage", () => {
        expect(claimOAuthCode(undefined)).toBe(true)
        vi.stubGlobal("window", {
            sessionStorage: {
                getItem: () => {
                    throw new Error("denied")
                },
            },
        })
        expect(claimOAuthCode("abc")).toBe(true)
        expect(claimOAuthCode("abc")).toBe(true)
    })
})
