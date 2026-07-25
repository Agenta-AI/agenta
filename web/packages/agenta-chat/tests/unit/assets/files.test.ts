import type {FileUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {fileKind, fileParts, filePartName} from "../../../src/assets/files"

// `filesToParts`/`fileToPart` read a `File` via `FileReader.readAsDataURL`, which the node
// vitest environment (`environment: "node"` in vitest.config.ts) does not provide — no DOM,
// no FileReader global. Only the pure, FileReader-free exports are covered here.

describe("fileKind", () => {
    it("classifies image types", () => {
        expect(fileKind("image/png")).toBe("image")
    })

    it("classifies audio types", () => {
        expect(fileKind("audio/mpeg")).toBe("audio")
    })

    it("classifies video types", () => {
        expect(fileKind("video/mp4")).toBe("video")
    })

    it("falls back to file for anything else", () => {
        expect(fileKind("application/pdf")).toBe("file")
    })
})

describe("fileParts", () => {
    it("extracts only the file parts of a message, in order", () => {
        const filePart: FileUIPart = {
            type: "file",
            mediaType: "image/png",
            filename: "a.png",
            url: "data:image/png;base64,AAAA",
        }
        const message = {
            id: "m1",
            role: "user",
            parts: [{type: "text", text: "hi"}, filePart],
        } as unknown as UIMessage
        expect(fileParts(message)).toEqual([filePart])
    })

    it("returns an empty array when there are no file parts", () => {
        const message = {
            id: "m1",
            role: "user",
            parts: [{type: "text", text: "hi"}],
        } as unknown as UIMessage
        expect(fileParts(message)).toEqual([])
    })
})

describe("filePartName", () => {
    it("prefers the filename when present", () => {
        const part: FileUIPart = {
            type: "file",
            mediaType: "image/png",
            filename: "notes.png",
            url: "https://example.com/x/notes.png?sig=1",
        }
        expect(filePartName(part)).toBe("notes.png")
    })

    it("does not label an inline data: URL with its own base64 payload", () => {
        // fileToPart emits data:<type>;base64,<...>; its URL tail IS the payload, so the tail
        // fallback would render ~70 characters of base64 where a name belongs.
        const part: FileUIPart = {
            type: "file",
            mediaType: "image/png",
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
        }

        expect(filePartName(part)).toBe("attachment")
    })

    it("falls back to the tail of the url, stripped of query params", () => {
        const part: FileUIPart = {
            type: "file",
            mediaType: "image/png",
            url: "https://example.com/x/generated.png?sig=1",
        }
        expect(filePartName(part)).toBe("generated.png")
    })

    it("falls back to 'file' when neither filename nor a url tail is available", () => {
        const part: FileUIPart = {
            type: "file",
            mediaType: "image/png",
            url: "",
        }
        expect(filePartName(part)).toBe("file")
    })
})
