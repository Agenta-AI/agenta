import {describe, expect, it} from "vitest"

import {sortDriveEntries} from "../../src/drive/driveSort"
import {type DriveTreeNode} from "../../src/drive/driveTree"

const file = (name: string, size = 0, modifiedAt?: number): DriveTreeNode => ({
    name,
    path: name,
    isFolder: false,
    size,
    modifiedAt,
    children: [],
})
const folder = (name: string): DriveTreeNode => ({name, path: name, isFolder: true, children: []})

describe("sortDriveEntries", () => {
    const entries = [
        file("b.md", 10, 5),
        folder("zeta"),
        file("a.md", 30, 1),
        folder("alpha"),
        file("c.md", 20),
    ]

    it("folders come first, alpha within each group, by name", () => {
        expect(sortDriveEntries(entries, "name").map((n) => n.name)).toEqual([
            "alpha",
            "zeta",
            "a.md",
            "b.md",
            "c.md",
        ])
    })

    it("modified: newest files first, folders keep name order, undated files last", () => {
        expect(sortDriveEntries(entries, "modified").map((n) => n.name)).toEqual([
            "alpha",
            "zeta",
            "b.md",
            "a.md",
            "c.md",
        ])
    })

    it("size: largest files first, folders keep name order", () => {
        expect(sortDriveEntries(entries, "size").map((n) => n.name)).toEqual([
            "alpha",
            "zeta",
            "a.md",
            "c.md",
            "b.md",
        ])
    })

    it("does not mutate the input", () => {
        const copy = [...entries]
        sortDriveEntries(entries, "size")
        expect(entries).toEqual(copy)
    })
})

describe("sortDriveEntries pinned", () => {
    it("leads with the pinned paths in the given order, whatever the sort", () => {
        const nodes = [
            {name: "b.md", path: "b.md", isFolder: false, children: []},
            {name: "untitled.md", path: "untitled.md", isFolder: false, children: []},
            {name: "alpha", path: "alpha", isFolder: true, children: []},
            {name: "untitled folder", path: "untitled folder", isFolder: true, children: []},
        ]
        const pinned = ["untitled.md", "untitled folder"]
        expect(sortDriveEntries(nodes, "name", pinned).map((n) => n.name)).toEqual([
            "untitled.md",
            "untitled folder",
            "alpha",
            "b.md",
        ])
        expect(sortDriveEntries(nodes, "modified", ["nope"]).map((n) => n.name)).toEqual([
            "alpha",
            "untitled folder",
            "b.md",
            "untitled.md",
        ])
    })
})
