import {describe, expect, it} from "vitest"

import {toSkillListItem} from "../../src/registrySections"
import {skillTitle} from "../../src/skillTitle"

describe("skillTitle", () => {
    it("titles a registry item from its SKILL.md name, not the suffixed workflow name", () => {
        const item = toSkillListItem(
            {
                workflow_id: "wf-1",
                workflow_slug: "laptop-replacement-policy-3f2a",
                name: "laptop-replacement-policy-3f2a",
                skill_name: "laptop-replacement-policy",
            },
            "project",
        )
        expect(skillTitle(item)).toBe("Laptop Replacement Policy")
    })

    it("titles a picker item whose slug is the suffixed workflow slug", () => {
        // The shape `SkillPickerHost` builds: the slug is the embed identity, not a title.
        const item = {
            slug: "laptop-replacement-policy-3f2a",
            name: "laptop-replacement-policy-3f2a",
            skillName: "laptop-replacement-policy",
        }
        expect(skillTitle(item)).toBe("Laptop Replacement Policy")
    })

    it("falls back to the workflow name, never the slug", () => {
        expect(skillTitle({slug: "release-notes-ab12", name: "Release notes"})).toBe(
            "Release notes",
        )
    })

    it("drops the reserved prefix of a built-in known only by its storage slug", () => {
        expect(skillTitle({slug: "__ag__web-search", name: ""})).toBe("Web Search")
        expect(skillTitle({slug: "__ag__web-search", name: "__ag__web-search"})).toBe(
            "Web Search",
        )
    })
})
