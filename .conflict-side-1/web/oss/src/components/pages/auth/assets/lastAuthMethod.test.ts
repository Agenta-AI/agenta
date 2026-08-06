import {beforeEach, describe, expect, it} from "vitest"

import {isEmailMethod, readLastAuthMethod, writeLastAuthMethod} from "./lastAuthMethod"

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
