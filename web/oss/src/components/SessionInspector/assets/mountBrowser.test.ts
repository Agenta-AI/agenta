import {describe, expect, it} from "vitest"

import type {MountFileEntry} from "../api"

import {deriveRows, formatSize, type BrowserRow, type FolderRow} from "./mountBrowser"

const file = (path: string, size = 0): MountFileEntry => ({path, size, is_folder: false})
const folder = (path: string): MountFileEntry => ({path, size: 0, is_folder: true})

const folderNames = (rows: BrowserRow[]): string[] =>
    rows.filter((row): row is FolderRow => row.kind === "folder").map((row) => row.name)

describe("deriveRows", () => {
    it("derives synthetic folder rows only at root, alphabetically, with no file rows", () => {
        const files = [file("src/main.py"), file("tests/main.py"), file("notes/todo.txt")]
        const rows = deriveRows(files, "")

        expect(rows).toHaveLength(3)
        expect(rows.every((row) => row.kind === "folder")).toBe(true)
        expect(rows.map((row) => row.name)).toEqual(["notes", "src", "tests"])
    })

    it("collapses a geesefs mkdir marker plus its contents into one full-name folder row", () => {
        const files = [folder("workspace"), file("workspace/data.bin")]
        const rows = deriveRows(files, "")

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({kind: "folder", name: "workspace"})
        // Pins the phantom "workspace"-minus-last-char bug.
        expect(folderNames(rows)).not.toContain("workspac")
    })

    it("shows an empty folder as a folder row, never a file row", () => {
        const rows = deriveRows([folder("empty")], "")

        expect(rows).toHaveLength(1)
        expect(rows[0].kind).toBe("folder")
    })

    it("skips the current path's own marker entry and lists its children relative to it", () => {
        const files = [folder("workspace"), file("workspace/data.bin")]
        const rows = deriveRows(files, "workspace")

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({kind: "file", name: "data.bin"})
    })

    it("gives direct files at root a file row with the underlying entry preserved", () => {
        const entry = file("readme.md", 42)
        const rows = deriveRows([entry], "")

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({kind: "file", name: "readme.md", entry})
    })

    it("keeps a same-named file and folder as two distinct rows", () => {
        const files = [file("a"), file("a/b.txt")]
        const rows = deriveRows(files, "")

        expect(rows).toHaveLength(2)
        expect(rows.filter((row) => row.name === "a")).toHaveLength(2)
        expect(rows.map((row) => row.kind).sort()).toEqual(["file", "folder"])
    })

    it("orders folders before files, both alphabetical", () => {
        const files = [file("z.txt"), file("a.txt"), folder("m"), folder("b")]
        const rows = deriveRows(files, "")

        expect(rows.map((row) => row.name)).toEqual(["b", "m", "a.txt", "z.txt"])
    })

    it("excludes entries not under the current path", () => {
        const files = [file("workspace/data.bin"), file("other/data.bin")]
        const rows = deriveRows(files, "workspace")

        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({kind: "file", name: "data.bin"})
    })
})

describe("formatSize", () => {
    it("formats bytes, kilobytes, and megabytes", () => {
        expect(formatSize(820)).toBe("820 B")
        expect(formatSize(4300)).toBe("4 KB")
        expect(formatSize(4.2 * 1024 * 1024)).toBe("4.2 MB")
    })
})
