import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    clearGrants,
    getGrant,
    GRANTS_STORAGE_KEY,
    reloadGrants,
    setGrant,
} from "../../src/drive/htmlApp/grants"

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
        expect(getGrant("m1", "apps/board")).toBe("read-write")
        expect(getGrant("m2", "apps/board")).toBeNull()
        expect(getGrant("m1", "apps/other")).toBeNull()
        setGrant("m1", "apps/board", "read")
        expect(getGrant("m1", "apps/board")).toBe("read")
    })

    it("mirrors into sessionStorage under the agreed key with `${mountId}|${dir}` keys", () => {
        setGrant("m1", "apps/board", "read-write")
        setGrant("m2", "x", "read")
        expect(JSON.parse(storage.data.get(GRANTS_STORAGE_KEY) as string)).toEqual({
            "m1|apps/board": "read-write",
            "m2|x": "read",
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
            JSON.stringify({"m1|apps/board": "read-write", "m9|bad": "admin", "m8|n": 3}),
        )
        reloadGrants()
        expect(getGrant("m1", "apps/board")).toBe("read-write")
        expect(getGrant("m9", "bad")).toBeNull()
        expect(getGrant("m8", "n")).toBeNull()
    })

    it("survives a corrupt mirror", () => {
        storage.data.set(GRANTS_STORAGE_KEY, "{not json")
        reloadGrants()
        expect(getGrant("m1", "apps/board")).toBeNull()
        setGrant("m1", "apps/board", "read")
        expect(getGrant("m1", "apps/board")).toBe("read")
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
        expect(getGrant("m1", "apps/board")).toBe("read-write")
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
        expect(getGrant("m1", "d")).toBe("read")
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
        expect(getGrant("m1", "d")).toBe("read-write")
    })
})
