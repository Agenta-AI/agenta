/**
 * Id generation across secure and insecure contexts.
 *
 * `crypto.randomUUID` is defined only in a secure context. Over plain HTTP — how the dev stack is
 * served — it is `undefined`, and because these ids are minted during render, every unguarded call
 * took the whole mobile screen down with "crypto.randomUUID is not a function".
 */
import {afterEach, describe, expect, it, vi} from "vitest"

import {newId} from "../../src/lib/ids"

const withCrypto = (value: unknown) => vi.stubGlobal("crypto", value as typeof globalThis.crypto)

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("newId", () => {
    it("uses crypto.randomUUID when the context is secure", () => {
        const randomUUID = vi.fn(() => "11111111-2222-3333-4444-555555555555")
        withCrypto({randomUUID})

        expect(newId()).toBe("11111111-2222-3333-4444-555555555555")
        expect(randomUUID).toHaveBeenCalledTimes(1)
    })

    it("returns an id over plain HTTP, where randomUUID is missing", () => {
        // The regression: this threw, during render, and blanked the screen.
        withCrypto({})

        expect(() => newId()).not.toThrow()
        expect(newId()).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
    })

    it("survives crypto being absent altogether", () => {
        withCrypto(undefined)

        expect(newId()).toBeTruthy()
    })

    it("does not repeat itself on the fallback path", () => {
        // These ids key React lists and identify client-minted sessions, so a collision inside one
        // tab would merge two sessions.
        withCrypto({})

        const ids = new Set(Array.from({length: 500}, () => newId()))
        expect(ids.size).toBe(500)
    })
})
