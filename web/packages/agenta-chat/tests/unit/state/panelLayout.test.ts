/**
 * Unit tests for the config-pane default rule.
 *
 * The load-bearing case is the stored `false` on a phone: the user asked for the config pane with
 * the `»` reveal button, and a per-device default that overruled that would make the button look
 * broken. `stored ?? phoneViewport` is the whole rule, and it exists because the atom's old plain
 * `false` default could not tell "I want the pane" apart from "I have never said".
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    configPanelCollapsedAtom,
    configPanelCollapsedPreferenceAtom,
    phoneViewportAtom,
    resolveConfigPanelCollapsed,
} from "../../../src/state/panelLayout"

describe("resolveConfigPanelCollapsed", () => {
    it("keeps the config pane visible on a desktop with no preference stored", () => {
        expect(resolveConfigPanelCollapsed(null, false)).toBe(false)
    })

    it("hides the config pane on a phone with no preference stored", () => {
        expect(resolveConfigPanelCollapsed(null, true)).toBe(true)
    })

    it("honours a stored preference to show the pane, phone included", () => {
        expect(resolveConfigPanelCollapsed(false, true)).toBe(false)
    })

    it("honours a stored preference to hide the pane, desktop included", () => {
        expect(resolveConfigPanelCollapsed(true, false)).toBe(true)
    })

    it("hides the config pane on a desktop when the host asks for it", () => {
        expect(resolveConfigPanelCollapsed(null, false, true)).toBe(true)
    })

    it("lets a stored preference beat the host's default, as it beats the phone's", () => {
        expect(resolveConfigPanelCollapsed(false, false, true)).toBe(false)
    })
})

describe("configPanelCollapsedAtom", () => {
    it("reads the phone default and stops doing so once the user chooses", () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)

        // The `»` reveal button: one tap turns the per-device default into a real preference.
        store.set(configPanelCollapsedAtom, false)
        expect(store.get(configPanelCollapsedPreferenceAtom)).toBe(false)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    it("follows the viewport only while no preference is stored", () => {
        const store = createStore()
        expect(store.get(configPanelCollapsedAtom)).toBe(false)

        // Rotating a phone, or resizing a desktop window down, moves the default with it.
        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)

        store.set(configPanelCollapsedAtom, true)
        store.set(phoneViewportAtom, false)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)
    })
})
