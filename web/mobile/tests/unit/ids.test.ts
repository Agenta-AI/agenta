// `crypto.randomUUID` needs a secure context; over plain HTTP the unguarded call blanked the screen.
import {afterEach, describe, expect, it, vi} from "vitest"

import {newId} from "../../src/lib/ids"

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const withCrypto = (value: unknown) => vi.stubGlobal("crypto", value as typeof globalThis.crypto)

/** The runtime's own implementation, captured before any stub replaces the global. */
const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("newId", () => {
    it("uses crypto.randomUUID when the context is secure", () => {
        const randomUUID = vi.fn(() => "11111111-2222-4333-8444-555555555555")
        withCrypto({randomUUID, getRandomValues})

        expect(newId()).toBe("11111111-2222-4333-8444-555555555555")
        expect(randomUUID).toHaveBeenCalledTimes(1)
    })

    it("builds a v4 UUID from getRandomValues over plain HTTP", () => {
        // The regression: this threw, during render.
        withCrypto({getRandomValues})

        expect(newId()).toMatch(V4)
    })

    it("sets the version and variant bits, not just the shape", () => {
        withCrypto({getRandomValues})

        for (let i = 0; i < 50; i++) {
            const id = newId()
            expect(id[14]).toBe("4")
            expect("89ab").toContain(id[19])
        }
    })

    it("does not repeat itself on the getRandomValues path", () => {
        withCrypto({getRandomValues})

        expect(new Set(Array.from({length: 500}, newId)).size).toBe(500)
    })

    it("still returns an id when crypto is absent altogether", () => {
        withCrypto(undefined)

        expect(newId()).toMatch(/^id-[a-z0-9]+-[a-z0-9]+$/)
    })

    it("does not repeat itself on the counter path", () => {
        // A collision inside one tab would merge two sessions.
        withCrypto(undefined)

        expect(new Set(Array.from({length: 500}, newId)).size).toBe(500)
    })
})
