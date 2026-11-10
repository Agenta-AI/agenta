import {describe, expect, it} from "vitest"

import {toSkillListItem} from "../../src/registrySections"
import {skillTitle} from "../../src/skillTitle"

describe("skillTitle", () => {
    it("titles the SKILL.md name, not the suffixed workflow slug", () => {
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

    it("falls back to the workflow name when the skill has no SKILL.md name", () => {
        expect(skillTitle({slug: "", name: "Release notes"})).toBe("Release notes")
    })

    it("drops the reserved prefix of a built-in storage slug", () => {
        expect(skillTitle({slug: "__ag__web-search", name: ""})).toBe("Web Search")
    })
})
