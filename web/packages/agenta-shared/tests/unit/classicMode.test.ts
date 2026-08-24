import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

// This package's suite runs on `node`, and these atoms are localStorage-backed. jotai reads
// `window.localStorage` lazily per access, so a minimal stand-in is enough — and deliberately
// has no `addEventListener`, which is what keeps jotai from attaching a storage subscription.
const entries: Record<string, string> = {}
const localStorage = {
    getItem: (key: string) => entries[key] ?? null,
    setItem: (key: string, value: string) => {
        entries[key] = value
    },
    removeItem: (key: string) => {
        delete entries[key]
    },
    clear: () => {
        for (const key of Object.keys(entries)) delete entries[key]
    },
}
// Both spellings: jotai reaches through `window`, `stringStorage` uses the bare global.
Object.assign(globalThis, {localStorage, window: {localStorage}})

import {
    advancedNavHiddenAtom,
    classicModeEnabledAtom,
    navSimplifiedDefaultAtom,
    navSimplifiedOverrideAtom,
} from "../../src/state/classicMode"
import {activeUserIdAtom} from "../../src/state/featureFlags"

/**
 * A fresh user per test. The atoms are `getOnInit`, so each one reads storage exactly once — at
 * the moment its family memoizes it. Reusing an id would hand the next test a cached atom
 * holding the previous test's answer.
 */
let seq = 0
const signIn = (stored: Record<string, string> = {}) => {
    const userId = `user-${++seq}`
    const keys = {
        base: `agenta:onboarding:${userId}:nav-simplified`,
        override: `agenta:onboarding:${userId}:nav-simplified-override`,
    }
    if (stored.base !== undefined) localStorage.setItem(keys.base, stored.base)
    if (stored.override !== undefined) localStorage.setItem(keys.override, stored.override)

    const store = createStore()
    store.set(activeUserIdAtom, userId)
    return {store, keys}
}

beforeEach(() => {
    localStorage.clear()
})

describe("classic mode preference", () => {
    it("reads the keys the preference has always been stored under", () => {
        // These predate the move into this package and hold every existing user's choice —
        // a changed prefix silently resets everyone to their signup-era default.
        const {store} = signIn({base: "true", override: "false"})
        expect(store.get(navSimplifiedDefaultAtom)).toBe(true)
        expect(store.get(navSimplifiedOverrideAtom)).toBe(false)
    })

    it("writes back to those same keys", () => {
        const {store, keys} = signIn()
        store.set(navSimplifiedDefaultAtom, true)
        expect(localStorage.getItem(keys.base)).toBe("true")

        store.set(classicModeEnabledAtom, true)
        expect(localStorage.getItem(keys.override)).toBe("false")
    })

    it("lets an explicit choice beat the signup-era default", () => {
        const {store} = signIn({base: "true", override: "false"})
        expect(store.get(advancedNavHiddenAtom)).toBe(false)
        expect(store.get(classicModeEnabledAtom)).toBe(true)
    })

    it("falls back to the default when there is no explicit choice", () => {
        // Every signup since 2026-07-28 writes this key — those users get /m.
        const {store} = signIn({base: "true"})
        expect(store.get(advancedNavHiddenAtom)).toBe(true)
        expect(store.get(classicModeEnabledAtom)).toBe(false)
    })

    it("existing users, who have neither key, keep classic mode on", () => {
        const {store} = signIn()
        expect(store.get(classicModeEnabledAtom)).toBe(true)
    })

    it("reads a default and writes nothing while no user is known", () => {
        // A preference written under nobody would be inherited by the next person on this
        // browser — including which app they land in.
        const store = createStore()
        expect(store.get(classicModeEnabledAtom)).toBe(true)
        store.set(classicModeEnabledAtom, false)
        expect(Object.keys(entries)).toHaveLength(0)
    })
})
