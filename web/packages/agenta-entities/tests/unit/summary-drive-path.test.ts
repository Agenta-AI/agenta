import {describe, expect, it} from "vitest"

import {isListableDrivePath, isSummaryDrivePath} from "../../src/drive/useSessionDrive"

describe("isSummaryDrivePath", () => {
    it("keeps ordinary user files", () => {
        expect(isSummaryDrivePath("notes.md")).toBe(true)
        expect(isSummaryDrivePath("src/main.py")).toBe(true)
    })

    it("drops hidden paths at any depth, so they leave the count and the list together (#6027)", () => {
        expect(isSummaryDrivePath(".env")).toBe(false)
        expect(isSummaryDrivePath(".claude/settings.json")).toBe(false)
        expect(isSummaryDrivePath("src/.hidden/keep.txt")).toBe(false)
    })

    it("still drops what isListableDrivePath drops", () => {
        expect(isSummaryDrivePath("agents/sessions/x.json")).toBe(false)
        expect(isSummaryDrivePath("agent-files")).toBe(false)
    })

    it("keeps a real `agent-files` directory from the agent mount", () => {
        expect(isSummaryDrivePath("agent-files", {fromAgentMount: true})).toBe(true)
    })

    it("is strictly narrower than isListableDrivePath — hidden is the only difference", () => {
        // The browse explorer asks the wider question; it lists hidden files behind its own toggle.
        expect(isListableDrivePath(".gitignore")).toBe(true)
        expect(isSummaryDrivePath(".gitignore")).toBe(false)
    })
})
