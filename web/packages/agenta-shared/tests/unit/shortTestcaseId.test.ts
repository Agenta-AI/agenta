import {describe, expect, it} from "vitest"

import {shortTestcaseId} from "../../src/utils"

describe("shortTestcaseId", () => {
    it("gives the first 6 hex characters of a server id", () => {
        expect(shortTestcaseId("da65bedc-7feb-599b-9dd8-bf4431456976")).toBe("da65be")
        expect(shortTestcaseId("0a-1b2c3d-4e")).toBe("0a1b2c")
    })

    it("gives the last part of a local id", () => {
        expect(shortTestcaseId("new-1732700000000-a2b9x")).toBe("a2b9x")
    })
})
