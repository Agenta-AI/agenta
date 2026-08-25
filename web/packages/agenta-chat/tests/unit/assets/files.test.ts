import type {FileUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {
    attachmentRefsToParts,
    fileKind,
    fileParts,
    filePartName,
    filesToParts,
} from "../../../src/assets/files"

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

// `filesToParts` needs a FileReader, which this environment does not provide. A minimal stub is
// enough to prove the settle-individually contract: one file reads, the other errors.
class StubFileReader {
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    error: unknown = null
    result: string | null = null
    readAsDataURL(file: File) {
        if (file.name === "gone.txt") {
            this.error = new Error("unreadable")
            setTimeout(() => this.onerror?.(), 0)
            return
        }
        this.result = `data:${file.type};base64,aGVsbG8=`
        setTimeout(() => this.onload?.(), 0)
    }
}

const withStubReader = async (run: () => Promise<void>) => {
    const original = (globalThis as {FileReader?: unknown}).FileReader
    ;(globalThis as {FileReader?: unknown}).FileReader = StubFileReader
    try {
        await run()
    } finally {
        ;(globalThis as {FileReader?: unknown}).FileReader = original
    }
}

describe("filesToParts", () => {
    // A staged file can become unreadable between picking and submit (moved, permission revoked,
    // a disconnected drive). That used to reject the whole conversion, losing the message text
    // and every readable attachment with it.
    it("keeps the readable files when one cannot be read", async () => {
        await withStubReader(async () => {
            const good = new File(["hello"], "good.txt", {type: "text/plain"})
            const bad = new File(["x"], "gone.txt", {type: "text/plain"})
            const {parts, rejections} = await filesToParts([good, bad])
            expect(parts.map((p) => p.filename)).toEqual(["good.txt"])
            expect(rejections).toEqual([{name: "gone.txt", reason: "could not be read"}])
        })
    })

    it("reports no rejections when every file reads", async () => {
        await withStubReader(async () => {
            const {parts, rejections} = await filesToParts([
                new File(["a"], "a.txt", {type: "text/plain"}),
                new File(["b"], "b.txt", {type: "text/plain"}),
            ])
            expect(parts).toHaveLength(2)
            expect(rejections).toEqual([])
        })
    })
})

const firstAttachmentId = "019c1e0a-f911-7000-8000-000000000001"

describe("attachment reference parts", () => {
    it("stores size under providerMetadata.agenta", () => {
        const part = attachmentRefsToParts(
            [
                {
                    attachmentId: firstAttachmentId,
                    filename: "notes.txt",
                    mediaType: "text/plain",
                    size: 42,
                },
            ],
            "session-1",
        )[0]

        expect(part).toMatchObject({
            type: "file",
            filename: "notes.txt",
            providerMetadata: {
                agenta: {attachmentId: firstAttachmentId, size: 42},
            },
        })
        expect(part).not.toHaveProperty("size")
        expect(part.url).toContain(
            `/sessions/attachments/${firstAttachmentId}/content?session_id=session-1`,
        )
    })

    it("labels an unnamed reference part 'attachment', not its URL tail", () => {
        expect(
            filePartName({
                type: "file",
                mediaType: "text/plain",
                url: "https://api.example.test/sessions/attachments/id/content?session_id=s",
                providerMetadata: {agenta: {attachmentId: firstAttachmentId, size: 42}},
            }),
        ).toBe("attachment")
    })
})
