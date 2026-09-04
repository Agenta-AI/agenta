import {describe, expect, it} from "vitest"

import {
    closedSessionTabs,
    nearestSurvivingTab,
    openSessionTabRows,
    sessionTabCloseTargets,
    sessionTabScope,
} from "../../src/state/openTabs"

const rows = (...ids: string[]) => ids.map((id) => ({id}))
const tabs = (...specs: string[]) =>
    specs.map((spec) => ({id: spec.replace("*", ""), pinned: spec.endsWith("*")}))

describe("sessionTabScope", () => {
    it("separates an agent's tabs from the project-wide rail", () => {
        expect(sessionTabScope("agent-1")).toBe("agent-1")
        expect(sessionTabScope(null)).toBe("__project__")
        expect(sessionTabScope(undefined)).toBe("__project__")
    })
})

describe("openSessionTabRows", () => {
    it("shows the whole list until the scope is seeded", () => {
        expect(openSessionTabRows(rows("a", "b"), null, "a")).toEqual(rows("a", "b"))
    })

    it("hides a listed session the open set does not hold", () => {
        expect(openSessionTabRows(rows("a", "b", "c"), ["a", "c"], "a")).toEqual(rows("a", "c"))
    })

    it("always renders the active session, even before it joins the set", () => {
        expect(openSessionTabRows(rows("a", "b"), ["a"], "b")).toEqual(rows("a", "b"))
    })

    it("renders nothing for open ids the server list no longer carries", () => {
        expect(openSessionTabRows(rows("a"), ["a", "gone"], "a")).toEqual(rows("a"))
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

describe("sessionTabCloseTargets", () => {
    it("closes every other tab, pinned ones excepted", () => {
        expect(sessionTabCloseTargets(tabs("p*", "a", "b"), "a")).toMatchObject({
            others: ["b"],
            toRight: ["b"],
        })
    })

    it("counts only what follows the tab as to the right", () => {
        expect(sessionTabCloseTargets(tabs("a", "b", "c"), "b")).toMatchObject({
            others: ["a", "c"],
            toRight: ["c"],
        })
    })

    it("has nothing to the right of the last tab", () => {
        expect(sessionTabCloseTargets(tabs("a", "b"), "b").toRight).toEqual([])
    })

    it("never bulk-closes a pinned tab", () => {
        const targets = sessionTabCloseTargets(tabs("a", "p*", "b"), "a")
        expect(targets.others).toEqual(["b"])
        expect(targets.toRight).toEqual(["b"])
    })

    it("refuses to close the only tab", () => {
        expect(sessionTabCloseTargets(tabs("a"), "a").closable).toBe(false)
        expect(sessionTabCloseTargets(tabs("a", "b"), "a").closable).toBe(true)
    })

    it("returns no right-hand targets for a tab the strip does not hold", () => {
        expect(sessionTabCloseTargets(tabs("a", "b"), "gone")).toMatchObject({
            others: ["a", "b"],
            toRight: [],
        })
    })
})
