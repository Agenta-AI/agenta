import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    clearGrants,
    exceedsGrant,
    getGrant,
    GRANTS_STORAGE_KEY,
    reloadGrants,
    setGrant,
} from "../../src/drive/htmlApp/grants"

/** The level the user chose, ignoring what the app had asked for. */
const level = (mountId: string, dir: string) => getGrant(mountId, dir)?.level ?? null

/** A minimal in-memory `Storage` so the node test env has a sessionStorage to mirror into. */
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

beforeEach(() => {
    storage = fakeStorage()
    vi.stubGlobal("sessionStorage", storage)
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
        setGrant("m1", "apps/board", "read-write")
        expect(getGrant("m1", "apps/board")).toEqual({level: "read-write", asked: "read-write"})
        expect(getGrant("m2", "apps/board")).toBeNull()
        expect(getGrant("m1", "apps/other")).toBeNull()
        setGrant("m1", "apps/board", "read")
        expect(level("m1", "apps/board")).toBe("read")
    })

    it("records what the app asked for, not only what the user chose", () => {
        // The user was offered read-write and picked read: `asked` remembers the offer, which is
        // what stops the sheet re-opening every time they choose Run.
        setGrant("m1", "apps/board", "read", "read-write")
        expect(getGrant("m1", "apps/board")).toEqual({level: "read", asked: "read-write"})
    })

    it("defaults `asked` to the granted level so a later escalation still asks", () => {
        setGrant("m1", "apps/board", "read")
        expect(getGrant("m1", "apps/board")?.asked).toBe("read")
    })

    it("mirrors into sessionStorage under the agreed key with `${mountId}|${dir}` keys", () => {
        setGrant("m1", "apps/board", "read-write")
        setGrant("m2", "x", "read")
        expect(JSON.parse(storage.data.get(GRANTS_STORAGE_KEY) as string)).toEqual({
            "m1|apps/board": {level: "read-write", asked: "read-write"},
            "m2|x": {level: "read", asked: "read"},
        })
    })

    it("clearGrants empties memory and removes the mirror", () => {
        setGrant("m1", "apps/board", "read-write")
        clearGrants()
        expect(getGrant("m1", "apps/board")).toBeNull()
        expect(storage.data.has(GRANTS_STORAGE_KEY)).toBe(false)
    })

    it("hydrates from an existing mirror (a reload) and ignores garbage values", () => {
        storage.data.set(
            GRANTS_STORAGE_KEY,
            JSON.stringify({
                "m1|apps/board": {level: "read", asked: "read-write"},
                "m9|bad": {level: "admin", asked: "read"},
                "m8|n": 3,
            }),
        )
        reloadGrants()
        expect(getGrant("m1", "apps/board")).toEqual({level: "read", asked: "read-write"})
        expect(getGrant("m9", "bad")).toBeNull()
        expect(getGrant("m8", "n")).toBeNull()
    })

    it("survives a corrupt mirror", () => {
        storage.data.set(GRANTS_STORAGE_KEY, "{not json")
        reloadGrants()
        expect(getGrant("m1", "apps/board")).toBeNull()
        setGrant("m1", "apps/board", "read")
        expect(level("m1", "apps/board")).toBe("read")
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
        vi.stubGlobal("sessionStorage", throwing)
        reloadGrants()
        expect(() => setGrant("m1", "apps/board", "read-write")).not.toThrow()
        expect(level("m1", "apps/board")).toBe("read-write")
        expect(() => clearGrants()).not.toThrow()
        expect(getGrant("m1", "apps/board")).toBeNull()
    })

    it("keeps working when the sessionStorage getter itself throws", () => {
        Object.defineProperty(globalThis, "sessionStorage", {
            configurable: true,
            get() {
                throw new Error("SecurityError")
            },
        })
        reloadGrants()
        setGrant("m1", "d", "read")
        expect(level("m1", "d")).toBe("read")
        // Restore a plain value so unstubAllGlobals has something sane to reset.
        Object.defineProperty(globalThis, "sessionStorage", {
            configurable: true,
            writable: true,
            value: storage,
        })
    })

    it("works with no sessionStorage at all (SSR / node)", () => {
        vi.stubGlobal("sessionStorage", undefined)
        reloadGrants()
        setGrant("m1", "d", "read-write")
        expect(level("m1", "d")).toBe("read-write")
    })

    it("reads a pre-record mirror (a bare level) so an open tab keeps its grant", () => {
        storage.data.set(GRANTS_STORAGE_KEY, JSON.stringify({"m1|apps/board": "read-write"}))
        reloadGrants()
        // `asked` mirrors the level: the safe reading, since a real escalation still asks.
        expect(getGrant("m1", "apps/board")).toEqual({level: "read-write", asked: "read-write"})
    })
})

describe("exceedsGrant", () => {
    it("is true only when read-write is wanted over a read grant", () => {
        expect(exceedsGrant("read", "read-write")).toBe(true)
        expect(exceedsGrant("read", "read")).toBe(false)
        expect(exceedsGrant("read-write", "read")).toBe(false)
        expect(exceedsGrant("read-write", "read-write")).toBe(false)
    })
})
