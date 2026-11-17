import {describe, expect, it} from "vitest"

import {
    AGENT_FILES_DIR,
    isListableDrivePath,
    isDriveLink,
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
        expect(isListableDrivePath(AGENT_FILES_DIR, {fromDriveMount: true})).toBe(true)
        expect(isListableDrivePath(`${AGENT_FILES_DIR}/notes.md`, {fromDriveMount: true})).toBe(
            true,
        )
    })

    it("still drops internal paths from the agent mount", () => {
        expect(isListableDrivePath("", {fromDriveMount: true})).toBe(false)
    })
})

describe("isListableDrivePath with drive links", () => {
    const drives = [{slug: "price-lists"}]

    // The runner links each drive into the session folder at `drives/<slug>`, as it links
    // `agent-files`; the link is plumbing, the drive's files are folded in from its own mount.
    it("drops a configured drives/<slug> link from the session mount, not the files under it", () => {
        expect(isListableDrivePath("drives/price-lists", {drives})).toBe(false)
        expect(isListableDrivePath("/drives/price-lists", {drives})).toBe(false)
        expect(isListableDrivePath("drives/price-lists/2026.md", {drives})).toBe(true)
        expect(isListableDrivePath("drives", {drives})).toBe(true)
    })

    // Only a configured slug is a link: a session file at `drives/notes.md` stays listed.
    it("keeps other entries under drives/ as session files", () => {
        expect(isListableDrivePath("drives/notes.md", {drives})).toBe(true)
        expect(isListableDrivePath("drives/price-lists")).toBe(true)
    })

    it("keeps a real top-level entry inside a drive mount", () => {
        expect(
            isListableDrivePath("drives/price-lists", {fromDriveMount: true, drives}),
        ).toBe(true)
    })

    it("names only the link of a configured slug", () => {
        expect(isDriveLink("drives/price-lists", drives)).toBe(true)
        expect(isDriveLink("drives/price-lists/", drives)).toBe(true)
        expect(isDriveLink("drives", drives)).toBe(false)
        expect(isDriveLink("drives/price-lists/a.md", drives)).toBe(false)
        expect(isDriveLink("drives/other", drives)).toBe(false)
        expect(isDriveLink("notes/drives/price-lists", drives)).toBe(false)
    })
})
