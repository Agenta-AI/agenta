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
    readSettledAdvancedNavHidden,
    readSettledClassicModeCookie,
} from "../../src/state/classicMode"
import {ACTIVE_USER_ID_KEY, activeUserIdAtom} from "../../src/state/featureFlags"
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

    it("parses what the backend actually sends, in every shape", () => {
        // `str(datetime)` gives a SPACE separator that Safari refuses, and SIX fractional
        // digits where `Date.parse` is only required to accept three (more is
        // implementation-defined, so an engine may answer NaN). Both are normalized. A
        // regression reads as NaN, which means classic mode and silently no redirect.
        for (const createdAt of [
            "2026-08-14 09:12:33.123456+00:00",
            "2026-08-14T09:12:33.123456+00:00",
            "2026-08-14 09:12:33.123+00:00",
            "2026-08-14 09:12:33+00:00",
            "2026-08-14T09:12:33Z",
        ]) {
            expect(signIn({}, createdAt).store.get(classicModeEnabledAtom)).toBe(false)
        }
    })

    it("keeps the millisecond precision it truncates to", () => {
        // Truncating must not shift the instant across the cutoff.
        const justAfter = signIn({}, "2026-08-01 00:00:00.000999+00:00")
        const justBefore = signIn({}, "2026-07-31 23:59:59.999999+00:00")
        expect(justAfter.store.get(classicModeEnabledAtom)).toBe(false)
        expect(justBefore.store.get(classicModeEnabledAtom)).toBe(true)
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

/**
 * The resolver the two side-effecting hooks use, which must never guess.
 *
 * `advancedNavHiddenAtom` reports the signup default during the tick before its override atom
 * hydrates, because a not-yet-hydrated override and a genuine "no choice" are both `null`. The
 * redirect and the cookie write cannot take that back, so they read this instead.
 */
describe("readSettledAdvancedNavHidden", () => {
    const CUTOFF_AFTER = "2026-08-25 14:28:44.210343+00:00"
    const CUTOFF_BEFORE = "2026-07-01 09:00:00.000000+00:00"

    let seq = 0
    const setUp = (stored: Record<string, string> = {}) => {
        const userId = `settled-${++seq}`
        localStorage.setItem("agenta:onboarding:active-user-id", userId)
        if (stored.base !== undefined) {
            localStorage.setItem(`agenta:onboarding:${userId}:nav-simplified`, stored.base)
        }
        if (stored.override !== undefined) {
            localStorage.setItem(
                `agenta:onboarding:${userId}:nav-simplified-override`,
                stored.override,
            )
        }
        return userId
    }
    const profile = (createdAt?: string) => ({
        id: "u",
        uid: "u",
        username: "u",
        email: "u@example.com",
        ...(createdAt ? {created_at: createdAt} : {}),
    })

    beforeEach(() => {
        localStorage.clear()
    })

    it("honours an explicit Classic mode over the cohort default", () => {
        // The regression. This user chose Classic mode, and signed up inside the simplified
        // cohort. Falling through to the default here is what bounced them back to /m.
        setUp({override: "false"})
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_AFTER))).toBe(false)
    })

    it("disagrees with the atom during the window the atom cannot see", () => {
        // Proves the reason this resolver exists. Unsubscribed atoms reproduce the pre-hydration
        // tick: the override reads `null`, the cohort default wins, and the atom says "hide the
        // advanced nav" for a user who explicitly asked for it. The resolver says otherwise.
        const userId = setUp({override: "false"})
        const store = createStore()
        store.set(activeUserIdAtom, userId)
        store.set(userAtom, profile(CUTOFF_AFTER))

        expect(store.get(advancedNavHiddenAtom)).toBe(true)
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_AFTER))).toBe(false)
    })

    it("honours an explicit simplified choice", () => {
        setUp({override: "true"})
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_BEFORE))).toBe(true)
    })

    it("answers from the stored signup flag without waiting for the profile", () => {
        setUp({base: "true"})
        expect(readSettledAdvancedNavHidden(null)).toBe(true)
    })

    it("withholds an answer while only the profile could give one", () => {
        setUp()
        expect(readSettledAdvancedNavHidden(null)).toBeNull()
    })

    it("falls back to the cohort once the profile lands", () => {
        setUp()
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_AFTER))).toBe(true)
        setUp()
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_BEFORE))).toBe(false)
    })

    it("withholds an answer when no user is known", () => {
        localStorage.clear()
        expect(readSettledAdvancedNavHidden(profile(CUTOFF_AFTER))).toBeNull()
    })
})

describe("the gate cookie", () => {
    // A user, as the cookie reader sees one: it reads storage itself, so only the active-user
    // key and the scoped preference keys matter.
    const browser = (userId: string | null, stored: Record<string, string> = {}) => {
        if (userId === null) localStorage.removeItem(ACTIVE_USER_ID_KEY)
        else localStorage.setItem(ACTIVE_USER_ID_KEY, userId)
        for (const [key, value] of Object.entries(stored)) {
            localStorage.setItem(`agenta:onboarding:${userId}:${key}`, value)
        }
    }
    const profile = (createdAt?: string) => ({
        id: "u",
        uid: "u",
        username: "u",
        email: "u@example.com",
        ...(createdAt ? {created_at: createdAt} : {}),
    })
    const OLD = "2026-07-01 00:00:00.000000+00:00"
    const NEW = "2026-08-02 00:00:00.000000+00:00"

    it("publishes classic mode on only from an explicit choice", () => {
        browser("u", {"nav-simplified-override": "false"})
        expect(readSettledClassicModeCookie(profile(OLD))).toBe("1")
    })

    it("says nothing for an account that merely defaulted to classic mode", () => {
        // The regression this exists for: an account older than the switch has classic mode on
        // because nobody turned it off. Publishing "1" tells both gates the user asked for the
        // desktop app, which outranks the device check and takes /m away from every phone.
        browser("u")
        expect(readSettledClassicModeCookie(profile(OLD))).toBeNull()
    })

    it("publishes simplified from a choice, the signup seed, or the cohort", () => {
        browser("a", {"nav-simplified-override": "true"})
        expect(readSettledClassicModeCookie(profile(OLD))).toBe("0")

        localStorage.clear()
        browser("b", {"nav-simplified": "true"})
        expect(readSettledClassicModeCookie(profile(OLD))).toBe("0")

        localStorage.clear()
        browser("c")
        expect(readSettledClassicModeCookie(profile(NEW))).toBe("0")
    })

    it("lets an explicit choice outrank the cohort in both directions", () => {
        browser("a", {"nav-simplified-override": "false"})
        expect(readSettledClassicModeCookie(profile(NEW))).toBe("1")

        localStorage.clear()
        browser("b", {"nav-simplified-override": "true"})
        expect(readSettledClassicModeCookie(profile(OLD))).toBe("0")
    })

    it("leaves the cookie alone until the profile lands", () => {
        // Only the cohort branch needs the profile. Clearing while it is in flight would drop a
        // correct answer on every reload, and the gate would fall back to the device heuristic.
        browser("u")
        expect(readSettledClassicModeCookie(null)).toBeUndefined()
    })

    it("answers from storage before the profile, when storage is enough", () => {
        browser("u", {"nav-simplified-override": "true"})
        expect(readSettledClassicModeCookie(null)).toBe("0")
    })

    it("clears on sign-out, and only on sign-out", () => {
        // The active-user key is what a sign-out empties. `activeUserIdAtom` reading null on a
        // first render is NOT that, which is why this reads storage rather than the atom.
        browser(null)
        expect(readSettledClassicModeCookie(profile(OLD))).toBeNull()
    })
})
