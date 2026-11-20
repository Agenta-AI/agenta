/**
 * The file rules of the skill view: two files never share a path, a folder in a path makes the
 * folder, search reads name and folder, and the dots count only what changed.
 */
import {describe, expect, it} from "vitest"

import {
    editedFileCount,
    filePathProblem,
    firstBadFile,
    groupFilesByFolder,
    searchFiles,
} from "../../src/DrillInView/SchemaControls/skillFiles"

const file = (path: string, content = "") => ({path, content})

describe("filePathProblem", () => {
    const files = [file("references/categories.md"), file("scripts/run.py")]

    it("refuses a path another file already has, when adding", () => {
        const next = [...files, file("references/categories.md")]
        expect(filePathProblem(next, 2)).toBe("duplicate")
        expect(firstBadFile(next)).toBe(0)
    })

    it("refuses a rename onto another file's path", () => {
        const renamed = [files[0], file("references/categories.md")]
        expect(filePathProblem(renamed, 1)).toBe("duplicate")
    })

    it("refuses SKILL.md, an empty path and unsafe paths", () => {
        expect(filePathProblem([file("SKILL.md")], 0)).toBe("skillMd")
        expect(filePathProblem([file("")], 0)).toBe("empty")
        expect(filePathProblem([file("../x.py")], 0)).toBe("invalid")
        expect(filePathProblem([file("/abs.py")], 0)).toBe("invalid")
        // A configuration written by hand may hold a path that is not text.
        expect(filePathProblem([{path: 7, content: ""} as never], 0)).toBe("invalid")
        expect(filePathProblem([{content: ""} as never], 0)).toBe("empty")
    })

    it("accepts a unique relative path", () => {
        expect(filePathProblem(files, 1)).toBeUndefined()
        expect(firstBadFile(files)).toBeUndefined()
    })
})

describe("groupFilesByFolder", () => {
    it("puts root files first and makes a folder from a new path", () => {
        const files = [file("references/a.md"), file("examples.md"), file("references/pricing.md")]
        expect(groupFilesByFolder(files)).toEqual([
            {folder: "", files: [1]},
            {folder: "references", files: [0, 2]},
        ])
        const added = [...files, file("lib/new/client.py")]
        expect(groupFilesByFolder(added).map((g) => g.folder)).toEqual([
            "",
            "references",
            "lib/new",
        ])
    })
})

describe("searchFiles", () => {
    const files = [
        file("references/refund-policy.md"),
        file("templates/reply-billing.md"),
        file("scripts/classify.py"),
    ]

    it("matches by name and by folder, in list order", () => {
        expect(searchFiles(files, "re")).toEqual([0, 1])
        expect(searchFiles(files, "scripts")).toEqual([2])
    })

    it("finds nothing for no match, and nothing for an empty query", () => {
        expect(searchFiles(files, "zzz")).toEqual([])
        expect(searchFiles(files, "  ")).toEqual([])
    })
})

describe("editedFileCount", () => {
    it("counts SKILL.md and each changed or new file", () => {
        const baseline = {name: "a", body: "x", files: [file("a.md", "1"), file("b.md", "2")]}
        const value = {
            name: "a",
            body: "y",
            files: [file("a.md", "1"), file("b.md", "3"), file("c.md")],
        }
        expect(editedFileCount(value, baseline)).toBe(3)
        expect(editedFileCount(baseline, baseline)).toBe(0)
    })
})
