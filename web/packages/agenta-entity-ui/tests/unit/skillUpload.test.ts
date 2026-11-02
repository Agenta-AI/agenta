import {describe, expect, it} from "vitest"

import {
    buildSkillFromFiles,
    mergePastedSkill,
    parseSkillMarkdown,
    scanSkillFiles,
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

describe("scanSkillFiles", () => {
    it("returns one candidate per SKILL.md, each scoped to its own subtree", () => {
        const scan = scanSkillFiles([
            {path: "skills/alpha/SKILL.md", bytes: bytes("---\nname: alpha\n---\nA")},
            {path: "skills/alpha/ref.md", bytes: bytes("alpha ref")},
            {path: "skills/beta/SKILL.md", bytes: bytes("---\nname: beta\n---\nB")},
            {path: "README.md", bytes: bytes("repo readme")},
        ])
        expect(scan.candidates.map((c) => c.skill.name)).toEqual(["alpha", "beta"])
        const alpha = scan.candidates[0]
        // alpha owns only its subtree — beta's files and the repo README never leak in.
        expect(alpha.skill.files).toEqual([{path: "ref.md", content: "alpha ref"}])
        expect(scan.fileCount).toBe(4)
    })

    it("a nested skill's files stay out of the parent candidate", () => {
        const scan = scanSkillFiles([
            {path: "SKILL.md", bytes: bytes("---\nname: parent\n---\nP")},
            {path: "nested/SKILL.md", bytes: bytes("---\nname: nested\n---\nN")},
            {path: "nested/helper.py", bytes: bytes("print()")},
        ])
        const parent = scan.candidates.find((c) => c.skill.name === "parent")
        expect(parent?.skill.files).toEqual([])
        const nested = scan.candidates.find((c) => c.skill.name === "nested")
        expect(nested?.skill.files).toEqual([{path: "helper.py", content: "print()"}])
    })

    it("skips binary and oversized files with a reason instead of mojibaking them in", () => {
        const binary = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a])
        const huge = bytes("x".repeat(200_001))
        const scan = scanSkillFiles([
            {path: "skill/SKILL.md", bytes: bytes("---\nname: skill\n---\nBody")},
            {path: "skill/logo.png", bytes: binary},
            {path: "skill/big.txt", bytes: huge},
        ])
        expect(scan.candidates[0].skill.files).toEqual([])
        expect(scan.skipped).toEqual([
            {path: "skill/logo.png", reason: "binary"},
            {path: "skill/big.txt", reason: "too large"},
        ])
    })

    it("no SKILL.md anywhere yields zero candidates (the invalid state)", () => {
        const scan = scanSkillFiles([{path: "notes.md", bytes: bytes("just notes")}])
        expect(scan.candidates).toEqual([])
        expect(scan.fileCount).toBe(1)
    })
})
