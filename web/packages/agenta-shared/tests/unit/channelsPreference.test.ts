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
    it("shows Channels by default, without enabling debug", () => {
        const store = createStore()
        expect(store.get(channelsEnabledAtom)).toBe(true)
        expect(store.get(channelDebugEnabledAtom)).toBe(false)
        store.set(activeUserIdAtom, `channels-default-${++seq}`)
        expect(store.get(channelsEnabledAtom)).toBe(true)
        expect(store.get(channelDebugEnabledAtom)).toBe(false)
    })

    it("does not persist a choice before the user is known", () => {
        const store = createStore()
        store.set(channelsEnabledAtom, false)
        expect(entries.size).toBe(0)
        expect(store.get(channelsEnabledAtom)).toBe(true)
    })

    it("persists the opt-out across hosts and keeps it separate from debug", () => {
        const userId = `channels-persist-${++seq}`
        const desktop = createStore()
        desktop.set(activeUserIdAtom, userId)
        const unsub = desktop.sub(channelsEnabledAtom, () => undefined)
        desktop.set(channelsEnabledAtom, false)
        desktop.set(channelDebugEnabledAtom, true)
        expect(entries.get(`agenta:settings:${userId}:channels`)).toBe("false")
        const mobile = createStore()
        mobile.set(activeUserIdAtom, userId)
        const unsubMobile = mobile.sub(channelsEnabledAtom, () => undefined)
        expect(mobile.get(channelsEnabledAtom)).toBe(false)
        expect(desktop.get(channelDebugEnabledAtom)).toBe(true)
        unsub()
        unsubMobile()
    })

    it("does not transfer an opt-out to another signed-in user", () => {
        const store = createStore()
        store.set(activeUserIdAtom, `channels-first-${++seq}`)
        store.set(channelsEnabledAtom, false)
        store.set(activeUserIdAtom, `channels-second-${++seq}`)
        expect(store.get(channelsEnabledAtom)).toBe(true)
    })
})
