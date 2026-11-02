import {describe, expect, it} from "vitest"

import {firstFilteredPath} from "../../src/drive/useSelectionReveal"

const rule = (path: string, seen: string[], loadedDirs: string[], fetchingDirs: string[] = []) =>
    firstFilteredPath({
        path,
        seen: new Set(seen),
        loadedDirs: new Set(loadedDirs),
        fetchingDirs: new Set(fetchingDirs),
    })

describe("firstFilteredPath", () => {
    it("names the nearest ancestor a settled listing lacks", () => {
        expect(rule("a/out/x.png", ["a", "a/src"], ["", "a"])).toBe("a/out")
    })
    it("is null while the listing that would decide is still loading", () => {
        expect(rule("a/out/x.png", ["a"], ["", "a"], ["a"])).toBeNull()
        expect(rule("a/out/x.png", ["a"], [""])).toBeNull()
    })
    it("is null when every step is present", () => {
        expect(rule("a/x.md", ["a", "a/x.md"], ["", "a"])).toBeNull()
    })
})
