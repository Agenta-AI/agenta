import {describe, expect, it} from "vitest"

import {
    editorKind,
    fitsEditor,
    GRID_TEXT_MAX_CHARS,
    isIdKey,
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

describe("isIdKey", () => {
    it("names the identifier columns the board draws in mono", () => {
        for (const key of [
            "id",
            "ticket_id",
            "scenario_id",
            "folder_hash",
            "git_commit",
            "org.uuid",
            "commit-sha",
            "userId",
            "testcaseID",
            "commitSHA",
            "parentHash",
        ]) {
            expect(isIdKey(key), key).toBe(true)
        }
        for (const key of [
            "title",
            "idea",
            "valid",
            "paid",
            "void",
            "grid",
            "android",
            "squid",
            "PAID",
            "identity",
            "commitment",
            "rehash",
            "nosha",
        ]) {
            expect(isIdKey(key), key).toBe(false)
        }
    })
})

describe("empty list and object", () => {
    it("open in the editor of their kind, not as a text", () => {
        expect(kindOf([])).toMatchObject({grid: false, kind: "chips", views: ["form", "json"]})
        expect(kindOf({})).toMatchObject({
            grid: false,
            kind: "keyRows",
            views: ["form", "json", "yaml"],
        })
    })
})

describe("chat editor", () => {
    it("edits a chat it writes back without a loss, and any other chat as JSON", () => {
        const plain = [
            {role: "user", content: "Hi"},
            {role: "assistant", content: null, tool_calls: [{id: "c1"}]},
        ]
        expect(kindOf(plain)).toMatchObject({kind: "messages", views: ["chat", "json"]})
        // The chat editor drops a key it does not know, so this chat edits as JSON.
        expect(kindOf([{role: "user", content: "Hi", reasoning: "x"}])).toMatchObject({
            kind: "code",
            views: ["json", "yaml"],
        })
    })
})

describe("fitsEditor", () => {
    it("says when a value can no longer stay in its editor", () => {
        expect(fitsEditor("chips", ["a", 1])).toBe(true)
        expect(fitsEditor("chips", {a: 1})).toBe(false)
        expect(fitsEditor("keyRows", ["a"])).toBe(false)
        expect(fitsEditor("boolean", "true")).toBe(false)
        expect(fitsEditor("number", "12")).toBe(false)
        expect(fitsEditor("text", null)).toBe(true)
        expect(fitsEditor("text", "one\ntwo")).toBe(false)
        expect(fitsEditor("textArea", "one\ntwo")).toBe(true)
        expect(fitsEditor("code", {a: 1})).toBe(true)
    })
})
