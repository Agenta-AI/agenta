import {describe, expect, it} from "vitest"

import {writeBounded} from "../../src/workflow/state/boundedMap"

describe("writeBounded", () => {
    it("adds a new key", () => {
        expect(writeBounded({a: 1}, "b", 2, 10)).toEqual({a: 1, b: 2})
    })

    it("does not mutate the map it was given", () => {
        const map = {a: 1}
        writeBounded(map, "b", 2, 10)
        expect(map).toEqual({a: 1})
    })

    it("deletes the key when the value is null", () => {
        expect(writeBounded({a: 1, b: 2}, "b", null, 10)).toEqual({a: 1})
    })

    it("is a no-op when deleting a key that was never there", () => {
        expect(writeBounded({a: 1}, "b", null, 10)).toEqual({a: 1})
    })

    it("trims the least recently written entry once over the cap", () => {
        expect(writeBounded({a: 1, b: 2, c: 3}, "d", 4, 3)).toEqual({b: 2, c: 3, d: 4})
    })

    it("keeps exactly `max` entries", () => {
        const full = Object.fromEntries(Array.from({length: 50}, (_, i) => [`k${i}`, i]))
        expect(Object.keys(writeBounded(full, "new", 999, 50))).toHaveLength(50)
    })

    /**
     * The regression the `delete` in writeBounded exists for. Assigning to an existing key keeps its
     * ORIGINAL insertion position, so re-writing the oldest entry of a full map and then slicing by
     * insertion order would discard the very entry just written.
     */
    it("keeps the entry just written even when it was the oldest in a full map", () => {
        const result = writeBounded({a: 1, b: 2, c: 3}, "a", 99, 3)
        expect(result.a).toBe(99)
        expect(Object.keys(result)).toHaveLength(3)
    })

    it("moves a rewritten key to the newest position rather than leaving it in place", () => {
        expect(Object.keys(writeBounded({a: 1, b: 2, c: 3}, "a", 99, 10))).toEqual(["b", "c", "a"])
    })

    it("re-writing an existing key does not grow a map already at the cap", () => {
        expect(writeBounded({a: 1, b: 2, c: 3}, "b", 22, 3)).toEqual({a: 1, c: 3, b: 22})
    })

    /** The trim slices by key order, and JSON preserves string-key insertion order, so the ordering
     * these tests assert on is what survives a localStorage round trip. */
    it("survives a JSON round trip with its order intact", () => {
        const result = writeBounded({a: 1, b: 2, c: 3}, "d", 4, 3)
        expect(Object.keys(JSON.parse(JSON.stringify(result)))).toEqual(["b", "c", "d"])
    })
})
