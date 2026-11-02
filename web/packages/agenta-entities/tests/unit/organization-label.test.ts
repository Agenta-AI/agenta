import {describe, expect, it} from "vitest"

import {organizationLabel} from "../../src/organization/label"

describe("organizationLabel", () => {
    it("adds the word to a plain name", () => {
        expect(organizationLabel("Acme")).toBe("Acme organization")
    })

    it("does not repeat the word of a default organization name", () => {
        expect(organizationLabel("Ana's Organization")).toBe("Ana's Organization")
        expect(organizationLabel("Acme organization ")).toBe("Acme organization")
    })

    it("keeps a name that only contains the word", () => {
        expect(organizationLabel("Organizational Labs")).toBe("Organizational Labs organization")
    })
})
