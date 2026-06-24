/**
 * Unit tests for the pure round-trip helpers behind SkillConfigControl.
 *
 * A skills entry is either an inline SKILL.md package or an `@ag.embed` reference the backend
 * inlines server-side. The control edits the entry as JSON and must preserve an `@ag.embed`
 * object intact on round-trip (the embed markers — `@ag.embed`, `@ag.references`, `@ag.selector`
 * — must survive). The transform is extracted so that guarantee is testable without React.
 */
import {describe, expect, it} from "vitest"

import {
    isEmbedRef,
    isPlatformSkill,
    parseSkillEditorText,
    platformEmbedSlug,
} from "../../src/DrillInView/SchemaControls/SkillConfigControl"

const EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "agenta-getting-started"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

const PLATFORM_EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {workflow: {slug: "_agenta.agenta-getting-started"}},
        "@ag.selector": {path: "parameters.skill"},
    },
}

const PLATFORM_REVISION_EMBED_ENTRY = {
    "@ag.embed": {
        "@ag.references": {
            workflow_revision: {slug: "_agenta.agenta-getting-started", version: "v3"},
        },
        "@ag.selector": {path: "parameters.skill"},
    },
}

const INLINE_ENTRY = {
    name: "release-notes",
    description: "Draft release notes.",
    body: "Read the changelog.",
}

describe("SkillConfigControl: isEmbedRef", () => {
    it("detects an @ag.embed reference entry", () => {
        expect(isEmbedRef(EMBED_ENTRY)).toBe(true)
    })

    it("treats an inline package as not an embed", () => {
        expect(isEmbedRef(INLINE_ENTRY)).toBe(false)
    })
})

describe("SkillConfigControl: isPlatformSkill", () => {
    it("flags an embed whose workflow slug uses the reserved _agenta. namespace", () => {
        expect(isPlatformSkill(PLATFORM_EMBED_ENTRY)).toBe(true)
        expect(platformEmbedSlug(PLATFORM_EMBED_ENTRY)).toBe("_agenta.agenta-getting-started")
    })

    it("flags a pinned workflow_revision embed in the reserved namespace", () => {
        expect(isPlatformSkill(PLATFORM_REVISION_EMBED_ENTRY)).toBe(true)
        expect(platformEmbedSlug(PLATFORM_REVISION_EMBED_ENTRY)).toBe(
            "_agenta.agenta-getting-started",
        )
    })

    it("treats a non-reserved embed slug as a normal editable skill", () => {
        expect(isPlatformSkill(EMBED_ENTRY)).toBe(false)
    })

    it("treats an inline package as a normal editable skill", () => {
        expect(isPlatformSkill(INLINE_ENTRY)).toBe(false)
        expect(platformEmbedSlug(INLINE_ENTRY)).toBeUndefined()
    })

    it("honours a resolved flags.is_platform === true marker", () => {
        expect(isPlatformSkill({name: "x", flags: {is_platform: true}})).toBe(true)
        expect(isPlatformSkill({name: "x", flags: {is_platform: false}})).toBe(false)
    })
})

describe("SkillConfigControl: parseSkillEditorText round-trip", () => {
    it("preserves an @ag.embed entry unchanged through the editor round-trip", () => {
        const text = JSON.stringify(EMBED_ENTRY)
        const parsed = parseSkillEditorText(text)
        // The embed object (and its nested @ag.* markers) survives intact.
        expect(parsed).toEqual(EMBED_ENTRY)
        expect(isEmbedRef(parsed as Record<string, unknown>)).toBe(true)
    })

    it("preserves an inline skill package unchanged", () => {
        const parsed = parseSkillEditorText(JSON.stringify(INLINE_ENTRY))
        expect(parsed).toEqual(INLINE_ENTRY)
    })

    it("returns null for invalid JSON so the bad text is not propagated", () => {
        expect(parseSkillEditorText("{not valid")).toBeNull()
    })

    it("returns null for valid JSON that is not a plain object", () => {
        expect(parseSkillEditorText("[1, 2, 3]")).toBeNull()
        expect(parseSkillEditorText('"a string"')).toBeNull()
    })

    it("treats empty text as an empty entry", () => {
        expect(parseSkillEditorText("")).toEqual({})
    })
})
