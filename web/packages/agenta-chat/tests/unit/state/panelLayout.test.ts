/**
 * Unit tests for the config-pane default rule.
 *
 * `stored ?? phoneViewport` is the whole rule, and it exists because the atom's old plain `false`
 * default could not tell "I want the pane" apart from "I have never said". The load-bearing case
 * is the stored `false` on a phone: the user asked for the config pane with the `»` reveal button,
 * and a per-device default that overruled that would make the button look broken.
 *
 * The second half of this file guards WHOSE answer `stored` is. One key for every viewport made
 * the per-device default unreachable — opening the pane on a desktop stored `false`, and a stored
 * value beats the default in both directions, so the same browser at phone width opened the pane
 * over the whole screen and hid the playground (#6378). The preference is per breakpoint now, and
 * these tests pin that neither viewport can answer for the other.
 */
import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    configPanelCollapsedAtom,
    configPanelCollapsedPhonePreferenceAtom,
    configPanelCollapsedPreferenceAtom,
    configPanelCollapsedViewportPreferenceAtom,
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

        // The `»` reveal button: one tap turns the per-device default into a real preference —
        // stored for the viewport it was made on, which here is the phone.
        store.set(configPanelCollapsedAtom, false)
        expect(store.get(configPanelCollapsedPhonePreferenceAtom)).toBe(false)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    it("follows the viewport while no preference is stored for it", () => {
        const store = createStore()
        expect(store.get(configPanelCollapsedAtom)).toBe(false)

        // Rotating a phone, or resizing a desktop window down, moves the default with it.
        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)
    })

    // #6378. This is the regression: one key for both viewports meant opening the pane on a
    // desktop stored `false`, and a stored value beats the default in both directions — so the
    // same browser at phone width opened the pane over the whole screen and hid the playground.
    it("does not let a desktop preference decide the phone's answer", () => {
        const store = createStore()
        store.set(phoneViewportAtom, false)
        store.set(configPanelCollapsedAtom, false) // "show me the config" — said on a desktop

        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)
    })

    it("does not let a phone preference decide the desktop's answer", () => {
        const store = createStore()
        store.set(phoneViewportAtom, true)
        store.set(configPanelCollapsedAtom, true) // "keep it out of the way" — said on a phone

        store.set(phoneViewportAtom, false)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    it("keeps each viewport's own preference across a trip through the other", () => {
        const store = createStore()
        store.set(phoneViewportAtom, false)
        store.set(configPanelCollapsedAtom, true) // desktop: collapsed on purpose

        store.set(phoneViewportAtom, true)
        store.set(configPanelCollapsedAtom, false) // phone: opened on purpose

        store.set(phoneViewportAtom, false)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)
        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(false)
    })

    // The wide preference keeps the original key, so a value stored before the split still
    // applies where it was almost certainly set.
    it("reads a pre-split stored value as the desktop preference", () => {
        const store = createStore()
        store.set(configPanelCollapsedPreferenceAtom, true)
        expect(store.get(configPanelCollapsedAtom)).toBe(true)
    })
})

describe("configPanelCollapsedViewportPreferenceAtom", () => {
    it("hands a host the preference for the viewport it is on, not the other one", () => {
        const store = createStore()
        store.set(configPanelCollapsedPreferenceAtom, false)
        store.set(configPanelCollapsedPhonePreferenceAtom, true)

        expect(store.get(configPanelCollapsedViewportPreferenceAtom)).toBe(false)
        store.set(phoneViewportAtom, true)
        expect(store.get(configPanelCollapsedViewportPreferenceAtom)).toBe(true)
    })

    it("is null where that viewport has no stored answer, so the default still decides", () => {
        const store = createStore()
        store.set(configPanelCollapsedPreferenceAtom, false)
        store.set(phoneViewportAtom, true)

        expect(store.get(configPanelCollapsedViewportPreferenceAtom)).toBeNull()
        expect(
            resolveConfigPanelCollapsed(
                store.get(configPanelCollapsedViewportPreferenceAtom),
                true,
            ),
        ).toBe(true)
    })
})
