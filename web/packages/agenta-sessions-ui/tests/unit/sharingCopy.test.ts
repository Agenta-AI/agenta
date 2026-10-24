import {describe, expect, it} from "vitest"

import * as copy from "../../src/sharing/copy"

/** Every string a copy value can produce; functions are called with sample arguments. */
const strings = (value: unknown): string[] => {
    if (typeof value === "string") return [value]
    if (typeof value === "function") {
        const sample = ["Alice Martin", "Bob Lee"]
        return strings((value as (...args: unknown[]) => unknown)(...Array(value.length).fill(sample)))
    }
    if (value && typeof value === "object") return Object.values(value).flatMap(strings)
    return []
}

describe("sessions-ui sharing copy", () => {
    it("never names the API roles", () => {
        const all = strings(copy)
        expect(all.length).toBeGreaterThan(50)
        for (const text of all) expect(text).not.toMatch(/viewer|participant/i)
    })

    it("joins names without a serial comma", () => {
        expect(copy.joinNames(["Gmail"])).toBe("Gmail")
        expect(copy.joinNames(["Gmail", "Shopify"])).toBe("Gmail and Shopify")
        expect(copy.joinNames(["A", "B", "C"])).toBe("A, B and C")
    })
})
