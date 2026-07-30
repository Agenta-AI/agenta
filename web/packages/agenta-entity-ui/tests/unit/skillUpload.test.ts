import {describe, expect, it} from "vitest"

import {
    buildSkillFromFiles,
    mergePastedSkill,
    parseSkillMarkdown,
} from "../../src/DrillInView/SchemaControls/skillUpload"

const bytes = (value: string) => new TextEncoder().encode(value)

describe("parseSkillMarkdown", () => {
    it("parses a plain YAML description", () => {
        const parsed = parseSkillMarkdown(
            "---\nname: my-skill\ndescription: When to use it\n---\n# Body",
        )
        expect(parsed).toEqual({name: "my-skill", description: "When to use it", body: "# Body"})
    })

    it("unquotes single-quoted and double-quoted descriptions", () => {
        const single = parseSkillMarkdown("---\ndescription: 'Quoted: value'\n---\n# Body")
        expect(single.description).toBe("Quoted: value")

        const double = parseSkillMarkdown('---\ndescription: "Quoted: value"\n---\n# Body')
        expect(double.description).toBe("Quoted: value")
    })

    it("folds a `>-` description into one string", () => {
        const parsed = parseSkillMarkdown(`---
name: agent-release-gate
description: >-
  Run the agent release gate — a portable, wire-level QA harness.
  Use it before an agent-workflows release.
allowed-tools: Read, Bash
---
# Agent release gate
`)

        expect(parsed).toEqual({
            name: "agent-release-gate",
            description:
                "Run the agent release gate — a portable, wire-level QA harness. Use it before an agent-workflows release.",
            body: "# Agent release gate\n",
        })
    })

    it("leaves description undefined when the frontmatter has none", () => {
        const parsed = parseSkillMarkdown("---\nname: my-skill\n---\n# Body")
        expect(parsed.name).toBe("my-skill")
        expect(parsed.description).toBeUndefined()
    })

    it("leaves description undefined when YAML returns a non-string", () => {
        const parsed = parseSkillMarkdown(
            "---\nname: my-skill\ndescription:\n  - not\n  - a string\n---\n# Body",
        )
        expect(parsed.description).toBeUndefined()
        expect(parsed.body).toBe("# Body")
    })

    it("leaves name undefined when YAML returns a non-string, such as `name: 123`", () => {
        const parsed = parseSkillMarkdown("---\nname: 123\ndescription: Fine\n---\n# Body")
        expect(parsed.name).toBeUndefined()
        expect(parsed.description).toBe("Fine")
    })

    it("treats a whitespace-only value as absent", () => {
        const parsed = parseSkillMarkdown('---\nname: "  "\ndescription: " ok "\n---\n# Body')
        expect(parsed.name).toBeUndefined()
        expect(parsed.description).toBe("ok")
    })

    it("does not throw on invalid YAML and preserves the extracted body", () => {
        const parsed = parseSkillMarkdown("---\nname: [unclosed\ndescription: :::\n---\n# Body")
        expect(parsed).toEqual({name: undefined, description: undefined, body: "# Body"})
    })

    it("returns the whole document as body when there is no frontmatter", () => {
        const parsed = parseSkillMarkdown("# Just a body\n\nNo metadata here.")
        expect(parsed).toEqual({body: "# Just a body\n\nNo metadata here."})
    })
})

describe("buildSkillFromFiles", () => {
    it("preserves nested resource paths and exact decoded text", () => {
        const parsed = buildSkillFromFiles([
            {
                path: "release-gate/SKILL.md",
                bytes: bytes("---\nname: release-gate\ndescription: Gate releases\n---\n# Gate"),
            },
            {
                path: "release-gate/resources/coverage.md",
                bytes: bytes("# Coverage\n\nPi × Daytona — ✅\n"),
            },
            {
                path: "release-gate/resources/qa_length.py",
                bytes: bytes("print('length')\n"),
            },
        ])

        expect(parsed.name).toBe("release-gate")
        expect(parsed.files).toEqual([
            {path: "resources/coverage.md", content: "# Coverage\n\nPi × Daytona — ✅\n"},
            {path: "resources/qa_length.py", content: "print('length')\n"},
        ])
    })

    it("keeps Unicode and the trailing newline in files[].content", () => {
        const content = "café — ✅ 日本語\n"
        const parsed = buildSkillFromFiles([
            {path: "skill/SKILL.md", bytes: bytes("---\nname: skill\n---\n# Body")},
            {path: "skill/resources/unicode.md", bytes: bytes(content)},
        ])
        expect(parsed.files).toEqual([{path: "resources/unicode.md", content}])
    })
})

describe("mergePastedSkill", () => {
    it("lifts frontmatter name/description out and keeps only the body", () => {
        const md = `---\nname: my-skill\ndescription: When to use it\n---\n# Body\n\nDo the thing.`
        const next = mergePastedSkill({name: "old", files: [{path: "a.py", content: "x"}]}, md)
        expect(next.name).toBe("my-skill")
        expect(next.description).toBe("When to use it")
        expect(next.body).toBe("# Body\n\nDo the thing.")
        expect(next.files).toEqual([{path: "a.py", content: "x"}])
    })

    it("with no frontmatter, sets body and leaves name/description untouched", () => {
        const next = mergePastedSkill({name: "keep", description: "keep me"}, "# Just a body")
        expect(next.name).toBe("keep")
        expect(next.description).toBe("keep me")
        expect(next.body).toBe("# Just a body")
    })
})
