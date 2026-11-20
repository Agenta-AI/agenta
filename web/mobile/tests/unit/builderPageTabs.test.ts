// @vitest-environment jsdom
/**
 * The builder tabs of the builder page (tasks 27.2, 40.1 to 40.3): the first tab from a builder
 * result, the page context or the browser link; the dot of a later result; the closed-tab
 * memory; the cap of 50; closing the active tab; the address; storage per chat; and the row fit
 * with "N more".
 */
import {createElement, type ReactNode} from "react"

import {act, renderHook} from "@testing-library/react"
import type {UIMessage} from "ai"
import {createStore, Provider} from "jotai"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    applyAddressTab,
    activateBuilderTab,
    builderTabKey,
    builderTabsStorageKey,
    closeBuilderTab,
    EMPTY_BUILDER_TABS,
    followBuilderResult,
    followBuilderResults,
    MAX_BUILDER_TABS,
    openBuilderTab,
    builderTabsAtomFamily,
    parseBuilderTabs,
    type BuilderTab,
    type BuilderTabsState,
} from "@/features/builder-page/builderTabs"
import {fitTabs} from "@/features/builder-page/fitTabs"
import type {AgentResult} from "@/features/builder-page/paneAgent"
import {useBuilderTabs} from "@/features/builder-page/useBuilderTabs"

const router = vi.hoisted(() => ({replace: vi.fn(() => Promise.resolve(true))}))
vi.mock("next/router", () => ({useRouter: () => router}))

const agent = (id: string, name = id): BuilderTab => ({kind: "agent", id, name})

const result = (toolCallId: string, id: string, saved = true): AgentResult => ({
    toolCallId,
    agent: {id, name: id},
    saved,
})

/** Tabs as the browser stores them. */
const writeTabs = (sessionId: string, state: BuilderTabsState) =>
    window.localStorage.setItem(builderTabsStorageKey(sessionId), JSON.stringify(state))
const storedTabs = (sessionId: string) =>
    parseBuilderTabs(
        JSON.parse(window.localStorage.getItem(builderTabsStorageKey(sessionId)) ?? "null"),
    )
/** A fresh store per hook, so each test reads the browser storage again. */
const wrapper = ({children}: {children: ReactNode}) =>
    createElement(Provider, {store: createStore()}, children)

afterEach(() => {
    builderTabsAtomFamily.setShouldRemove(() => true)
    builderTabsAtomFamily.setShouldRemove(null)
    window.localStorage.clear()
    router.replace.mockClear()
})

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

describe("builder results", () => {
    it("opens the first tab for the latest result, else the page context, and follows nothing old", () => {
        const fromResult = followBuilderResults(
            EMPTY_BUILDER_TABS,
            [result("c1", "a"), result("c2", "b")],
            {id: "ctx", name: "ctx"},
        )
        expect(fromResult.active).toBe("agent:b")
        expect(fromResult.tabs.map(builderTabKey)).toEqual(["agent:b"])
        expect(fromResult.followedToolCallIds).toEqual(["c1", "c2"])
        const fromContext = followBuilderResults(EMPTY_BUILDER_TABS, [], {id: "ctx", name: "ctx"})
        expect(fromContext.active).toBe("agent:ctx")
    })

    it("opens a new saved result with a dot, once, and skips unsaved results", () => {
        let state = followBuilderResults(EMPTY_BUILDER_TABS, [result("c1", "a")], null)
        const results = [result("c1", "a"), result("c2", "b", false), result("c3", "c")]
        state = followBuilderResults(state, results, null)
        expect(state.tabs.map(builderTabKey)).toEqual(["agent:a", "agent:c"])
        expect(state.tabs[1].dot).toBe(true)
        state = activateBuilderTab(state, "agent:c")
        state = activateBuilderTab(state, "agent:a")
        // The same messages again (a reload): no dot comes back.
        expect(followBuilderResults(state, results, null)).toBe(state)
    })

    it("follows each result once in a long chat", () => {
        const many = Array.from({length: 250}, (_, at) => result(`c${at}`, `a${at % 3}`))
        let state = followBuilderResults(EMPTY_BUILDER_TABS, many, null)
        state = activateBuilderTab(state, "agent:a0")
        expect(followBuilderResults(state, many, null)).toBe(state)
    })
})

