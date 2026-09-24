import {createStore} from "jotai"
import {beforeEach, describe, expect, it} from "vitest"

import {
    activeUserIdAtom,
    channelDebugEnabledAtom,
    channelsEnabledAtom,
} from "../../src/state/featureFlags"

const entries = new Map<string, string>()
const localStorage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
}
Object.assign(globalThis, {localStorage, window: {localStorage}})
let seq = 0

beforeEach(() => entries.clear())

describe("Channels preference", () => {
    it("hides Channels by default, without enabling debug", () => {
        const store = createStore()
        expect(store.get(channelsEnabledAtom)).toBe(false)
        expect(store.get(channelDebugEnabledAtom)).toBe(false)
        const userId = `channels-default-${++seq}`
        store.set(activeUserIdAtom, userId)
        const unsub = store.sub(channelsEnabledAtom, () => undefined)
        expect(store.get(channelsEnabledAtom)).toBe(false)
        expect(store.get(channelDebugEnabledAtom)).toBe(false)
        // Reading the default stores nothing, so a later default change reaches this user.
        expect(entries.has(`agenta:settings:${userId}:channels`)).toBe(false)
        unsub()
    })

    it("does not persist a choice before the user is known", () => {
        const store = createStore()
        store.set(channelsEnabledAtom, true)
        expect(entries.size).toBe(0)
        expect(store.get(channelsEnabledAtom)).toBe(false)
    })

    it("persists the opt-in across hosts and keeps it separate from debug", () => {
        const userId = `channels-persist-${++seq}`
        const desktop = createStore()
        desktop.set(activeUserIdAtom, userId)
        const unsub = desktop.sub(channelsEnabledAtom, () => undefined)
        desktop.set(channelsEnabledAtom, true)
        desktop.set(channelDebugEnabledAtom, true)
        expect(entries.get(`agenta:settings:${userId}:channels`)).toBe("true")
        const mobile = createStore()
        mobile.set(activeUserIdAtom, userId)
        const unsubMobile = mobile.sub(channelsEnabledAtom, () => undefined)
        expect(mobile.get(channelsEnabledAtom)).toBe(true)
        expect(desktop.get(channelDebugEnabledAtom)).toBe(true)
        unsub()
        unsubMobile()
    })

    it("does not transfer an opt-in to another signed-in user", () => {
        const store = createStore()
        store.set(activeUserIdAtom, `channels-first-${++seq}`)
        store.set(channelsEnabledAtom, true)
        store.set(activeUserIdAtom, `channels-second-${++seq}`)
        expect(store.get(channelsEnabledAtom)).toBe(false)
    })
})
