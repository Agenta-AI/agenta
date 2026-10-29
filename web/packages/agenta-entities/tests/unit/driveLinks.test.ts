import {describe, expect, it} from "vitest"

import {resolveDriveLink} from "../../src/drive/driveLinks"

describe("resolveDriveLink", () => {
    const from = "agent-files/docs/guide.md"

    it("leaves the browser's links alone", () => {
        expect(resolveDriveLink("https://example.com/a.md", from)).toBeNull()
        expect(resolveDriveLink("mailto:a@b.c", from)).toBeNull()
        expect(resolveDriveLink("//evil.com/x", from)).toBeNull()
        expect(resolveDriveLink("\\\\evil.com/x", from)).toBeNull()
        expect(resolveDriveLink("#section", from)).toBeNull()
        expect(resolveDriveLink("", from)).toBeNull()
        expect(resolveDriveLink(undefined, from)).toBeNull()
    })

    it("resolves a sibling, a nested and a parent path against the file's folder", () => {
        expect(resolveDriveLink("notes.md", from)).toBe("agent-files/docs/notes.md")
        expect(resolveDriveLink("./img/a.png", from)).toBe("agent-files/docs/img/a.png")
        expect(resolveDriveLink("../README.md", from)).toBe("agent-files/README.md")
        expect(resolveDriveLink("../../README.md", from)).toBe("README.md")
        expect(resolveDriveLink("../../../README.md", from)).toBe("README.md")
    })

    it("reads a leading slash as the drive root", () => {
        expect(resolveDriveLink("/agent-files/x.md", from)).toBe("agent-files/x.md")
        expect(resolveDriveLink("/", from)).toBeNull()
    })

    it("drops a query or fragment tail and decodes a percent-encoded name", () => {
        expect(resolveDriveLink("notes.md#top", from)).toBe("agent-files/docs/notes.md")
        expect(resolveDriveLink("notes.md?x=1", from)).toBe("agent-files/docs/notes.md")
        expect(resolveDriveLink("my%20notes.md", from)).toBe("agent-files/docs/my notes.md")
        expect(resolveDriveLink("100%.md", from)).toBe("agent-files/docs/100%.md")
    })

    it("resolves from a root-level file", () => {
        expect(resolveDriveLink("other.md", "README.md")).toBe("other.md")
    })
})

describe("resolveDriveLink with the tree in hand", () => {
    const tree = new Set([
        "agent-files",
        "agent-files/notes.md",
        "agent-files/guide.md",
        "attachments",
        "CLAUDE.md",
    ])
    const exists = (p: string) => tree.has(p)
    const from = "agent-files/guide.md"

    it("reads a bare path the agent wrote from its cwd when the file's folder has no such thing", () => {
        expect(resolveDriveLink("attachments/abc/photo.png", from, exists)).toBe(
            "attachments/abc/photo.png",
        )
        expect(resolveDriveLink("CLAUDE.md", from, exists)).toBe("CLAUDE.md")
    })

    it("still prefers the sibling markdown means when it exists", () => {
        expect(resolveDriveLink("notes.md", from, exists)).toBe("agent-files/notes.md")
    })

    it("keeps an explicit ./ or ../ file-relative even if the root has a match", () => {
        expect(resolveDriveLink("./CLAUDE.md", from, exists)).toBe("agent-files/CLAUDE.md")
        expect(resolveDriveLink("../CLAUDE.md", from, exists)).toBe("CLAUDE.md")
    })

    it("falls back to file-relative when neither reading is known", () => {
        expect(resolveDriveLink("missing/x.md", from, exists)).toBe("agent-files/missing/x.md")
    })

    it("has one reading at the root, so nothing to disambiguate", () => {
        expect(resolveDriveLink("attachments/abc/photo.png", "CLAUDE.md", exists)).toBe(
            "attachments/abc/photo.png",
        )
    })
})
