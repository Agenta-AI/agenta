// @vitest-environment jsdom
//
// A desktop layout preference must not decide what a phone shows.
//
// The shared `configPanelCollapsedAtom` keeps one origin-wide boolean, and the desktop playground
// writes false to it from the « collapse control, the onboarding provider setup and the variant
// config header. On a phone the config pane does not sit beside the conversation, it replaces it,
// so that false hid the whole chat column, composer and all, on a session nobody had touched from
// the phone. The way in was using the playground in the same browser.
//
// This is the second defect of its shape here, after the maximized flag `resolveSessionPanes`
// documents. Both are pinned at the boolean that hides the column.
import {configPanelCollapsedPreferenceAtom, phoneViewportAtom} from "@agenta/chat/state"
import {createStore} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

import {
    mobileConfigPanelCollapsedAtom,
    mobileConfigPanelCollapsedPreferenceAtom,
} from "@/features/chat/configPaneState"
import {conversationHidden, resolveSessionPanes} from "@/features/chat/sessionPanes"

/** The key the desktop playground writes, which this app must not read. */
const DESKTOP_KEY = "agenta:chat:config-panel-collapsed"

// Seeded BEFORE the module graph loads, which is the only moment either atom reads storage:
// `getOnInit: true` snapshots once. A `beforeEach` write lands after that and a case built on one
// passes whichever key the atom is pointed at, which is no case at all.
vi.hoisted(() => {
    localStorage.setItem("agenta:chat:config-panel-collapsed", "false")
})

/** What the phone renders, from the collapse state it resolves. */
const phoneHidesConversation = (store: ReturnType<typeof createStore>): boolean => {
    const panes = resolveSessionPanes({
        chatMaximized: false,
        configCollapsed: store.get(mobileConfigPanelCollapsedAtom),
        twoPane: false,
        hasEntity: true,
    })
    return conversationHidden({twoPane: false, showPane: panes.showPane})
}

describe("a browser whose desktop playground stored an expanded config pane", () => {
    it("really did store it, so the state under test is the one that broke", () => {
        // The control. Without it, every case below would pass against a store that simply read
        // nothing, including one reading the desktop key.
        expect(createStore().get(configPanelCollapsedPreferenceAtom)).toBe(false)
    })

    it("keeps the conversation on the phone anyway", () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)

        expect(store.get(mobileConfigPanelCollapsedAtom)).toBe(true)
        expect(phoneHidesConversation(store)).toBe(false)
    })
})

describe("the phone's own collapse preference", () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it("still opens the config pane for a reader who asks for it", () => {
        // The fix must not be "the phone never shows config": the chat header's reveal control
        // writes this, and it has to keep working.
        const store = createStore()
        store.set(phoneViewportAtom, true)
        store.set(mobileConfigPanelCollapsedAtom, false)

        expect(store.get(mobileConfigPanelCollapsedAtom)).toBe(false)
        expect(phoneHidesConversation(store)).toBe(true)
    })

    it("writes the phone's own key and never the desktop's", () => {
        const store = createStore()
        store.set(mobileConfigPanelCollapsedAtom, false)

        expect(store.get(mobileConfigPanelCollapsedPreferenceAtom)).toBe(false)
        expect(localStorage.getItem(DESKTOP_KEY)).toBeNull()
    })

    it("hides the config pane by default on a phone and shows it on a wider window", () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)
        expect(store.get(mobileConfigPanelCollapsedAtom)).toBe(true)

        const wide = createStore()
        wide.set(phoneViewportAtom, false)
        expect(wide.get(mobileConfigPanelCollapsedAtom)).toBe(false)
    })
})
