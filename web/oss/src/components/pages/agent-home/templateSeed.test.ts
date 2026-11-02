import {describe, expect, it} from "vitest"

import {templateSeedYields} from "./templateSeed"

describe("templateSeedYields", () => {
    it("keeps text the user typed while the catalog loaded", () => {
        expect(templateSeedYields({late: true, hasDraft: false, composerText: "my agent"})).toBe(
            true,
        )
    })

    it("keeps a draft the user opened while the catalog loaded", () => {
        expect(templateSeedYields({late: true, hasDraft: true, composerText: ""})).toBe(true)
    })

    it("seeds a late template into an untouched composer", () => {
        expect(templateSeedYields({late: true, hasDraft: false, composerText: "  "})).toBe(false)
    })

    it("lets an explicit pick of another template replace the previous setup", () => {
        expect(
            templateSeedYields({late: false, hasDraft: true, composerText: "template A prompt"}),
        ).toBe(false)
    })
})
