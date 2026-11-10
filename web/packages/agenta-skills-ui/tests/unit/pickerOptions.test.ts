import {describe, expect, it} from "vitest"

import {filterSkillOptions, pickerEmbedEntry, toPickerItem} from "../../src/pickerOptions"

const SUFFIXED = {
    workflow_id: "wf-1",
    workflow_slug: "laptop-replacement-policy-3f2a",
    name: "laptop-replacement-policy-3f2a",
    skill_name: "laptop-replacement-policy",
    description: "When and how an employee gets a new laptop.",
}

describe("toPickerItem", () => {
    it("keys by the workflow slug and names by the SKILL.md name", () => {
        const item = toPickerItem(SUFFIXED, "project", new Map())
        expect(item?.slug).toBe("laptop-replacement-policy-3f2a")
        expect(item?.name).toBe("laptop-replacement-policy")
    })
})

describe("pickerEmbedEntry", () => {
    it("stores the SKILL.md name as the sibling name, so the command token has no suffix", () => {
        const item = toPickerItem(SUFFIXED, "project", new Map())!
        const entry = pickerEmbedEntry(item, "latest")
        expect(entry.name).toBe("laptop-replacement-policy")
        const embed = entry["@ag.embed"] as {"@ag.references": Record<string, {slug?: string}>}
        expect(embed["@ag.references"].workflow.slug).toBe("laptop-replacement-policy-3f2a")
    })
})

describe("filterSkillOptions", () => {
    const options = [toPickerItem(SUFFIXED, "project", new Map())!]

    it("matches the displayed title", () => {
        expect(filterSkillOptions(options, "Replacement Policy")).toHaveLength(1)
    })

    it("keeps every row for an empty search and drops a row that matches nothing", () => {
        expect(filterSkillOptions(options, "  ")).toHaveLength(1)
        expect(filterSkillOptions(options, "expense report")).toHaveLength(0)
    })
})
