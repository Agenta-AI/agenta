// @vitest-environment jsdom
/**
 * The builder tabs of the builder page (tasks 40.1 to 40.3): opening, the dot of a builder
 * result, the closed-tab memory, the cap of 50, closing the active tab, the address, storage per
 * chat, and the row fit with "N more".
 */
import {afterEach, describe, expect, it} from "vitest"

import {
    applyAddressTab,
    activateBuilderTab,
    builderTabKey,
    builderTabsKey,
    closeBuilderTab,
    EMPTY_BUILDER_TABS,
    followBuilderResult,
    MAX_BUILDER_TABS,
    openBuilderTab,
    readBuilderTabs,
    writeBuilderTabs,
    type BuilderTab,
} from "@/features/builder-page/builderTabs"
import {fitTabs} from "@/features/builder-page/fitTabs"

const agent = (id: string, name = id): BuilderTab => ({kind: "agent", id, name})

afterEach(() => window.localStorage.clear())

describe("builder tabs", () => {
    it("opens the first builder result active with no dot, later ones with a dot", () => {
        let state = followBuilderResult(EMPTY_BUILDER_TABS, agent("lead-finder", "Lead finder"))
        expect(state.active).toBe("agent:lead-finder")
        expect(state.tabs[0].dot).toBe(false)
        state = followBuilderResult(state, agent("email-writer", "Email writer"))
        expect(state.active).toBe("agent:lead-finder")
        expect(state.tabs.map(builderTabKey)).toEqual(["agent:lead-finder", "agent:email-writer"])
        expect(state.tabs[1].dot).toBe(true)
    })

    it("marks an open tab that is not active, never the active one", () => {
        let state = followBuilderResult(EMPTY_BUILDER_TABS, agent("a"))
        state = followBuilderResult(state, agent("b"))
        state = activateBuilderTab(state, "agent:b")
        expect(state.tabs[1].dot).toBe(false)
        state = followBuilderResult(state, agent("b"))
        expect(state.tabs[1].dot).toBe(false)
        state = followBuilderResult(state, agent("a"))
        expect(state.tabs[0].dot).toBe(true)
    })

    it("does not reopen a closed tab by itself; the person can open it again", () => {
        let state = followBuilderResult(EMPTY_BUILDER_TABS, agent("a"))
        state = followBuilderResult(state, agent("b"))
        state = closeBuilderTab(state, "agent:b")
        expect(followBuilderResult(state, agent("b"))).toBe(state)
        state = openBuilderTab(state, agent("b"))
        expect(state.active).toBe("agent:b")
        expect(state.closed).toEqual([])
    })

    it("makes the nearest tab active when the active one closes, and none after the last", () => {
        let state = openBuilderTab(EMPTY_BUILDER_TABS, agent("a"))
        state = openBuilderTab(state, agent("b"))
        state = openBuilderTab(state, agent("c"))
        state = activateBuilderTab(state, "agent:b")
        state = closeBuilderTab(state, "agent:b")
        expect(state.active).toBe("agent:c")
        state = closeBuilderTab(state, "agent:c")
        expect(state.active).toBe("agent:a")
        state = closeBuilderTab(state, "agent:a")
        expect(state.active).toBeNull()
        expect(state.tabs).toEqual([])
    })

    it("keeps at most 50 tabs: the oldest tab that is not active closes", () => {
        let state = openBuilderTab(EMPTY_BUILDER_TABS, agent("first"))
        for (let i = 1; i < MAX_BUILDER_TABS; i++)
            state = followBuilderResult(state, agent(`a${i}`))
        expect(state.tabs).toHaveLength(MAX_BUILDER_TABS)
        state = followBuilderResult(state, agent("new"))
        expect(state.tabs).toHaveLength(MAX_BUILDER_TABS)
        expect(state.active).toBe("agent:first")
        expect(state.tabs.map(builderTabKey)).not.toContain("agent:a1")
        expect(state.tabs.map(builderTabKey)).toContain("agent:new")
    })

    it("opens the tab a shared link names", () => {
        const state = applyAddressTab(EMPTY_BUILDER_TABS, {kind: "agent", id: "x"})
        expect(state.active).toBe("agent:x")
        expect(applyAddressTab(state, {kind: "agent", id: "x"})).toBe(state)
    })
})

describe("builder tab storage", () => {
    it("keeps tabs per chat, survives a reload, and reads nothing for another chat", () => {
        let state = followBuilderResult(EMPTY_BUILDER_TABS, agent("a", "Lead finder"))
        state = followBuilderResult(state, agent("b", "Email writer"))
        state = activateBuilderTab(state, "agent:b")
        writeBuilderTabs("chat-1", state)
        expect(readBuilderTabs("chat-1")).toEqual(state)
        expect(readBuilderTabs("chat-2")).toEqual(EMPTY_BUILDER_TABS)
    })

    it("reads a broken value as no tabs", () => {
        window.localStorage.setItem(builderTabsKey("chat-1"), "{not json")
        expect(readBuilderTabs("chat-1")).toEqual(EMPTY_BUILDER_TABS)
        window.localStorage.setItem(
            builderTabsKey("chat-1"),
            JSON.stringify({
                tabs: [
                    {kind: "thing", id: "x"},
                    {kind: "agent", id: "a"},
                ],
                active: "nope",
            }),
        )
        const read = readBuilderTabs("chat-1")
        expect(read.tabs.map(builderTabKey)).toEqual(["agent:a"])
        expect(read.active).toBe("agent:a")
    })
})

describe("fitTabs", () => {
    const keys = ["lead", "email", "daily", "enrich", "dentist"]
    const widths = {lead: 120, email: 130, daily: 140, enrich: 140, dentist: 200}
    it("shows every tab that fits", () => {
        expect(
            fitTabs({keys, active: "email", widths, room: 2000, moreWidth: 90, gap: 4}).hidden,
        ).toEqual([])
    })

    it("puts the tabs that do not fit into the list, keeping the active tab", () => {
        const fit = fitTabs({keys, active: "email", widths, room: 520, moreWidth: 90, gap: 4})
        expect(fit.visible).toEqual(["lead", "email", "daily"])
        expect(fit.hidden).toEqual(["enrich", "dentist"])
        const picked = fitTabs({keys, active: "enrich", widths, room: 520, moreWidth: 90, gap: 4})
        expect(picked.visible).toContain("enrich")
        expect(picked.hidden).toHaveLength(2)
    })
})
