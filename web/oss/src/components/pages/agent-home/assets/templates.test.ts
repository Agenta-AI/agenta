import {describe, expect, it} from "vitest"

import {AGENT_TEMPLATES, PROVIDERS, TEMPLATE_CATEGORY_ORDER} from "./templates"

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
