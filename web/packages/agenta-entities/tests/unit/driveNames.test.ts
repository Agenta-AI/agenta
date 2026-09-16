import {describe, expect, it} from "vitest"

import {newDriveName, uniqueDriveName, validateDriveName} from "../../src/drive/driveNames"

describe("validateDriveName", () => {
    it("rejects empty, slashed, dot and clashing names", () => {
        expect(validateDriveName("  ", [])).toBe("Enter a name")
        expect(validateDriveName("a/b", [])).toMatch(/“\/”/)
        expect(validateDriveName("..", [])).toMatch(/allowed/)
        expect(validateDriveName("a.md", ["a.md"])).toMatch(/already exists/)
    })
    it("lets a rename keep its own name", () => {
        expect(validateDriveName("a.md", ["a.md", "b.md"], "a.md")).toBeNull()
        expect(validateDriveName("b.md", ["a.md", "b.md"], "a.md")).toMatch(/already exists/)
    })
})

describe("uniqueDriveName / newDriveName", () => {
    it("suffixes before the extension until the name is free", () => {
        expect(uniqueDriveName("a.md", [])).toBe("a.md")
        expect(uniqueDriveName("a.md", ["a.md", "a 2.md"])).toBe("a 3.md")
        expect(uniqueDriveName("notes", ["notes"])).toBe("notes 2")
    })
    it("names a new entry", () => {
        expect(newDriveName("folder", ["untitled folder"])).toBe("untitled folder 2")
        expect(newDriveName("file", [])).toBe("untitled.md")
    })
})
