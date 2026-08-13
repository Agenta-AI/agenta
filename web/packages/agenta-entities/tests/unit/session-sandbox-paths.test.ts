import {describe, expect, it} from "vitest"

import {isSandboxPath, toolPathToDrivePath} from "../../src/session/core/sandboxPaths"

describe("toolPathToDrivePath", () => {
    it("maps a local session cwd path to its mount-relative path", () => {
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1/README.md")).toBe("README.md")
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1/src/lib/index.ts")).toBe(
            "src/lib/index.ts",
        )
    })

    it("maps a Daytona sandbox path the same way", () => {
        expect(toolPathToDrivePath("/home/sandbox/agenta/mounts/proj-1/mount-1/notes/a.md")).toBe(
            "notes/a.md",
        )
    })

    it("folds the agent mount under agent-files/", () => {
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1-agent/SKILL.md")).toBe(
            "agent-files/SKILL.md",
        )
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1-agent")).toBe("agent-files")
    })

    it("maps the mount root itself to the drive root", () => {
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1")).toBe("")
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1/mount-1/")).toBe("")
    })

    it("leaves a path that is already drive-relative alone", () => {
        expect(toolPathToDrivePath("README.md")).toBeNull()
        expect(toolPathToDrivePath("src/lib/index.ts")).toBeNull()
        expect(toolPathToDrivePath("agent-files/SKILL.md")).toBeNull()
    })

    it("ignores absolute paths outside the mounts", () => {
        expect(toolPathToDrivePath("/etc/hosts")).toBeNull()
        expect(toolPathToDrivePath("/home/sandbox/scratch/a.md")).toBeNull()
        // The prefix must be a real mount root: `agenta/mounts` needs a project AND a mount segment.
        expect(toolPathToDrivePath("/tmp/agenta/mounts/proj-1")).toBeNull()
    })

    it("reports membership through isSandboxPath", () => {
        expect(isSandboxPath("/tmp/agenta/mounts/proj-1/mount-1/README.md")).toBe(true)
        expect(isSandboxPath("/etc/hosts")).toBe(false)
        expect(isSandboxPath("README.md")).toBe(false)
    })
})
