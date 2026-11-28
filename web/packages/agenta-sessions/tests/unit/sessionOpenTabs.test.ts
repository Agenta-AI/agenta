import {describe, expect, it} from "vitest"

import {closedSessionTabs, nearestSurvivingTab, sessionTabScope} from "../../src/state/openTabs"

describe("sessionTabScope", () => {
    it("separates an agent's tabs from the project-wide rail", () => {
        expect(sessionTabScope("agent-1")).toBe("agent-1")
        expect(sessionTabScope(null)).toBe("__project__")
        expect(sessionTabScope(undefined)).toBe("__project__")
    })
})

describe("closedSessionTabs", () => {
    it("drops the closed ids and keeps the rest in order", () => {
        expect(closedSessionTabs(["a", "b", "c"], ["b"])).toEqual(["a", "c"])
    })

    it("no-ops on an empty close", () => {
        expect(closedSessionTabs(["a", "b"], [])).toBeNull()
    })

    it("no-ops when nothing named is open", () => {
        expect(closedSessionTabs(["a", "b"], ["z"])).toBeNull()
    })
})

describe("nearestSurvivingTab", () => {
    it("takes the tab that slides into the closed slot", () => {
        expect(nearestSurvivingTab(["a", "b", "c"], new Set(["b"]), "b")).toBe("c")
    })

    it("falls back to the closest tab before it", () => {
        expect(nearestSurvivingTab(["a", "b", "c"], new Set(["b", "c"]), "b")).toBe("a")
    })

    it("returns nothing when the whole strip closes", () => {
        expect(nearestSurvivingTab(["a", "b"], new Set(["a", "b"]), "a")).toBe("")
    })

    it("returns nothing for an active tab the strip does not render", () => {
        expect(nearestSurvivingTab(["a", "b"], new Set(["a"]), "gone")).toBe("")
    })

    it("keeps the active tab when it is not among the closing ones", () => {
        expect(nearestSurvivingTab(["a", "b", "c"], new Set(["c"]), "b")).toBe("b")
    })
})
