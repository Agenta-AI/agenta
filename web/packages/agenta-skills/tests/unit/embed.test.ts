import {describe, expect, it} from "vitest"

import {buildSkillEmbedEntry, isSkillEmbedEntry, parseSkillEmbedEntry} from "../../src/embed"

describe("buildSkillEmbedEntry", () => {
    it("emits an artifact-level ref with a sibling name for latest", () => {
        const entry = buildSkillEmbedEntry({
            slug: "pdf-tools",
            workflowId: "wf-1",
            name: "PDF tools",
            description: "Extract and merge PDFs",
            mode: "latest",
        })

        expect(entry).toEqual({
            "@ag.embed": {
                "@ag.references": {workflow: {slug: "pdf-tools", id: "wf-1"}},
            },
            name: "PDF tools",
            description: "Extract and merge PDFs",
        })
    })

    it("emits a revision-level ref with version for pinned", () => {
        const entry = buildSkillEmbedEntry({
            slug: "pdf-tools",
            name: "PDF tools",
            mode: "pinned",
            version: "3",
        })

        expect(entry["@ag.embed"]["@ag.references"]).toEqual({
            workflow_revision: {slug: "pdf-tools", version: "3"},
        })
        // The sibling name is REQUIRED: without it rows render the raw slug.
        expect(entry.name).toBe("PDF tools")
        expect(entry).not.toHaveProperty("description")
    })
})

describe("parseSkillEmbedEntry", () => {
    it("round-trips a latest entry", () => {
        const entry = buildSkillEmbedEntry({
            slug: "pdf-tools",
            workflowId: "wf-1",
            name: "PDF tools",
            mode: "latest",
        })
        expect(parseSkillEmbedEntry(entry)).toEqual({
            slug: "pdf-tools",
            workflowId: "wf-1",
            mode: "latest",
            version: undefined,
            name: "PDF tools",
            description: undefined,
        })
    })

    it("round-trips a pinned entry", () => {
        const parsed = parseSkillEmbedEntry(
            buildSkillEmbedEntry({
                slug: "pdf-tools",
                name: "PDF tools",
                mode: "pinned",
                version: "3",
            }),
        )
        expect(parsed?.mode).toBe("pinned")
        expect(parsed?.version).toBe("3")
    })

    it("returns undefined for inline skill packages", () => {
        expect(parseSkillEmbedEntry({name: "inline", body: "..."})).toBeUndefined()
        expect(isSkillEmbedEntry({name: "inline", body: "..."})).toBe(false)
    })

    it("tolerates foreign entry shapes without throwing", () => {
        expect(parseSkillEmbedEntry(null)).toBeUndefined()
        expect(parseSkillEmbedEntry("text")).toBeUndefined()
        expect(parseSkillEmbedEntry({"@ag.embed": {}})).toBeUndefined()
    })
})
