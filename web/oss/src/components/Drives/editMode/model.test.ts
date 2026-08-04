import {describe, expect, it} from "vitest"

import {CODE_LANGS, resolveDriveFileKind, TEXT_CAP, type DriveFileKind} from "../driveKinds"

import {
    conflictFromListing,
    driveEditAvailability,
    driveEditBufferMode,
    driveEditorLanguage,
    EDIT_KINDS,
    isEditDirty,
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
        {name: "pending", isPending: true, contentLength: null},
        {name: "loaded", isPending: false, contentLength: TEXT_CAP},
        {name: "unreadable", isPending: false, contentLength: null},
    ] as const

    it("covers every kind, listing size, content state, and edit capability", () => {
        for (const kind of kinds) {
            for (const listingSize of listingSizes) {
                for (const {name, isPending, contentLength} of contentStates) {
                    for (const canEdit of [true, false]) {
                        const availability = driveEditAvailability({
                            kind,
                            listingSize,
                            contentLength,
                            isPending,
                            canEdit,
                        })
                        const expected =
                            !canEdit || !EDIT_KINDS.has(kind)
                                ? "unavailable"
                                : listingSize != null && listingSize > TEXT_CAP
                                  ? "too-large"
                                  : name === "pending"
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
                contentLength: TEXT_CAP + 1,
                isPending: false,
                canEdit: true,
            }),
        ).toBe("too-large")
    })

    it("enables content exactly at the cap", () => {
        expect(
            driveEditAvailability({
                kind: "text",
                listingSize: TEXT_CAP,
                contentLength: TEXT_CAP,
                isPending: false,
                canEdit: true,
            }),
        ).toBe("enabled")
    })
})

describe("driveEditBufferMode", () => {
    it("uses markdown mode only for markdown paths", () => {
        expect(driveEditBufferMode("README.md")).toBe("markdown")
        expect(driveEditBufferMode("notes.markdown")).toBe("markdown")
        expect(driveEditBufferMode("data.json")).toBe("code")
        expect(driveEditBufferMode("README")).toBe("code")
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

    it("accepts an unknown base mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: 11}], "notes.txt", null)).toBeNull()
    })

    it("accepts an unknown listing mtime", () => {
        expect(conflictFromListing([{path: "notes.txt", mtime: null}], "notes.txt", 10)).toBeNull()
    })
})
