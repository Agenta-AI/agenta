import {describe, expect, it} from "vitest"

import {
    editorKind,
    GRID_TEXT_MAX_CHARS,
    pickFieldEditor,
} from "@/features/testsets/detail/fields/pickFieldEditor"

const kindOf = (value: unknown) => {
    const pick = pickFieldEditor(value)
    return {grid: pick.grid, kind: editorKind(pick, pick.defaultView), views: pick.views}
}

describe("pickFieldEditor", () => {
    it("puts short values in the grid with an inline editor", () => {
        expect(kindOf("en")).toMatchObject({grid: true, kind: "text"})
        expect(kindOf(5)).toMatchObject({grid: true, kind: "number", views: []})
        expect(kindOf(true)).toMatchObject({grid: true, kind: "boolean", views: []})
        expect(kindOf("https://example.org/a")).toMatchObject({grid: true, kind: "text"})
        expect(kindOf("")).toMatchObject({grid: true, kind: "text"})
        expect(kindOf(null)).toMatchObject({grid: true, kind: "text"})
    })

    it("keeps a grid text to one line of at most 140 characters", () => {
        expect(kindOf("a".repeat(GRID_TEXT_MAX_CHARS)).grid).toBe(true)
        expect(kindOf("a".repeat(GRID_TEXT_MAX_CHARS + 1))).toMatchObject({
            grid: false,
            kind: "textArea",
        })
        // Three lines are text-short for the taxonomy, but a section here.
        expect(kindOf("one\ntwo\nthree")).toMatchObject({grid: false, kind: "textArea"})
    })

    it("draws every other shape as a section with its editor", () => {
        expect(kindOf(Array.from({length: 20}, (_, n) => `line ${n}`).join("\n"))).toMatchObject({
            grid: false,
            kind: "textArea",
        })
        expect(kindOf("# Title\n\n- one\n- two")).toMatchObject({grid: false, kind: "markdown"})
        expect(kindOf(["a", "b"])).toMatchObject({grid: false, kind: "chips"})
        expect(kindOf({a: 1, b: "x"})).toMatchObject({grid: false, kind: "keyRows"})
        expect(kindOf({a: {b: 1}})).toMatchObject({grid: false, kind: "keyRows"})
        expect(kindOf([{role: "user", content: "Hi"}])).toMatchObject({
            grid: false,
            kind: "messages",
            views: ["chat", "json"],
        })
        expect(kindOf([{sku: "A", qty: 2}])).toMatchObject({grid: false, kind: "code"})
        expect(kindOf([1, {a: 2}])).toMatchObject({grid: false, kind: "code"})
    })

    it("edits JSON written as text as code, never in the grid", () => {
        expect(kindOf('{"a": 1}')).toMatchObject({
            grid: false,
            kind: "code",
            views: ["json", "yaml"],
        })
        expect(pickFieldEditor('{"a": 1}').parsedFromText).toBe(true)
    })

    it("offers Show as by the value, and the chosen view picks the editor", () => {
        const text = pickFieldEditor("Write a summary\nof the text")
        expect(text.views).toEqual(["text", "markdown", "json"])
        expect(editorKind(text, "markdown")).toBe("markdown")
        expect(editorKind(text, "json")).toBe("code")
        expect(pickFieldEditor({a: 1}).views).toEqual(["form", "json", "yaml"])
        expect(editorKind(pickFieldEditor({a: 1}), "yaml")).toBe("code")
    })

    it('picks once: a text field that receives "true" keeps the text editor', () => {
        const pick = pickFieldEditor("yes")
        // The form keeps this pick; a new value does not pick again.
        expect(editorKind(pick, pick.defaultView)).toBe("text")
        expect(editorKind(pickFieldEditor(true), "text")).toBe("boolean")
        expect(editorKind(pick, pick.defaultView)).toBe("text")
    })
})
