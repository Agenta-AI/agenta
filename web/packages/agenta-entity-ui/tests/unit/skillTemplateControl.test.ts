/**
 * Unit tests for the static-skill helpers behind SkillTemplateControl.
 *
 * A skill whose embed points at the reserved `__ag__` namespace (or carries a resolved
 * `flags.is_static` marker) is a built-in the user cannot edit.
 */
import {describe, expect, it} from "vitest"

import {
    isStaticSkill,
    staticEmbedSlug,
} from "../../src/DrillInView/SchemaControls/SkillTemplateControl"

const EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "agenta-getting-started"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

const STATIC_EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "__ag__getting_started_with_agenta"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

const STATIC_REVISION_EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {
            workflow_revision: {slug: "__ag__getting_started_with_agenta", version: "v1"},
        },
        "@ag.selector": {path: "parameters.skill"},
    },
}

const INLINE_ENTRY = {
    name: "release-notes",
    description: "Draft release notes.",
    body: "Read the changelog.",
}

describe("SkillTemplateControl: isStaticSkill", () => {
    it("flags an embed whose workflow slug uses the reserved __ag__ namespace", () => {
        expect(isStaticSkill(STATIC_EMBED_ENTRY)).toBe(true)
        expect(staticEmbedSlug(STATIC_EMBED_ENTRY)).toBe("__ag__getting_started_with_agenta")
    })

    it("flags a pinned workflow_revision embed in the reserved namespace", () => {
        expect(isStaticSkill(STATIC_REVISION_EMBED_ENTRY)).toBe(true)
        expect(staticEmbedSlug(STATIC_REVISION_EMBED_ENTRY)).toBe(
            "__ag__getting_started_with_agenta",
        )
    })

    it("treats a non-reserved embed slug as a normal editable skill", () => {
        expect(isStaticSkill(EMBED_ENTRY)).toBe(false)
    })

    it("treats an inline package as a normal editable skill", () => {
        expect(isStaticSkill(INLINE_ENTRY)).toBe(false)
        expect(staticEmbedSlug(INLINE_ENTRY)).toBeUndefined()
    })

    it("honours a resolved flags.is_static === true marker", () => {
        expect(isStaticSkill({name: "x", flags: {is_static: true}})).toBe(true)
        expect(isStaticSkill({name: "x", flags: {is_static: false}})).toBe(false)
    })
})
