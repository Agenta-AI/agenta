import {describe, expect, it} from "vitest"

import {
    skillContentSchema,
    skillsQueryResponseSchema,
    skillUsageResponseSchema,
} from "../../src/core/schema"

describe("skillContentSchema", () => {
    it("accepts the snake_case storage shape", () => {
        const parsed = skillContentSchema.safeParse({
            name: "pdf-tools",
            description: "Extract and merge PDFs.",
            body: "Use qpdf.",
            files: [{path: "scripts/merge.py", content: "print()"}],
            disable_model_invocation: true,
        })
        expect(parsed.success).toBe(true)
    })

    it("rejects non-kebab names", () => {
        expect(
            skillContentSchema.safeParse({
                name: "Not Valid",
                description: "d",
                body: "b",
            }).success,
        ).toBe(false)
    })
})

describe("response schemas", () => {
    it("parses a registry response with builtin block", () => {
        const parsed = skillsQueryResponseSchema.safeParse({
            count: 1,
            skills: [
                {
                    id: "0198...",
                    workflow_id: "w1",
                    workflow_slug: "pdf-tools",
                    name: "PDF tools",
                    version: "3",
                    files_count: 2,
                },
            ],
            builtin: [{workflow_slug: "__ag__web-search", is_static: true}],
            windowing: {next: "0198..."},
        })
        expect(parsed.success).toBe(true)
    })

    it("parses a usage response", () => {
        const parsed = skillUsageResponseSchema.safeParse({
            count: 1,
            usage: [{agent_slug: "agent-x", mode: "pinned", pinned_version: "2"}],
        })
        expect(parsed.success).toBe(true)
    })
})
