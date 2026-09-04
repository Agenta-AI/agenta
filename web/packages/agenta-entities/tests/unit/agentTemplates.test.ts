import {describe, expect, it} from "vitest"

import {
    AGENT_TEMPLATES,
    templateConnections,
    templateProviderSlugs,
    PROVIDERS,
    TEMPLATE_CATEGORY_ORDER,
} from "../../src/workflow/agentTemplates"

describe("AGENT_TEMPLATES", () => {
    it("has exactly 28 entries", () => {
        expect(AGENT_TEMPLATES).toHaveLength(28)
    })

    it("has unique keys", () => {
        const keys = AGENT_TEMPLATES.map((template) => template.key)
        expect(new Set(keys).size).toBe(keys.length)
    })

    it("every category is in TEMPLATE_CATEGORY_ORDER", () => {
        for (const template of AGENT_TEMPLATES) {
            expect(TEMPLATE_CATEGORY_ORDER as readonly string[]).toContain(template.category)
        }
    })

    it("derives a migrated template's card marks from its connection slots", () => {
        // The point of the slots: a mark can only name a provider some slot accepts, so the card
        // and the connect step cannot disagree the way a hand-kept logo list allowed.
        for (const template of AGENT_TEMPLATES) {
            if (!template.connections) continue
            const fromSlots = new Set(
                templateConnections(template).flatMap((connection) =>
                    connection.options.map((option) => option.slug),
                ),
            )
            expect(new Set(templateProviderSlugs(template))).toEqual(fromSlots)
        }
    })

    it("reads an unmigrated template as one required single-option slot per integration", () => {
        const legacy = AGENT_TEMPLATES.find((template) => !template.connections)
        if (!legacy) return
        const slots = templateConnections(legacy)
        expect(slots).toHaveLength(legacy.requiredIntegrations.length)
        expect(slots.every((slot) => slot.required && slot.options.length === 1)).toBe(true)
    })

    it("offers GitLab as an alternative to GitHub on the PR reviewer", () => {
        // The playbook says "GitHub (or GitLab)"; before the slots, GitLab could only appear as a
        // decorative logo, so the setup step demanded GitHub of a GitLab user.
        const prReviewer = AGENT_TEMPLATES.find((template) => template.key === "pr-reviewer")
        const slot = templateConnections(prReviewer!)[0]
        expect(slot.required).toBe(true)
        expect(slot.options.map((option) => option.slug)).toEqual(["github", "gitlab"])
    })

    it("every logoSlugs and requiredIntegrations slug exists in PROVIDERS", () => {
        for (const template of AGENT_TEMPLATES) {
            for (const slug of template.logoSlugs ?? []) {
                expect(PROVIDERS[slug], `${template.key}: logo slug "${slug}"`).toBeDefined()
            }
            for (const integration of template.requiredIntegrations) {
                expect(
                    PROVIDERS[integration.slug],
                    `${template.key}: required integration slug "${integration.slug}"`,
                ).toBeDefined()
            }
        }
    })

    it("has a builderMessage that starts with 'Build a' or 'Build an' and is under 140 chars", () => {
        for (const template of AGENT_TEMPLATES) {
            expect(template.builderMessage, template.key).toBeTruthy()
            const message = template.builderMessage as string
            expect(
                message.startsWith("Build a ") || message.startsWith("Build an "),
                `${template.key}: "${message}"`,
            ).toBe(true)
            expect(
                message.length,
                `${template.key}: "${message}" (${message.length} chars)`,
            ).toBeLessThan(140)
        }
    })

    it("has seedMessage equal to builderMessage", () => {
        for (const template of AGENT_TEMPLATES) {
            expect(template.seedMessage, template.key).toBe(template.builderMessage)
        }
    })
})
