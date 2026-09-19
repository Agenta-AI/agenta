import {describe, expect, it} from "vitest"

import {nameForPastedFile, readPastedFiles} from "../../src/drive/pasteFiles"

const at = new Date(2026, 8, 20, 15, 30, 45)

const clipboard = (files: File[], withItems = true): DataTransfer =>
    ({
        items: withItems ? files.map((f) => ({kind: "file", getAsFile: () => f})) : [],
        files,
    }) as unknown as DataTransfer

describe("nameForPastedFile", () => {
    it("keeps a real file name", () => {
        expect(nameForPastedFile({name: "report.pdf", type: "application/pdf"}, at)).toBe(
            "report.pdf",
        )
    })

    it("dates a bare bitmap, taking the extension from the name or the type", () => {
        expect(nameForPastedFile({name: "image.png", type: "image/png"}, at)).toBe(
            "Pasted image 2026-09-20 at 15.30.45.png",
        )
        expect(nameForPastedFile({name: "", type: "image/jpeg"}, at)).toBe(
            "Pasted image 2026-09-20 at 15.30.45.jpeg",
        )
        expect(nameForPastedFile({name: "blob", type: "application/octet-stream"}, at)).toBe(
            "Pasted file 2026-09-20 at 15.30.45.octet-stream",
        )
    })
})

describe("readPastedFiles", () => {
    it("yields nothing for a text-only paste", () => {
        expect(readPastedFiles(clipboard([]), at)).toEqual([])
        expect(readPastedFiles(null, at)).toEqual([])
    })

    it("reads the item list, renaming a generic bitmap", () => {
        const shot = new File(["x"], "image.png", {type: "image/png"})
        const doc = new File(["y"], "notes.md", {type: "text/markdown"})
        const out = readPastedFiles(clipboard([shot, doc]), at)
        expect(out.map((f) => f.relativePath)).toEqual([
            "Pasted image 2026-09-20 at 15.30.45.png",
            "notes.md",
        ])
        expect(out[0].file.name).toBe("Pasted image 2026-09-20 at 15.30.45.png")
        expect(out[0].file.type).toBe("image/png")
        expect(out[1].file).toBe(doc)
    })

    it("falls back to the flat file list without items", () => {
        const doc = new File(["y"], "a.txt", {type: "text/plain"})
        expect(readPastedFiles(clipboard([doc], false), at)).toEqual([
            {file: doc, relativePath: "a.txt"},
        ])
    })
})
