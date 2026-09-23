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

    it("keeps the name of a file copied from the OS, even when it is image.png", () => {
        const onDisk = new File(["x"], "image.png", {type: "image/png"})
        Object.defineProperty(onDisk, "lastModified", {value: new Date(2026, 0, 2).getTime()})
        expect(readPastedFiles(clipboard([onDisk]), at)).toEqual([
            {file: onDisk, relativePath: "image.png"},
        ])
    })

    it("numbers apart names that repeat inside one paste", () => {
        const one = new File(["1"], "image.png", {type: "image/png"})
        const two = new File(["2"], "image.png", {type: "image/png"})
        const three = new File(["3"], "image.png", {type: "image/png"})
        expect(
            readPastedFiles(clipboard([one, two, three]), at).map((f) => f.relativePath),
        ).toEqual([
            "Pasted image 2026-09-20 at 15.30.45.png",
            "Pasted image 2026-09-20 at 15.30.45 2.png",
            "Pasted image 2026-09-20 at 15.30.45 3.png",
        ])
    })

    it("numbers apart two copied files that share a real name", () => {
        const mk = (body: string) => {
            const f = new File([body], "notes.md", {type: "text/markdown"})
            Object.defineProperty(f, "lastModified", {value: new Date(2026, 0, 2).getTime()})
            return f
        }
        expect(
            readPastedFiles(clipboard([mk("a"), mk("b")]), at).map((f) => f.relativePath),
        ).toEqual(["notes.md", "notes 2.md"])
    })

    it("falls back to the flat file list without items", () => {
        const doc = new File(["y"], "a.txt", {type: "text/plain"})
        expect(readPastedFiles(clipboard([doc], false), at)).toEqual([
            {file: doc, relativePath: "a.txt"},
        ])
    })
})
