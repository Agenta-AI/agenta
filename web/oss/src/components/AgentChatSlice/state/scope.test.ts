import {describe, expect, it} from "vitest"

import {drawerScopeKey, isDrawerScopeKey, ownsSessionShortcuts} from "./scope"

const APP_SCOPE = "6f1c6f0e-1f7a-4a2e-9f0a-2b1c3d4e5f60"

describe("isDrawerScopeKey", () => {
    it("separates drawer scopes from app and onboarding scopes", () => {
        expect(isDrawerScopeKey(drawerScopeKey(APP_SCOPE))).toBe(true)
        expect(isDrawerScopeKey(drawerScopeKey(null))).toBe(true)
        expect(isDrawerScopeKey(APP_SCOPE)).toBe(false)
        expect(isDrawerScopeKey("__global__")).toBe(false)
        expect(isDrawerScopeKey("onboarding")).toBe(false)
    })
})

describe("ownsSessionShortcuts", () => {
    // Exactly one panel may hold the document listener; both panels are mounted while the drawer
    // is open, so the two rows below must never both be true for the same drawer state.
    it("hands the keyboard to the drawer's panel while the drawer is open", () => {
        expect(ownsSessionShortcuts(drawerScopeKey(APP_SCOPE), true)).toBe(true)
        expect(ownsSessionShortcuts(APP_SCOPE, true)).toBe(false)
    })

    it("hands it back to the playground's panel when the drawer is closed", () => {
        expect(ownsSessionShortcuts(APP_SCOPE, false)).toBe(true)
        expect(ownsSessionShortcuts(drawerScopeKey(APP_SCOPE), false)).toBe(false)
    })

    it("never lets both panels own it at once", () => {
        for (const drawerOpen of [true, false]) {
            const owners = [APP_SCOPE, drawerScopeKey(APP_SCOPE)].filter((scope) =>
                ownsSessionShortcuts(scope, drawerOpen),
            )
            expect(owners).toHaveLength(1)
        }
    })
})
