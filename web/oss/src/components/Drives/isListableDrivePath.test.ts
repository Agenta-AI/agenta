import {describe, expect, it} from "vitest"

import {AGENT_FILES_DIR, isListableDrivePath} from "./useSessionDrive"

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
