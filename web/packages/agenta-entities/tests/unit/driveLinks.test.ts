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
