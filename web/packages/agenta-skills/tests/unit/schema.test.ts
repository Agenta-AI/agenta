import {describe, expect, it} from "vitest"

import {
    skillContentSchema,
    skillsQueryResponseSchema,
    skillReferencedByResponseSchema,
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

    it("parses a referenced-by response and keeps the rows", () => {
        const parsed = skillReferencedByResponseSchema.safeParse({
            count: 2,
            referenced_by: [
                {agent_slug: "agent-x", mode: "pinned", pinned_version: "2"},
                {
                    agent_workflow_id: "01a0",
                    agent_name: "Agent Y",
                    mode: "latest",
                },
            ],
        })
        expect(parsed.success).toBe(true)
        // The rows must SURVIVE the parse: a passthrough schema accepts a response
        // whose field it does not declare, and the drawer then renders an empty
        // "used by" list against a non-empty API answer (PR #6625 review).
        expect(parsed.data?.referenced_by).toHaveLength(2)
        expect(parsed.data?.referenced_by?.[0]?.mode).toBe("pinned")
    })

    it("does not silently accept the pre-rename field name", () => {
        const parsed = skillReferencedByResponseSchema.safeParse({
            count: 1,
            usage: [{agent_slug: "agent-x", mode: "latest"}],
        })
        // Passthrough still parses, but the declared field stays empty — the guard
        // is this assertion, which fails the moment the wire name drifts again.
        expect(parsed.data?.referenced_by ?? []).toHaveLength(0)
    })
})