describe("useBuilderTabs and the address", () => {
    const base = {
        sessionId: "chat-1",
        routeChatId: "chat-1",
        linkedAgentId: null,
        workspaceId: "w",
        projectId: "p",
    }
    const stored = () => {
        let state = openBuilderTab(EMPTY_BUILDER_TABS, agent("a"))
        state = openBuilderTab(state, agent("b"))
        writeTabs("chat-1", activateBuilderTab(state, "agent:a"))
    }

    it("a link with a tab wins over the stored active tab", () => {
        stored()
        const hook = renderHook(() => useBuilderTabs({...base, tab: "agent:b"}), {wrapper})
        expect(hook.result.current.state.active).toBe("agent:b")
        expect(router.replace).not.toHaveBeenCalled()
    })

    it("an address with no tab shows the stored active tab", () => {
        stored()
        renderHook(() => useBuilderTabs({...base, tab: undefined}), {wrapper})
        expect(router.replace).toHaveBeenCalledWith(
            "/w/w/p/p/builder/chat-1?tab=agent%3Aa",
            undefined,
            {shallow: true},
        )
    })

    it("a chat whose messages name no agent opens the agent the browser linked it to", () => {
        const hook = renderHook(
            () =>
                useBuilderTabs({
                    ...base,
                    routeChatId: null,
                    linkedAgentId: "linked",
                    tab: undefined,
                }),
            {wrapper},
        )
        // History still loading: no tab yet.
        act(() => hook.result.current.onMessagesChanged([]))
        expect(hook.result.current.state.active).toBeNull()
        const hello = {id: "u1", role: "user", parts: [{type: "text", text: "hello"}]} as UIMessage
        act(() => hook.result.current.onMessagesChanged([hello]))
        expect(hook.result.current.state.active).toBe("agent:linked")
    })

    it("closing the last tab clears the tab from the address, so a reload does not reopen it", () => {
        writeTabs("chat-1", openBuilderTab(EMPTY_BUILDER_TABS, agent("a")))
        const hook = renderHook(() => useBuilderTabs({...base, tab: "agent:a"}), {wrapper})
        act(() => hook.result.current.close("agent:a"))
        expect(router.replace).toHaveBeenLastCalledWith("/w/w/p/p/builder/chat-1", undefined, {
            shallow: true,
        })
        expect(storedTabs("chat-1").closed).toEqual(["agent:a"])
    })
})

describe("builder tab storage", () => {
    it("keeps tabs per chat, survives a reload, and reads nothing for another chat", () => {
        let state = followBuilderResult(EMPTY_BUILDER_TABS, agent("a", "Lead finder"))
        state = followBuilderResult(state, agent("b", "Email writer"))
        state = activateBuilderTab(state, "agent:b")
        createStore().set(builderTabsAtomFamily("chat-1"), state)
        expect(storedTabs("chat-1")).toEqual(state)
        expect(createStore().get(builderTabsAtomFamily("chat-2"))).toEqual(EMPTY_BUILDER_TABS)
    })

    it("keeps each chat's tabs for this visit when storage refuses", () => {
        const state = openBuilderTab(EMPTY_BUILDER_TABS, agent("a"))
        const refuse = [
            vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
                throw new Error("blocked")
            }),
            vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
                throw new Error("blocked")
            }),
        ]
        const store = createStore()
        const tabsAtom = builderTabsAtomFamily("chat-blocked")
        // Mounted, then another chat, then back: the atom reads storage again on each mount.
        let stop = store.sub(tabsAtom, () => {})
        store.set(tabsAtom, state)
        stop()
        stop = store.sub(tabsAtom, () => {})
        expect(store.get(tabsAtom)).toEqual(state)
        stop()
        refuse.forEach((spy) => spy.mockRestore())
    })

    it("reads a broken value as no tabs", () => {
        window.localStorage.setItem(builderTabsStorageKey("chat-broken"), "{not json")
        const store = createStore()
        const stop = store.sub(builderTabsAtomFamily("chat-broken"), () => {})
        expect(store.get(builderTabsAtomFamily("chat-broken"))).toEqual(EMPTY_BUILDER_TABS)
        stop()
        const read = parseBuilderTabs({
            tabs: [
                {kind: "thing", id: "x"},
                {kind: "agent", id: "a"},
            ],
            active: "nope",
        })
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
