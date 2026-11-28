import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

// Same minimal localStorage stand-in as classicMode.test.ts: this suite runs on `node`.
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
Object.assign(globalThis, {localStorage, window: {localStorage}})

import {
    betaDeveloperModeActiveAtom,
    classicAppFlagAtom,
    navSimplifiedOverrideAtom,
} from "../../src/state/classicMode"
import {ACTIVE_USER_ID_KEY, activeUserIdAtom} from "../../src/state/featureFlags"

let seq = 0

/** A signed-in user with the given stored switches, atoms subscribed so storage is read. */
const signIn = (stored: {developerMode?: boolean; classicApp?: string; beta?: string}) => {
    const userId = `user-${++seq}`
    localStorage.setItem(ACTIVE_USER_ID_KEY, userId)
    if (stored.classicApp !== undefined) {
        localStorage.setItem(`agenta:settings:${userId}:classic-app`, stored.classicApp)
    }
    if (stored.beta !== undefined) {
        localStorage.setItem(`agenta:settings:${userId}:beta-developer-mode`, stored.beta)
    }
    const store = createStore()
    store.set(activeUserIdAtom, userId)
    if (stored.developerMode !== undefined) {
        store.set(navSimplifiedOverrideAtom, !stored.developerMode)
    }
    for (const a of [classicAppFlagAtom, betaDeveloperModeActiveAtom]) {
        store.sub(a, () => undefined)
    }
    return {store, userId}
}

beforeEach(() => {
    localStorage.clear()
})

describe("Developer Mode opens in /m unless the classic app is chosen", () => {
    it("is on by default for Developer Mode", () => {
        const {store} = signIn({developerMode: true})
        expect(store.get(classicAppFlagAtom)).toBe(false)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(true)
    })

    it("ignores the old beta developer mode switch", () => {
        for (const beta of ["true", "false"]) {
            const {store} = signIn({developerMode: true, beta})
            expect(store.get(betaDeveloperModeActiveAtom)).toBe(true)
        }
    })

    it("is off when the user turned the classic app on", () => {
        const {store} = signIn({developerMode: true, classicApp: "true"})
        expect(store.get(classicAppFlagAtom)).toBe(true)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(false)
    })

    it("is off while Developer Mode is off", () => {
        const {store} = signIn({developerMode: false})
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(false)
    })

    it("follows the switch and writes it to the user's storage", () => {
        const {store, userId} = signIn({developerMode: true})
        store.set(classicAppFlagAtom, true)
        expect(localStorage.getItem(`agenta:settings:${userId}:classic-app`)).toBe("true")
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(false)
        store.set(classicAppFlagAtom, false)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(true)
    })

    it("reads off before the user is known", () => {
        const store = createStore()
        store.sub(betaDeveloperModeActiveAtom, () => undefined)
        expect(store.get(betaDeveloperModeActiveAtom)).toBe(false)
    })
})
