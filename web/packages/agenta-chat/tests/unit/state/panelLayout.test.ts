/**
 * Unit tests for `revealConfigPaneAtom`, the "show me the configuration" action: it must clear
 * every reason the config pane is hidden, and store the reveal against the viewport it was used on.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    configPanelCollapsedPhonePreferenceAtom,
    configPanelCollapsedPreferenceAtom,
    phoneViewportAtom,
    revealConfigPaneAtom,
} from "../../../src/state/panelLayout"

describe("revealConfigPaneAtom", () => {
    // #6381: Edit navigated and nothing else, so anyone who had collapsed the pane OR left
    // Build/Chat maximized landed on a playground with no configuration and no explanation.
    it("clears BOTH things that hide the pane", () => {
        const store = createStore()
        store.set(chatPanelMaximizedAtom, true)
        store.set(configPanelCollapsedAtom, true)

        store.set(revealConfigPaneAtom)

        expect(store.get(chatPanelMaximizedAtom)).toBe(false)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    it("is a no-op when the pane is already showing", () => {
        const store = createStore()
        store.set(revealConfigPaneAtom)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    // The reveal writes through configPanelCollapsedAtom, so it stores against the viewport it
    // was used on — Edit on a phone must not answer for the desktop.
    it("stores the reveal against the viewport it happened on", () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)
        store.set(revealConfigPaneAtom)

        expect(store.get(configPanelCollapsedPhonePreferenceAtom)).toBe(false)
        expect(store.get(configPanelCollapsedPreferenceAtom)).toBeNull()
    })
})
