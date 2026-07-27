/**
 * Pins the mount file-browser derivation. The backend lists a mount's whole tree as a flat array of
 * relative paths; `deriveMountRows` folds that into the immediate children of a directory (folders +
 * files), which is the tricky part (implied folders from deep paths, dedupe, sort, sub-path drill).
 */
import {describe, expect, it} from "vitest"

import {deriveMountRows, mountBreadcrumbs} from "../../src/session/core/mountBrowser"
import type {MountFile} from "../../src/session/core/schema"

const listing: MountFile[] = [
    {path: "plan.json", size: 840},
    {path: "notes.md", size: 1200},
    {path: "memory/today.md", size: 30},
    {path: "memory/archive/jan.md", size: 10},
    {path: "skills/", size: 0, is_folder: true}, // explicit empty folder
]

describe("deriveMountRows", () => {
    it("returns the immediate children at root: folders first, then files, alpha", () => {
        const rows = deriveMountRows(listing, "")
        expect(rows.map((r) => `${r.isFolder ? "d" : "f"}:${r.name}`)).toEqual([
            "d:memory",
            "d:skills",
            "f:notes.md",
            "f:plan.json",
        ])
    })

    it("implies a folder from a deep path and carries the full drill-in path", () => {
        const mem = deriveMountRows(listing, "").find((r) => r.name === "memory")!
        expect(mem.isFolder).toBe(true)
        expect(mem.path).toBe("memory")
    })

    it("surfaces an explicit empty-folder marker as a folder (not a file)", () => {
        const skills = deriveMountRows(listing, "").find((r) => r.name === "skills")!
        expect(skills.isFolder).toBe(true)
        expect(skills.size).toBeUndefined()
    })

    it("drills into a sub-path and shows its immediate children only", () => {
        const rows = deriveMountRows(listing, "memory")
        expect(rows.map((r) => `${r.isFolder ? "d" : "f"}:${r.name}`)).toEqual([
            "d:archive",
            "f:today.md",
        ])
        // paths stay mount-relative for the next drill / read
        expect(rows.find((r) => r.name === "archive")!.path).toBe("memory/archive")
        expect(rows.find((r) => r.name === "today.md")!.path).toBe("memory/today.md")
    })

    it("carries file size and tolerates trailing slashes in currentPath", () => {
        const rows = deriveMountRows(listing, "memory/")
        expect(rows.find((r) => r.name === "today.md")!.size).toBe(30)
    })

    it("returns nothing for an unknown directory", () => {
        expect(deriveMountRows(listing, "nope")).toEqual([])
    })
})

describe("mountBreadcrumbs", () => {
    it("splits a path into cumulative segments; root is empty", () => {
        expect(mountBreadcrumbs("")).toEqual([])
        expect(mountBreadcrumbs("memory/archive")).toEqual([
            {name: "memory", path: "memory"},
            {name: "archive", path: "memory/archive"},
        ])
    })
})
