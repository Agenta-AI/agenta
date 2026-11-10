import {describe, expect, it} from "vitest"

import {skillDisplayName} from "../../src/utils/skillDisplayName"

describe("skillDisplayName", () => {
    it.each([
        ["laptop-replacement-policy", "Laptop Replacement Policy"],
        ["pr-review", "PR Review"],
        ["shoot_demo_video", "Shoot Demo Video"],
        ["csv-to-json", "CSV To JSON"],
        ["llm-api-sdk-qa", "LLM API SDK QA"],
        ["hr-it-onboarding", "HR IT Onboarding"],
        ["summarize", "Summarize"],
        ["github-iOS-release", "Github iOS Release"],
        ["--double--dash--", "Double Dash"],
    ])("titles %s as %s", (name, expected) => {
        expect(skillDisplayName(name)).toBe(expected)
    })

    it("keeps a name with a space as written, since it is already prose", () => {
        expect(skillDisplayName("Release notes")).toBe("Release notes")
        expect(skillDisplayName("  Release notes  ")).toBe("Release notes")
    })

    it("returns an empty name as empty", () => {
        expect(skillDisplayName("")).toBe("")
        expect(skillDisplayName("   ")).toBe("")
    })

    it("returns a name made only of separators unchanged", () => {
        expect(skillDisplayName("--")).toBe("--")
    })
})
