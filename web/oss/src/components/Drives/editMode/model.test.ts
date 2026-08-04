import {describe, expect, it} from "vitest"

import {CODE_LANGS, resolveDriveFileKind, TEXT_CAP, type DriveFileKind} from "../driveKinds"

import {
    conflictFromListing,
    driveEditAvailability,
    driveEditorLanguage,
    EDIT_KINDS,
    isEditDirty,
    supportsMarkdownPreview,
    utf8ByteLength,
} from "./model"

describe("resolveDriveFileKind", () => {
    it.each([
        ["notes.txt", "text"],
        ["table.csv", "csv"],
        ["README.md", "markdown"],
        [".env", "text"],
        ["data.json", "json"],
        ["agent-files/.env", "text"],
        [".env.local", "other"],
        ["photo.png", "image"],
        ["report.pdf", "pdf"],
        ["README", "other"],
    ] as const)("maps %s to %s", (path, kind) => {
        expect(resolveDriveFileKind(path)).toBe(kind)
    })
})

describe("driveEditAvailability", () => {
    const kinds: DriveFileKind[] = [
        "markdown",
        "text",
        "code",
        "json",
        "csv",
        "html",
        "image",
        "pdf",
        "audio",
        "video",
        "other",
    ]
    const listingSizes = [TEXT_CAP - 1, TEXT_CAP, TEXT_CAP + 1, null]
    const contentStates = [
        {name: "pending", isPending: true, isFetching: true, contentByteLength: null},
        {name: "fetching", isPending: false, isFetching: true, contentByteLength: TEXT_CAP},
        {name: "loaded", isPending: false, isFetching: false, contentByteLength: TEXT_CAP},
        {name: "unreadable", isPending: false, isFetching: false, contentByteLength: null},
    ] as const

    it("covers every kind, listing size, content state, and edit capability", () => {
        for (const kind of kinds) {
            for (const listingSize of listingSizes) {
                for (const {name, isPending, isFetching, contentByteLength} of contentStates) {
                    for (const canEdit of [true, false]) {
                        const availability = driveEditAvailability({
                            kind,
                            listingSize,
                            contentByteLength,
                            isPending,
                            isFetching,
                            canEdit,
                        })
                        const expected =
                            !canEdit || !EDIT_KINDS.has(kind)
                                ? "unavailable"
                                : listingSize != null && listingSize > TEXT_CAP
                                  ? "too-large"
                                  : name === "pending" || name === "fetching"
                                    ? "loading"
                                    : name === "unreadable"
                                      ? "unreadable"
                                      : "enabled"
                        expect(availability).toBe(expected)
                        if (availability === "too-large") expect(EDIT_KINDS.has(kind)).toBe(true)
                        if (name === "unreadable") expect(availability).not.toBe("enabled")
                    }
                }
            }
        }
    })

    it("caps loaded content when the listing size is unknown", () => {
        expect(
            driveEditAvailability({
                kind: "text",
                listingSize: null,
                contentByteLength: TEXT_CAP + 1,
                isPending: false,
                isFetching: false,
                canEdit: true,
            }),
        ).toBe("too-large")
    })

    it("enables content exactly at the cap", () => {
        expect(
            driveEditAvailability({
                kind: "text",
                listingSize: TEXT_CAP,
                contentByteLength: TEXT_CAP,
                isPending: false,
                isFetching: false,
                canEdit: true,
            }),
        ).toBe("enabled")
    })
})

describe("supportsMarkdownPreview", () => {
    it("offers preview only for markdown paths", () => {
        expect(supportsMarkdownPreview("README.md")).toBe(true)
        expect(supportsMarkdownPreview("notes.markdown")).toBe(true)
        expect(supportsMarkdownPreview("data.json")).toBe(false)
        expect(supportsMarkdownPreview("README")).toBe(false)
    })
})

describe("utf8ByteLength", () => {
    it("counts UTF-8 bytes instead of UTF-16 code units", () => {
        expect(utf8ByteLength("é".repeat(TEXT_CAP))).toBe(TEXT_CAP * 2)
    })
})

describe("driveEditorLanguage", () => {
    const languages = new Set(["json", "yaml", "code", "python", "javascript", "typescript"])

    it("maps every configured code extension into the editor language union", () => {
        for (const extension of Object.keys(CODE_LANGS)) {
            expect(languages.has(driveEditorLanguage(`file.${extension}`))).toBe(true)
        }
    })

    it.each([
        ["file.json", "json"],
        ["file.yaml", "yaml"],
        ["file.py", "python"],
        ["file.sh", "code"],
        ["file.md", "code"],
    ] as const)("maps %s to %s", (path, language) => {
        expect(driveEditorLanguage(path)).toBe(language)
    })
})

describe("isEditDirty", () => {
    it.each([
        ["before", "after", true],
        ["same", "same", false],
        ["typed", "typed", false],
        ["line", "line\n", true],
        ["", "text", true],
        ["", "", false],
    ] as const)("compares the original and draft exactly", (original, draft, expected) => {
        expect(isEditDirty(original, draft)).toBe(expected)
    })
})

describe("conflictFromListing", () => {
    it("reports a missing entry", () => {
        expect(conflictFromListing([], "notes.txt", 10)).toEqual({
            reason: "missing",
            theirMtime: null,
        })
    })

    it("reports a changed mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: 11}], "notes.txt", 10)).toEqual({
            reason: "changed",
            theirMtime: 11,
        })
    })

    it("accepts an unchanged mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: 10}], "notes.txt", 10)).toBeNull()
    })

    it("fails closed when a null baseline meets a real listing mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: 11}], "notes.txt", null)).toEqual({
            reason: "changed",
            theirMtime: 11,
        })
    })

    it("accepts a null baseline only when the listing also omits mtime", () => {
        expect(
            conflictFromListing([{path: "notes.txt", mtime: null}], "notes.txt", null),
        ).toBeNull()
    })

    it("accepts an unknown listing mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: null}], "notes.txt", 10)).toBeNull()
    })
})
