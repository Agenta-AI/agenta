// @vitest-environment jsdom
/** The phone rows of the Agent tab (M07) name what a section holds, not only how many. */
import {describe, expect, it, vi} from "vitest"

import {instructionsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/InstructionsSection"
import {skillsSection} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/SkillsSection"
import type {AgentTemplateT} from "../../src/DrillInView/SchemaControls/agentTemplate/sections/types"

const t = ((key: string) => key) as unknown as AgentTemplateT
const shared = {
    t,
    fieldTitle: (_field: string, fallback: string) => fallback,
    sectionIndicator: () => undefined,
}

const instructions = (agentsMd: string | null) =>
    instructionsSection({
        ...shared,
        hasInstructions: true,
        draftSectionKeys: new Set(),
        agentsMd,
        openInstruction: vi.fn(),
    })

const skills = (list: unknown[]) =>
    skillsSection({
        ...shared,
        hasSkills: true,
        skills: list,
        handleAddSkill: vi.fn(),
        openSkillItem: vi.fn(),
        removeItem: vi.fn(),
        closeEditor: vi.fn(),
        skillStatusFor: () => undefined,
    })

describe("phone summaries of the Agent tab sections", () => {
    it("names the instructions file and counts its words", () => {
        const section = instructions("Triage the ticket.")
        expect(section && section.phoneSummary).toBe("AGENTS.md · 3 words")
    })

    it("says the instructions file is empty", () => {
        const section = instructions("")
        expect(section && section.phoneSummary).toBe("AGENTS.md · empty")
    })

    it("lists the skills by their own names, and keeps the count for the desktop", () => {
        const section = skills([
            {name: "ticket-triage", description: "Label a ticket"},
            {name: "plain-writing", description: "Write plainly"},
        ])
        expect(section && section.phoneSummary).toBe("ticket-triage, plain-writing")
        expect(section && section.summary).toBe("2 skills")
    })

    it("says None when there are no skills", () => {
        const section = skills([])
        expect(section && section.phoneSummary).toBe("None")
    })
})
