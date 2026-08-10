// @vitest-environment jsdom
import type {UIMessage} from "ai"
import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    dropSessionMessagesAtom,
    isSessionStreamingAtomFamily,
    persistSessionMessagesAtom,
    sessionMessagesAtom,
    sessionRecordCountsReadAtom,
    sessionStatusAtomFamily,
    setSessionStatusAtom,
} from "../../../src/state/sessionMessages"

const MESSAGES_KEY = "agenta:agent-chat:messages"
const COUNTS_KEY = "agenta:agent-chat:record-counts"

const msg = (id: string, text: string): UIMessage =>
    ({id, role: "user", parts: [{type: "text", text}]}) as UIMessage

const quotaError = () => new DOMException("quota", "QuotaExceededError")

/** Fail `localStorage.setItem` for the messages key while it holds more than `maxSessions`. */
const failMessagesWriteOverQuota = (maxSessions: number) => {
    const real = Storage.prototype.setItem
    return vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
        this: Storage,
        key: string,
        value: string,
    ) {
        if (key === MESSAGES_KEY && Object.keys(JSON.parse(value)).length > maxSessions) {
            throw quotaError()
        }
        real.call(this, key, value)
    })
}

describe("sessionMessages state", () => {
    beforeEach(() => {
        localStorage.clear()
    })
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("persists a session's messages under its id", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {id: "s1", messages: [msg("m1", "hello")]})
        expect(store.get(sessionMessagesAtom)["s1"]).toHaveLength(1)
        // A later settle replaces that session's slice without touching others.
        store.set(persistSessionMessagesAtom, {id: "s2", messages: [msg("m2", "other")]})
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "hello"), msg("m3", "again")],
        })
        expect(store.get(sessionMessagesAtom)["s1"]).toHaveLength(2)
        expect(store.get(sessionMessagesAtom)["s2"]).toHaveLength(1)
    })

    // The OSS original deliberately strips jotai's cross-tab `storage` subscribe: an incoming
    // replacement unmounted a streaming conversation and orphaned its `useChat` stream mid-turn.
    // Both copies write the SAME key, so the package must not re-enable it.
    it("does not sync across browser tabs — a foreign storage event never replaces the store", () => {
        const store = createStore()
        const unsub = store.sub(sessionMessagesAtom, () => {})
        store.set(persistSessionMessagesAtom, {id: "s1", messages: [msg("m1", "mine")]})

        // Another browser tab writes the shared key, then the browser fires `storage` here.
        const foreign = JSON.stringify({s9: [msg("m9", "theirs")]})
        localStorage.setItem(MESSAGES_KEY, foreign)
        window.dispatchEvent(
            new StorageEvent("storage", {
                key: MESSAGES_KEY,
                newValue: foreign,
                storageArea: localStorage,
            }),
        )

        expect(store.get(sessionMessagesAtom)["s1"]).toHaveLength(1)
        expect(store.get(sessionMessagesAtom)["s9"]).toBeUndefined()
        unsub()
    })

    it("files the record watermark alongside the transcript it was built from", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "hello")],
            recordCount: 7,
        })
        expect(store.get(sessionRecordCountsReadAtom)["s1"]).toBe(7)
        expect(JSON.parse(localStorage.getItem(COUNTS_KEY) ?? "{}")["s1"]).toBe(7)
    })

    // A locally-streamed transcript has no known server record count; clearing the watermark makes
    // the next open re-sync from the durable log instead of trusting a stale number.
    it("clears the watermark when a settle persists without a record count", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "hello")],
            recordCount: 7,
        })
        store.set(persistSessionMessagesAtom, {id: "s1", messages: [msg("m1", "hello")]})
        expect(store.get(sessionRecordCountsReadAtom)["s1"]).toBeUndefined()
    })

    it("drops a forgotten session's transcript and watermark together", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "a")],
            recordCount: 3,
        })
        store.set(persistSessionMessagesAtom, {
            id: "s2",
            messages: [msg("m2", "b")],
            recordCount: 4,
        })
        store.set(dropSessionMessagesAtom, ["s1"])
        expect(store.get(sessionMessagesAtom)["s1"]).toBeUndefined()
        expect(store.get(sessionRecordCountsReadAtom)["s1"]).toBeUndefined()
        expect(store.get(sessionMessagesAtom)["s2"]).toHaveLength(1)
        expect(store.get(sessionRecordCountsReadAtom)["s2"]).toBe(4)
    })

    it("sheds an evicted session's watermark with its transcript when the store overflows", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {
            id: "old",
            messages: [msg("m1", "a")],
            recordCount: 3,
        })
        // Only one session fits from here on, so persisting `new` evicts `old`.
        failMessagesWriteOverQuota(1)
        store.set(persistSessionMessagesAtom, {
            id: "new",
            messages: [msg("m2", "b")],
            recordCount: 5,
        })
        expect(store.get(sessionMessagesAtom)["old"]).toBeUndefined()
        expect(store.get(sessionRecordCountsReadAtom)["old"]).toBeUndefined()
        expect(store.get(sessionMessagesAtom)["new"]).toHaveLength(1)
        expect(store.get(sessionRecordCountsReadAtom)["new"]).toBe(5)
    })

    // The persisted store still holds the OLD messages, so filing the NEW watermark against them
    // would make `shouldAdoptServerTranscript` reject the complete server log forever.
    it("drops the watermark when even the active session will not fit", () => {
        const store = createStore()
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m1", "a")],
            recordCount: 3,
        })
        failMessagesWriteOverQuota(0)
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        store.set(persistSessionMessagesAtom, {
            id: "s1",
            messages: [msg("m2", "b")],
            recordCount: 9,
        })
        expect(store.get(sessionRecordCountsReadAtom)["s1"]).toBeUndefined()
        expect(warn).toHaveBeenCalled()
    })

    it("run status defaults to idle, stores non-idle, and clears on idle", () => {
        const store = createStore()
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("idle")
        store.set(setSessionStatusAtom, {id: "sx", status: "running"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("running")
        expect(store.get(isSessionStreamingAtomFamily("sx"))).toBe(true)
        store.set(setSessionStatusAtom, {id: "sx", status: "awaiting"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("awaiting")
        expect(store.get(isSessionStreamingAtomFamily("sx"))).toBe(false)
        // Idle is stored as absence (clear-on-unmount semantics).
        store.set(setSessionStatusAtom, {id: "sx", status: "idle"})
        expect(store.get(sessionStatusAtomFamily("sx"))).toBe("idle")
    })
})
