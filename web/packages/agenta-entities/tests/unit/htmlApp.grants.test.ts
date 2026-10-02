import {ACTIVE_USER_ID_KEY} from "@agenta/shared/state"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    clearGrants,
    getGrant,
    grantsStorageKey,
    setGrant,
    subscribeGrants,
} from "../../src/drive/htmlApp/grants"

/** A minimal in-memory `Storage`, standing in for localStorage. */
const fakeStorage = () => {
    const data = new Map<string, string>()
    return {
        getItem: vi.fn((key: string) => data.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
            data.set(key, value)
        }),
        removeItem: vi.fn((key: string) => {
            data.delete(key)
        }),
        clear: vi.fn(() => data.clear()),
        key: vi.fn(() => null),
        get length() {
            return data.size
        },
        data,
    }
}

let storage: ReturnType<typeof fakeStorage>
const signIn = (userId: string) => storage.data.set(ACTIVE_USER_ID_KEY, userId)

beforeEach(() => {
    storage = fakeStorage()
    vi.stubGlobal("localStorage", storage)
    signIn("u1")
    clearGrants()
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe("grant store", () => {
    it("returns null for an unknown app", () => {
        expect(getGrant("m1", "apps/board")).toBeNull()
    })

    it("set/get round-trips and is keyed by mount AND dir", () => {
        setGrant("m1", "apps/board", {level: "read-write", writeRefused: false})
        expect(getGrant("m1", "apps/board")).toEqual({level: "read-write", writeRefused: false})
        expect(getGrant("m2", "apps/board")).toBeNull()
        expect(getGrant("m1", "apps/other")).toBeNull()
    })

    it("keeps a refused write upgrade and an unanswered read", () => {
        setGrant("m1", "apps/board", {level: null, writeRefused: true})
        expect(getGrant("m1", "apps/board")).toEqual({level: null, writeRefused: true})
    })

    it("persists under the user's settings key, so a reload or another tab sees it", () => {
        setGrant("m1", "apps/board", {level: "read", writeRefused: true})
        expect(grantsStorageKey("u1")).toBe("agenta:settings:u1:app-grants")
        expect(JSON.parse(storage.data.get("agenta:settings:u1:app-grants") as string)).toEqual({
            "m1|apps/board": {level: "read", writeRefused: true},
        })
        // Another tab writes; the next read sees it.
        storage.data.set(
            "agenta:settings:u1:app-grants",
            JSON.stringify({"m1|apps/board": {level: "none", writeRefused: false}}),
        )
        expect(getGrant("m1", "apps/board")).toEqual({level: "none", writeRefused: false})
    })

    it("another user on the same browser does not inherit the grants", () => {
        setGrant("m1", "apps/board", {level: "read-write", writeRefused: false})
        signIn("u2")
        expect(getGrant("m1", "apps/board")).toBeNull()
        setGrant("m1", "apps/board", {level: "none", writeRefused: false})
        signIn("u1")
        expect(getGrant("m1", "apps/board")).toEqual({level: "read-write", writeRefused: false})
    })

    it("without a signed-in user, answers live in memory only", () => {
        storage.data.delete(ACTIVE_USER_ID_KEY)
        setGrant("m1", "apps/board", {level: "read", writeRefused: false})
        expect(getGrant("m1", "apps/board")).toEqual({level: "read", writeRefused: false})
        expect([...storage.data.keys()].some((k) => k.includes("app-grants"))).toBe(false)
    })

    it("ignores garbage entries and a corrupt map", () => {
        storage.data.set(
            grantsStorageKey("u1"),
            JSON.stringify({
                "m1|apps/board": {level: "read", writeRefused: false},
                "m9|bad": {level: "admin"},
                "m8|n": 3,
            }),
        )
        expect(getGrant("m1", "apps/board")).toEqual({level: "read", writeRefused: false})
        expect(getGrant("m9", "bad")).toBeNull()
        expect(getGrant("m8", "n")).toBeNull()

        storage.data.set(grantsStorageKey("u1"), "{not json")
        expect(() => getGrant("m1", "apps/board")).not.toThrow()
        setGrant("m1", "apps/x", {level: "read", writeRefused: false})
        expect(getGrant("m1", "apps/x")).toEqual({level: "read", writeRefused: false})
    })

    it("notifies subscribers on every stored answer", () => {
        const listener = vi.fn()
        const unsubscribe = subscribeGrants(listener)
        setGrant("m1", "apps/board", {level: "read", writeRefused: false})
        expect(listener).toHaveBeenCalledTimes(1)
        unsubscribe()
        setGrant("m1", "apps/board", {level: "none", writeRefused: false})
        expect(listener).toHaveBeenCalledTimes(1)
    })

    it("keeps working when storage throws on every access", () => {
        const throwing = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {
                throw new Error("quota")
            },
            removeItem: () => {
                throw new Error("blocked")
            },
        }
        vi.stubGlobal("localStorage", throwing)
        expect(() => setGrant("m1", "apps/board", {level: "read", writeRefused: false})).not.toThrow()
        expect(getGrant("m1", "apps/board")).toEqual({level: "read", writeRefused: false})
        expect(() => clearGrants()).not.toThrow()
        expect(getGrant("m1", "apps/board")).toBeNull()
    })
})
