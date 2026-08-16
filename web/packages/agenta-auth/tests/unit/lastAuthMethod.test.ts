import {beforeEach, describe, expect, it, vi} from "vitest"

import {isEmailMethod, readLastAuthMethod, writeLastAuthMethod} from "../../src/lastAuthMethod"

// The package's vitest env is node; localStorage is all this module touches.
const store = new Map<string, string>()
vi.stubGlobal("window", {
    localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
        clear: () => store.clear(),
    },
})

describe("lastAuthMethod", () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it("returns null when nothing is stored (first visit)", () => {
        expect(readLastAuthMethod()).toBeNull()
    })

    it("round-trips an email method", () => {
        writeLastAuthMethod("email")
        expect(readLastAuthMethod()).toBe("email")
        expect(isEmailMethod(readLastAuthMethod())).toBe(true)
    })

    it("round-trips an arbitrary provider id", () => {
        writeLastAuthMethod("github")
        expect(readLastAuthMethod()).toBe("github")
        expect(isEmailMethod(readLastAuthMethod())).toBe(false)
    })

    it("ignores empty writes", () => {
        writeLastAuthMethod("")
        expect(readLastAuthMethod()).toBeNull()
    })
})
