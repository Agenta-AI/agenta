import {describe, expect, it} from "vitest"

import {mergePastedSkill} from "../../src/DrillInView/SchemaControls/skillUpload"

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
