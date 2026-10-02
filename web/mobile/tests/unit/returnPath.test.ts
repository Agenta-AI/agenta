import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    completeSignIn,
    isCompletingSignIn,
    rememberReturnPath,
    takeReturnPath,
} from "../../src/lib/context"

describe("return path across sign-in", () => {
    beforeEach(() => {
        const store = new Map<string, string>()
        vi.stubGlobal("sessionStorage", {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => store.set(key, value),
            removeItem: (key: string) => store.delete(key),
        })
    })

    it("keeps an internal path and hands it back once", () => {
        rememberReturnPath("/share/tok?v=2")
        expect(takeReturnPath()).toBe("/share/tok?v=2")
        expect(takeReturnPath()).toBe("")
    })

    it.each(["//evil.example/x", "https://evil.example", "/auth", "/auth?next=/w", "/"])(
        "refuses %s",
        (path) => {
            rememberReturnPath(path)
            expect(takeReturnPath()).toBe("")
        },
    )

    it("forgets a path kept too long ago", () => {
        rememberReturnPath("/w/a/p/b/sessions/c", 0)
        expect(takeReturnPath(31 * 60 * 1000)).toBe("")
    })
})

describe("completeSignIn", () => {
    it("holds the gate back only while the sign-in navigation runs", async () => {
        let during = false
        await completeSignIn(async () => {
            during = isCompletingSignIn()
        })
        expect(during).toBe(true)
        expect(isCompletingSignIn()).toBe(false)
    })

    it("releases the gate when the navigation fails", async () => {
        await expect(
            completeSignIn(async () => {
                throw new Error("navigation failed")
            }),
        ).rejects.toThrow("navigation failed")
        expect(isCompletingSignIn()).toBe(false)
    })
})
