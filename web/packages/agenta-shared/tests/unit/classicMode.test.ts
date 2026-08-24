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
import {userAtom} from "../../src/state/user"

/**
 * A fresh user per test, with the atoms SUBSCRIBED.
 *
 * `atomWithStorage` reads storage in `onMount`, not on first get, so an unsubscribed
 * `store.get` reports the default — the same one-tick window the app sees before React
 * subscribes. Mounting here is what makes these assertions about stored values rather than
 * about that window. A fresh id per test keeps the module-level atom families from handing the
 * next test a cached atom.
 */
let seq = 0
const signIn = (stored: Record<string, string> = {}, createdAt?: string) => {
    const userId = `user-${++seq}`
    const keys = {
        base: `agenta:onboarding:${userId}:nav-simplified`,
        override: `agenta:onboarding:${userId}:nav-simplified-override`,
    }
    if (stored.base !== undefined) localStorage.setItem(keys.base, stored.base)
    if (stored.override !== undefined) localStorage.setItem(keys.override, stored.override)

    const store = createStore()
    store.set(activeUserIdAtom, userId)
    store.set(userAtom, {
        id: userId,
        uid: userId,
        username: "u",
        email: "u@example.com",
        ...(createdAt ? {created_at: createdAt} : {}),
    })
    for (const a of [
        navSimplifiedDefaultAtom,
        navSimplifiedOverrideAtom,
        advancedNavHiddenAtom,
        classicModeEnabledAtom,
    ]) {
        store.sub(a, () => undefined)
    }
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
})

describe("simplified cohort, derived from the account", () => {
    // The stored flag only exists on the browser the user signed up in. The account's creation
    // date is the same everywhere, so a second device stops disagreeing with the first.
    it("treats an account created after the cutoff as simplified, with nothing in storage", () => {
        const {store} = signIn({}, "2026-08-14 09:12:33.123456+00:00")
        expect(store.get(classicModeEnabledAtom)).toBe(false)
    })

    it("leaves an account created before the cutoff on classic mode", () => {
        const {store} = signIn({}, "2026-06-01 09:12:33.123456+00:00")
        expect(store.get(classicModeEnabledAtom)).toBe(true)
    })

    it("parses the backend's space-separated datetime", () => {
        // `str(datetime)` in Python, not an ISO `T`. Safari refuses the space; the atom
        // normalizes it. A regression here reads as NaN → classic mode → silently no redirect.
        const spaced = signIn({}, "2026-08-14 09:12:33.123456+00:00")
        const isoT = signIn({}, "2026-08-14T09:12:33.123456+00:00")
        expect(spaced.store.get(classicModeEnabledAtom)).toBe(false)
        expect(isoT.store.get(classicModeEnabledAtom)).toBe(false)
    })

    it("falls back to classic mode when the date is missing or unparseable", () => {
        expect(signIn({}).store.get(classicModeEnabledAtom)).toBe(true)
        expect(signIn({}, "not a date").store.get(classicModeEnabledAtom)).toBe(true)
    })

    it("still lets an explicit choice win over the derived default", () => {
        const {store} = signIn({override: "false"}, "2026-08-14 09:12:33.123456+00:00")
        expect(store.get(classicModeEnabledAtom)).toBe(true)
    })

    it("keeps the stored signup flag authoritative for a pre-cutoff account", () => {
        // Belt and braces: whatever the date says, the browser that witnessed the signup
        // answers exactly as it always has.
        const {store} = signIn({base: "true"}, "2026-06-01 09:12:33.123456+00:00")
        expect(store.get(classicModeEnabledAtom)).toBe(false)
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
