import {describe, expect, it} from "vitest"

import {
    CALL_DESCRIPTION_MAX_LENGTH,
    canonicalToolName,
    extractCallDescription,
    partToolName,
    resolveToolDisplay,
} from "./toolDisplay"

// The agent's own note about a builder tool call (R12). It rides in the call's arguments, so the
// tool card reads it straight off `input` on both the live and the replay path.
describe("extractCallDescription", () => {
    it("reads the agent's note off the call input", () => {
        expect(
            extractCallDescription({
                description: "Adding the pdf-tools skill you asked for.",
                workflow_revision: {message: "Add the pdf-tools skill."},
            }),
        ).toEqual({text: "Adding the pdf-tools skill you asked for.", truncated: false})
    })

    it("returns null when the agent wrote no note", () => {
        expect(extractCallDescription({workflow_revision: {message: "m"}})).toBeNull()
    })

    it("treats a blank note as no note", () => {
        expect(extractCallDescription({description: "   "})).toBeNull()
        expect(extractCallDescription({description: ""})).toBeNull()
    })

    it("trims surrounding whitespace", () => {
        expect(extractCallDescription({description: "  why  "})?.text).toBe("why")
    })

    it("ignores a non-string description", () => {
        expect(extractCallDescription({description: 42})).toBeNull()
        expect(extractCallDescription({description: {nested: "no"}})).toBeNull()
        expect(extractCallDescription({description: null})).toBeNull()
    })

    it("survives inputs that are not objects", () => {
        expect(extractCallDescription(undefined)).toBeNull()
        expect(extractCallDescription(null)).toBeNull()
        expect(extractCallDescription("plain")).toBeNull()
        expect(extractCallDescription(["description"])).toBeNull()
    })

    it("cuts an over-long note and says it cut it", () => {
        const long = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH + 50)
        const result = extractCallDescription({description: long})
        expect(result?.truncated).toBe(true)
        expect(result?.text).toHaveLength(CALL_DESCRIPTION_MAX_LENGTH)
    })

    it("does not mark a note at exactly the limit as cut", () => {
        const exact = "a".repeat(CALL_DESCRIPTION_MAX_LENGTH)
        expect(extractCallDescription({description: exact})).toEqual({
            text: exact,
            truncated: false,
        })
    })

    it("cuts on a code-point boundary when an emoji straddles the limit", () => {
        // The emoji is one code point but two UTF-16 units, so a `slice` at the cap would keep a
        // lone surrogate half and the card would render a replacement character.
        const description = `${"a".repeat(CALL_DESCRIPTION_MAX_LENGTH - 1)}\u{1F600}tail`
        const result = extractCallDescription({description})

        expect(result?.truncated).toBe(true)
        expect(result?.text.endsWith("\u{1F600}")).toBe(true)
        expect(result?.text).not.toContain("\uFFFD")
        // No unpaired surrogate survived the cut.
        expect(/[\uD800-\uDFFF]/.test(result!.text.replace(/\p{Emoji_Presentation}/gu, ""))).toBe(
            false,
        )
        expect(Array.from(result!.text)).toHaveLength(CALL_DESCRIPTION_MAX_LENGTH)
    })

    it("counts an all-emoji note in code points, matching the catalog cap", () => {
        // 400 emoji are 800 UTF-16 units: measured in units this would look over the limit and be
        // cut, when the model was well within what the catalog allowed it to send.
        const description = "\u{1F600}".repeat(400)
        const result = extractCallDescription({description})

        expect(result).toEqual({text: description, truncated: false})
    })
})

describe("partToolName", () => {
    it("strips the tool- prefix from a typed part", () => {
        expect(partToolName({type: "tool-commit_revision"} as never)).toBe("commit_revision")
    })

    it("reads toolName off a dynamic part", () => {
        expect(partToolName({type: "dynamic-tool", toolName: "test_run"} as never)).toBe("test_run")
    })
})

describe("canonicalToolName", () => {
    it("unwraps our own MCP server so both harnesses key the same", () => {
        expect(canonicalToolName("mcp__agenta-tools__commit_revision")).toBe("commit_revision")
        expect(canonicalToolName("commit_revision")).toBe("commit_revision")
    })

    it("leaves another server's tool wrapped, so it cannot collide with a platform tool", () => {
        expect(canonicalToolName("mcp__other__commit_revision")).toBe("mcp__other__commit_revision")
        expect(canonicalToolName("mcp__other__x")).toBe("mcp__other__x")
    })

    it("never returns an empty name", () => {
        expect(canonicalToolName("mcp__agenta-tools__")).toBe("mcp__agenta-tools__")
        expect(canonicalToolName("")).toBe("")
    })
})

describe("resolveToolDisplay under an MCP wrapper", () => {
    it("applies the platform tool's override to the wrapped name", () => {
        // The commit summary is keyed by tool name, so it went missing under Claude too.
        const summary = resolveToolDisplay("mcp__agenta-tools__commit_revision").summary
        expect(summary?.({workflow_revision: {message: "Add the skill."}}, null)).toBe(
            "Add the skill.",
        )
    })

    it("still presents it as an MCP tool, and keeps the raw name reachable", () => {
        const display = resolveToolDisplay("mcp__agenta-tools__commit_revision")

        expect(display.kind).toBe("mcp")
        expect(display.raw).toBe("mcp__agenta-tools__commit_revision")
    })
})
