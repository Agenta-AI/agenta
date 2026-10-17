import {describe, expect, it} from "vitest"

import {
    anonymousVisitorKey,
    createVisitorKey,
    isValidVisitorKey,
} from "../../src/features/embed/visitorKey"

const memoryStorage = (initial: Record<string, string> = {}) => {
    const values = new Map(Object.entries(initial))
    return {
        getItem: (name: string) => values.get(name) ?? null,
        setItem: (name: string, value: string) => void values.set(name, value),
        values,
    } as unknown as Storage & {values: Map<string, string>}
}

describe("isValidVisitorKey", () => {
    it("takes the server's rule: 32 to 256 base64url characters, 12 distinct", () => {
        expect(isValidVisitorKey(createVisitorKey())).toBe(true)
        expect(isValidVisitorKey("a".repeat(31))).toBe(false)
        expect(isValidVisitorKey("user-00000000000000000000000000042")).toBe(false)
        expect(isValidVisitorKey(`${createVisitorKey()}!`)).toBe(false)
        expect(isValidVisitorKey("Ab1-_".repeat(52))).toBe(false)
        expect(isValidVisitorKey(42)).toBe(false)
    })
})

describe("createVisitorKey", () => {
    it("is 256 random bits as 43 base64url characters, different each time", () => {
        const key = createVisitorKey()
        expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/)
        expect(createVisitorKey()).not.toBe(key)
    })
})

describe("anonymousVisitorKey", () => {
    it("creates a key once per embed and reuses it", () => {
        const storage = memoryStorage()
        const first = anonymousVisitorKey("embed-1", storage)
        expect(storage.values.get("agenta-embed:embed-1")).toBe(first)
        expect(anonymousVisitorKey("embed-1", storage)).toBe(first)
        expect(anonymousVisitorKey("embed-2", storage)).not.toBe(first)
    })

    it("replaces a stored value that breaks the rule", () => {
        const storage = memoryStorage({"agenta-embed:embed-1": "weak"})
        const key = anonymousVisitorKey("embed-1", storage)
        expect(isValidVisitorKey(key)).toBe(true)
        expect(storage.values.get("agenta-embed:embed-1")).toBe(key)
    })

    it("still gives a key when storage is missing or throws", () => {
        const throwing = {
            getItem: () => {
                throw new Error("blocked")
            },
            setItem: () => {
                throw new Error("blocked")
            },
        } as unknown as Storage
        expect(isValidVisitorKey(anonymousVisitorKey("embed-1", throwing))).toBe(true)
        expect(isValidVisitorKey(anonymousVisitorKey("embed-1", null))).toBe(true)
    })
})
