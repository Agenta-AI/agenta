import {describe, expect, it} from "vitest"

import {
    driveKindTone,
    fileTypeChip,
    fileTypeLabel,
    resolveDriveFileKind,
} from "../../src/drive/driveKinds"

describe("resolveDriveFileKind", () => {
    it("maps the extension families", () => {
        expect(resolveDriveFileKind("a/README.md")).toBe("markdown")
        expect(resolveDriveFileKind("notes.txt")).toBe("text")
        expect(resolveDriveFileKind("data.jsonl")).toBe("text")
        expect(resolveDriveFileKind("agent.json")).toBe("json")
        expect(resolveDriveFileKind("nb.ipynb")).toBe("json")
        expect(resolveDriveFileKind("rows.tsv")).toBe("csv")
        expect(resolveDriveFileKind("index.html")).toBe("html")
        expect(resolveDriveFileKind("shot.avif")).toBe("image")
        expect(resolveDriveFileKind("deck.pdf")).toBe("pdf")
        expect(resolveDriveFileKind("voice.opus")).toBe("audio")
        expect(resolveDriveFileKind("clip.m4v")).toBe("video")
        expect(resolveDriveFileKind("app.vue")).toBe("code")
        expect(resolveDriveFileKind("main.tf")).toBe("code")
    })

    it("recognises extensionless and dot files", () => {
        expect(resolveDriveFileKind("Dockerfile")).toBe("code")
        expect(resolveDriveFileKind("build/Makefile")).toBe("code")
        expect(resolveDriveFileKind("LICENSE")).toBe("text")
        expect(resolveDriveFileKind(".gitignore")).toBe("text")
        expect(resolveDriveFileKind(".env")).toBe("text")
        expect(resolveDriveFileKind("app/.env.local")).toBe("text")
    })

    it("falls back to other for an unknown blob", () => {
        expect(resolveDriveFileKind("archive.zip")).toBe("other")
        expect(resolveDriveFileKind("model.bin")).toBe("other")
    })
})

describe("labels and tones", () => {
    it("reads well where the bare extension does not", () => {
        expect(fileTypeLabel("script.py")).toBe("Python")
        expect(fileTypeLabel("shot.png")).toBe("Image")
        expect(fileTypeLabel("notes.md")).toBe("Markdown")
        expect(fileTypeLabel("Dockerfile")).toBe("Code")
        expect(fileTypeLabel("LICENSE")).toBe("Text")
        expect(fileTypeLabel("x.csv")).toBe("CSV")
    })

    it("chips are short and upper-case", () => {
        expect(fileTypeChip("a.md")).toBe("MD")
        expect(fileTypeChip("a.mdx")).toBe("MDX")
        expect(fileTypeChip("Dockerfile")).toBe("DOCKER")
        expect(fileTypeChip("blob.unknownext")).toBe("FILE")
    })

    it("tones follow the design's chip palette", () => {
        expect(driveKindTone("markdown")).toBe("info")
        expect(driveKindTone("json")).toBe("warning")
        expect(driveKindTone("image")).toBe("warning")
        expect(driveKindTone("csv")).toBe("success")
        expect(driveKindTone("code", "x.py")).toBe("success")
        expect(driveKindTone("code", "x.ts")).toBe("neutral")
        expect(driveKindTone("pdf")).toBe("error")
        expect(driveKindTone("html")).toBe("error")
        expect(driveKindTone("other")).toBe("neutral")
    })
})
