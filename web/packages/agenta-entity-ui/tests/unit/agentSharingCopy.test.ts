import {describe, expect, it} from "vitest"

import * as copy from "../../src/sharing/copy"

const strings = (value: unknown): string[] => {
    if (typeof value === "string") return [value]
    if (typeof value === "function") {
        const sample = ["Alice Martin", "Bob Lee"]
        return strings((value as (...args: unknown[]) => unknown)(...Array(value.length).fill(sample)))
    }
    if (value && typeof value === "object") return Object.values(value).flatMap(strings)
    return []
}

describe("entity-ui sharing copy", () => {
    it("never names the API roles", () => {
        const all = strings(copy)
        expect(all.length).toBeGreaterThan(50)
        for (const text of all) expect(text).not.toMatch(/viewer|participant/i)
    })
})
