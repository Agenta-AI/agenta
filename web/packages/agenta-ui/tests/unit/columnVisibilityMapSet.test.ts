import {createStore} from "jotai"
import {describe, expect, it} from "vitest"

import {
    getColumnViewportVisibilityAtom,
    setColumnViewportVisibilityAtom,
} from "../../src/InfiniteVirtualTable/atoms/columnVisibility"

/**
 * The viewport visibility state is a `Map` of `Map`s, and immer only drafts those once
 * `enableMapSet()` has run on the SAME immer instance. Only web/oss called it, and jotai-immer
 * had resolved a second copy of immer, so the first visibility write threw "The plugin for
 * 'MapSet' has not been loaded" and took `/evaluations` down on reload.
 *
 * Writing through the atom is the whole test: without the `enableMapSet()` in the atom module
 * this throws rather than failing an assertion.
 */
describe("column viewport visibility state", () => {
    it("drafts its Map-of-Maps state without the MapSet plugin error", () => {
        const store = createStore()

        expect(() =>
            store.set(setColumnViewportVisibilityAtom, {
                scopeId: "evaluations",
                columnKey: "status",
                visible: true,
            }),
        ).not.toThrow()

        expect(store.get(getColumnViewportVisibilityAtom("evaluations", "status"))).toBe(true)
    })

    it("keeps drafting across scopes, which is where the nested Map is created", () => {
        const store = createStore()

        store.set(setColumnViewportVisibilityAtom, [
            {scopeId: "a", columnKey: "one", visible: true},
            {scopeId: "b", columnKey: "two", visible: true},
        ])

        expect(store.get(getColumnViewportVisibilityAtom("a", "one"))).toBe(true)
        expect(store.get(getColumnViewportVisibilityAtom("b", "two"))).toBe(true)
    })
})
