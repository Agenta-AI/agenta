import {describe, expect, it} from "vitest"

import {resolveDrivePath} from "./SessionFilesDrawer"

const files = (...paths: string[]) => paths.map((path) => ({path}))

describe("resolveDrivePath", () => {
    it("prefers an exact listing hit", () => {
        expect(resolveDrivePath(files("README.md", "src/README.md"), "src/README.md")).toBe(
            "src/README.md",
        )
    })

    it("resolves a tool-path tail to the drive path", () => {
        expect(resolveDrivePath(files("notes/a.md"), "/tmp/agenta/mounts/p/m/notes/a.md")).toBe(
            "notes/a.md",
        )
    })

    it("picks the deepest match when several paths share a suffix", () => {
        expect(
            resolveDrivePath(
                files("README.md", "src/README.md"),
                "/tmp/agenta/mounts/p/m/src/README.md",
            ),
        ).toBe("src/README.md")
    })

    it("returns the request unchanged when the listing does not know it", () => {
        expect(resolveDrivePath(files("README.md"), "src/other.md")).toBe("src/other.md")
    })

    it("maps a sandbox path even when the listing does not hold it", () => {
        expect(resolveDrivePath(files("other.md"), "/tmp/agenta/mounts/p/m/deep/x.md")).toBe(
            "deep/x.md",
        )
    })
})
