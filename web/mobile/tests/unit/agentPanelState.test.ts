import {describe, expect, it} from "vitest"

import {
    clampPanelWidth,
    DEFAULT_PANEL_STATE,
    nextPanelContent,
    panelMode,
    panelStateKey,
    parsePanelState,
} from "@/features/agent-layout/agentPanelState"

describe("agent panel state", () => {
    it("clamps the width to 360..640", () => {
        expect(clampPanelWidth(100)).toBe(360)
        expect(clampPanelWidth(500.4)).toBe(500)
        expect(clampPanelWidth(900)).toBe(640)
    })

    it("keys the state by user and project, so a second user starts fresh", () => {
        expect(panelStateKey("u1", "p1")).toBe("agenta:agent-panel:u1:p1")
        expect(panelStateKey("u2", "p1")).not.toBe(panelStateKey("u1", "p1"))
    })

    it("reads nothing or garbage as closed at the default width", () => {
        expect(parsePanelState(null)).toEqual(DEFAULT_PANEL_STATE)
        expect(parsePanelState("{not json")).toEqual(DEFAULT_PANEL_STATE)
        expect(
            parsePanelState(JSON.stringify({content: "drives", width: "x", configTab: 3})),
        ).toEqual(DEFAULT_PANEL_STATE)
        expect(
            parsePanelState(JSON.stringify({content: "builder", width: 9999, configTab: "access"})),
        ).toEqual({content: "builder", width: 640, configTab: "access"})
    })

    it("closes on the open content's icon and swaps on another", () => {
        expect(nextPanelContent(null, "files")).toBe("files")
        expect(nextPanelContent("configuration", "builder")).toBe("builder")
        expect(nextPanelContent("builder", "builder")).toBeNull()
    })

    it("pushes at 1100 px and wider, overlays below, and goes full screen under 768 px", () => {
        expect(panelMode(1440)).toBe("push")
        expect(panelMode(1100)).toBe("push")
        expect(panelMode(1099)).toBe("overlay")
        expect(panelMode(768)).toBe("overlay")
        expect(panelMode(767)).toBe("phone")
    })
})
