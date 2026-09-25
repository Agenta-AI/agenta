import {describe, expect, it} from "vitest"

import {createEtagCache} from "../../src/drive/htmlApp/etags"

describe("createEtagCache", () => {
    it("starts empty and answers undefined for unknown paths", () => {
        const cache = createEtagCache()
        expect(cache.get("a.txt")).toBeUndefined()
        expect(cache.size).toBe(0)
    })

    it("set/get round-trips and overwrites", () => {
        const cache = createEtagCache()
        cache.set("a.txt", "e1")
        expect(cache.get("a.txt")).toBe("e1")
        cache.set("a.txt", "e2")
        expect(cache.get("a.txt")).toBe("e2")
        expect(cache.size).toBe(1)
    })

    it("a null or undefined etag forgets the path", () => {
        const cache = createEtagCache()
        cache.set("a.txt", "e1")
        cache.set("a.txt", null)
        expect(cache.get("a.txt")).toBeUndefined()
        cache.set("a.txt", "e1")
        cache.set("a.txt", undefined)
        expect(cache.get("a.txt")).toBeUndefined()
    })

    it("invalidate drops only the named paths", () => {
        const cache = createEtagCache()
        cache.set("a.txt", "e1")
        cache.set("b.txt", "e2")
        cache.set("c.txt", "e3")
        cache.invalidate(["a.txt", "c.txt", "missing.txt"])
        expect(cache.get("a.txt")).toBeUndefined()
        expect(cache.get("b.txt")).toBe("e2")
        expect(cache.get("c.txt")).toBeUndefined()
    })

    it("clear empties everything and entries snapshots the map", () => {
        const cache = createEtagCache()
        cache.set("a.txt", "e1")
        cache.set("b.txt", "e2")
        expect(cache.entries()).toEqual([
            ["a.txt", "e1"],
            ["b.txt", "e2"],
        ])
        cache.clear()
        expect(cache.size).toBe(0)
        expect(cache.entries()).toEqual([])
    })

    it("instances are independent", () => {
        const a = createEtagCache()
        const b = createEtagCache()
        a.set("x", "1")
        expect(b.get("x")).toBeUndefined()
    })
})
