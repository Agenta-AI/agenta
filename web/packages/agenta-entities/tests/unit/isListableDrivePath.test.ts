import {describe, expect, it} from "vitest"

import {
    AGENT_FILES_DIR,
    isListableDrivePath,
    isProjectDriveLink,
} from "../../src/drive/useSessionDrive"

describe("isListableDrivePath", () => {
    it("keeps ordinary files and folders", () => {
        expect(isListableDrivePath("README.md")).toBe(true)
        expect(isListableDrivePath("reports/q3.csv")).toBe(true)
    })

    it("drops empty and runner-internal paths", () => {
        expect(isListableDrivePath("")).toBe(false)
        expect(isListableDrivePath("/")).toBe(false)
    })

    // In the SESSION mount the bare name is the fold-point symlink into the agent mount, so it is
    // plumbing rather than a file; its contents are listed folded under `agent-files/`.
    it("drops the fold marker from the session mount", () => {
        expect(isListableDrivePath(AGENT_FILES_DIR)).toBe(false)
        expect(isListableDrivePath(`/${AGENT_FILES_DIR}`)).toBe(false)
    })

    // Inside the agent mount there is no fold, so the same name is a real directory the user made.
    // Dropping it there hid the folder from the root listing while the count still counted it.
    it("keeps a real agent-files directory that lives IN the agent mount", () => {
        expect(isListableDrivePath(AGENT_FILES_DIR, {fromAgentMount: true})).toBe(true)
        expect(isListableDrivePath(`${AGENT_FILES_DIR}/notes.md`, {fromAgentMount: true})).toBe(
            true,
        )
    })

    it("still drops internal paths from the agent mount", () => {
        expect(isListableDrivePath("", {fromAgentMount: true})).toBe(false)
    })
})

describe("isListableDrivePath with project drive links", () => {
    // The runner links each project drive into the session folder at `drives/<slug>`, as it links
    // `agent-files`; the link is plumbing, the drive's files are folded in from its own mount.
    it("drops a drives/<slug> link from the session mount, but not the files under it", () => {
        expect(isListableDrivePath("drives/price-lists")).toBe(false)
        expect(isListableDrivePath("/drives/price-lists")).toBe(false)
        expect(isListableDrivePath("drives/price-lists/2026.md")).toBe(true)
        expect(isListableDrivePath("drives")).toBe(true)
    })

    it("keeps a real top-level entry inside a project mount", () => {
        expect(isListableDrivePath("drives/notes.md", {fromAgentMount: true})).toBe(true)
    })

    it("names only the link itself", () => {
        expect(isProjectDriveLink("drives/price-lists")).toBe(true)
        expect(isProjectDriveLink("drives/price-lists/")).toBe(true)
        expect(isProjectDriveLink("drives")).toBe(false)
        expect(isProjectDriveLink("drives/price-lists/a.md")).toBe(false)
        expect(isProjectDriveLink("notes/drives/x")).toBe(false)
    })
})
