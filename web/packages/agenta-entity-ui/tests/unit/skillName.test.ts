/**
 * The frontend skill-name/draft guard mirrors the SDK's pydantic rules
 * (`sdks/python/agenta/sdk/agents/skills/models.py`). A name the SDK rejects must be rejected
 * here too: it saves as plain JSON but blows up `parse_skill_templates` on the first run, so the
 * whole agent fails rather than just the skill.
 */
import {describe, expect, it} from "vitest"

import {
    isValidSkillName,
    skillDraftError,
    skillNameError,
    slugifySkillName,
} from "../../src/DrillInView/SchemaControls/skillName"

import {ITEM_KINDS} from "../../src/DrillInView/SchemaControls/agentTemplate/itemKinds"

describe("skillNameError", () => {
    it("accepts the lowercase-hyphen slugs the harness requires", () => {
        for (const name of ["my-skill", "release-notes", "a", "skill1", "a-b-c9"])
            expect(skillNameError(name)).toBeUndefined()
    })

    it("rejects capitalised names — the reported break", () => {
        expect(skillNameError("Weather")).toBe("Lowercase, digits and hyphens only.")
        expect(skillNameError("My Skill")).toBe("Lowercase, digits and hyphens only.")
        expect(isValidSkillName("Weather")).toBe(false)
    })

    it("keeps the message to one short line — the fix is offered as a separate action", () => {
        const error = skillNameError("My Skill") ?? ""
        expect(error.length).toBeLessThanOrEqual(40)
    })

    it("rejects the other shapes pydantic rejects", () => {
        for (const name of ["my_skill", "my skill", "-lead", "trail-", "double--hyphen", "a.b"])
            expect(skillNameError(name), name).toBeDefined()
        expect(skillNameError("a".repeat(65))).toBe("Max 64 characters.")
    })

    it("slugifies a human-written name for the one-click fix", () => {
        expect(slugifySkillName("My Skill")).toBe("my-skill")
        expect(slugifySkillName("Release Notes!")).toBe("release-notes")
        expect(slugifySkillName("Café Notes")).toBe("cafe-notes")
    })

    it("stays quiet on an untouched empty field but still reports it as invalid", () => {
        expect(skillNameError("", {touched: false})).toBeUndefined()
        expect(skillNameError("")).toBe("Required.")
        expect(isValidSkillName("")).toBe(false)
    })
})

describe("skillDraftError", () => {
    const draft = {name: "my-skill", description: "when to use it", body: "# do this"}

    it("passes a complete draft", () => {
        expect(skillDraftError(draft)).toBeUndefined()
    })

    it("reports the required fields the SDK enforces with min_length=1", () => {
        expect(skillDraftError({...draft, description: "  "})).toBe("Description is required.")
        expect(skillDraftError({...draft, body: ""})).toBe("SKILL.md content is required.")
    })

    it("reports the name first", () => {
        expect(skillDraftError({name: "Weather", description: "", body: ""})).toBe(
            "Lowercase, digits and hyphens only.",
        )
    })
})

describe("the skill item kind blocks Save on an invalid draft", () => {
    const {draftInvalid} = ITEM_KINDS.skill

    it("blocks a capitalised name", () => {
        expect(draftInvalid({name: "Weather", description: "d", body: "b"})).toBe(true)
        expect(draftInvalid({name: "weather", description: "d", body: "b"})).toBe(false)
    })

    it("still lets `@ag.embed` references through untouched", () => {
        expect(draftInvalid({"@ag.embed": {uri: "agenta://workflows/some-skill"}})).toBe(false)
    })
})
