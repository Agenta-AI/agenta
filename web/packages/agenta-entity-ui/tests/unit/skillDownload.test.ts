// @vitest-environment node
import {strFromU8, unzipSync} from "fflate"
import {describe, expect, it} from "vitest"

import {
    buildSkillDownload,
    composeSkillMarkdown,
} from "../../src/DrillInView/SchemaControls/skillDownload"
import {scanSkillFiles} from "../../src/DrillInView/SchemaControls/skillUpload"

const unzipText = (content: string | Uint8Array): Record<string, string> => {
    if (typeof content === "string") throw new Error("expected zip bytes")
    return Object.fromEntries(
        Object.entries(unzipSync(content)).map(([path, bytes]) => [path, strFromU8(bytes)]),
    )
}

describe("composeSkillMarkdown", () => {
    it("quotes the frontmatter and flattens the description the way the runner does", () => {
        expect(
            composeSkillMarkdown({
                name: "pdf-tools",
                description: "Use for PDFs: merge,\nsplit ",
                body: "# PDF tools",
                disable_model_invocation: true,
            }),
        ).toBe(
            '---\nname: "pdf-tools"\ndescription: "Use for PDFs: merge, split"\n' +
                "disable-model-invocation: true\n---\n\n# PDF tools\n",
        )
    })

    it("reads non-string fields as empty", () => {
        expect(composeSkillMarkdown({name: 3, description: null, body: {}})).toBe(
            '---\nname: ""\ndescription: ""\n---\n\n\n',
        )
    })
})

describe("buildSkillDownload", () => {
    it("downloads a skill without bundled files as one SKILL.md", () => {
        expect(
            buildSkillDownload({
                name: "pdf-tools",
                description: "Use for PDFs: merge,\nsplit",
                body: "# PDF tools",
                disable_model_invocation: true,
                files: [{path: "", content: "skipped"}],
            }),
        ).toEqual({
            filename: "SKILL.md",
            type: "text/markdown",
            content:
                '---\nname: "pdf-tools"\ndescription: "Use for PDFs: merge, split"\n' +
                "disable-model-invocation: true\n---\n\n# PDF tools\n",
        })
    })

    it("downloads a skill with bundled files as a zip of its folder", () => {
        const download = buildSkillDownload({
            name: " pdf-tools ",
            description: "Use for PDFs",
            body: "# PDF tools",
            files: [
                {path: "scripts/merge.py", content: "print('merge')\n", executable: true},
                {path: "reference.md", content: "# Reference"},
                {path: "bad.bin", content: 42},
            ],
        })
        expect(download?.filename).toBe("pdf-tools.zip")
        expect(download?.type).toBe("application/zip")
        expect(unzipText(download!.content)).toEqual({
            "pdf-tools/SKILL.md":
                '---\nname: " pdf-tools "\ndescription: "Use for PDFs"\n---\n\n# PDF tools\n',
            "pdf-tools/scripts/merge.py": "print('merge')\n",
            "pdf-tools/reference.md": "# Reference",
        })
    })

    it("names the folder 'skill' when the skill has no name", () => {
        const download = buildSkillDownload({body: "# Body", files: [{path: "a.md", content: "a"}]})
        expect(download?.filename).toBe("skill.zip")
        expect(Object.keys(unzipText(download!.content))).toEqual(["skill/SKILL.md", "skill/a.md"])
    })

    it("round-trips through the upload scanner", () => {
        const download = buildSkillDownload({
            name: "pdf-tools",
            description: "Use for PDFs: merge,\nsplit",
            disable_model_invocation: true,
            body: "# PDF tools\n\nRun the scripts.",
            files: [
                {path: "scripts/merge.py", content: "print('merge')\n"},
                {path: "reference.md", content: "# Reference"},
            ],
        })
        const raw = Object.entries(unzipSync(download!.content as Uint8Array)).map(
            ([path, bytes]) => ({path, bytes}),
        )
        expect(scanSkillFiles(raw)).toEqual({
            candidates: [
                {
                    dir: "pdf-tools",
                    skill: {
                        name: "pdf-tools",
                        description: "Use for PDFs: merge, split",
                        disable_model_invocation: true,
                        body: "# PDF tools\n\nRun the scripts.",
                        files: [
                            {path: "scripts/merge.py", content: "print('merge')\n"},
                            {path: "reference.md", content: "# Reference"},
                        ],
                    },
                },
            ],
            skipped: [],
            fileCount: 3,
        })
    })

    it("slugs the folder name and drops paths that would leave the skill folder", () => {
        const download = buildSkillDownload({
            name: "../My Skill",
            body: "Body",
            files: [
                {path: "../escape.sh", content: "x"},
                {path: "/abs.txt", content: "x"},
                {path: "SKILL.md", content: "x"},
                {path: "./SKILL.md", content: "x"},
                {path: "ok/notes.md", content: "kept"},
            ],
        })
        expect(download?.filename).toBe("my-skill.zip")
        expect(Object.keys(unzipText(download!.content))).toEqual([
            "my-skill/SKILL.md",
            "my-skill/ok/notes.md",
        ])
    })

    it("returns null when the skill has neither a name nor a body", () => {
        expect(buildSkillDownload({name: "  ", body: "", files: [{path: "a", content: "a"}]})).toBe(
            null,
        )
    })
})
