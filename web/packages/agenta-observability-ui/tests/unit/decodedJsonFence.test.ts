/**
 * `stripJsonFence` replaced `/^```(?:json)?\s*([\s\S]*?)\s*```$/i`, which CodeQL flagged as a
 * polynomial ReDoS (js/polynomial-redos): the lazy body and the two `\s*` runs overlap, so a fence
 * padded with spaces made the engine retry every split point. These tests pin both halves of the
 * claim — the same fences are recognised, and the new check is linear.
 */
import {describe, expect, it} from "vitest"

import {parseStructuredJson, stripJsonFence} from "../../src/drillIn/decodedJsonHelpers"

/** The pattern the helper replaced, applied the way the caller applied it. */
const legacyStripJsonFence = (input: string): string | null => {
    const fencedMatch = input.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
    return fencedMatch?.[1] ? fencedMatch[1].trim() : null
}

const CASES = [
    '```json\n{"a": 1}\n```',
    '```JSON {"a": 1} ```',
    '```{"a": 1}```',
    '```json{"a":1}```',
    "```jsonx```",
    "```js\n{}```",
    "```a```b```",
    "```",
    "``````",
    "```json```",
    "```   ```",
    '{"a": 1}',
    "",
    "not fenced at all",
    '```json\n{"a": 1}\n``` trailing',
    // The shape CodeQL named, at a length the old pattern still handles quickly.
    `\`\`\`${" ".repeat(20)}`,
    `\`\`\`${" ".repeat(20)}x`,
    `\`\`\`${" ".repeat(20)}\`\`\``,
]

describe("stripJsonFence", () => {
    it("recognises exactly the fences the pattern it replaced recognised", () => {
        for (const value of CASES) {
            expect({value, body: stripJsonFence(value)}).toEqual({
                value,
                body: legacyStripJsonFence(value),
            })
        }
    })

    it("still unwraps a fenced payload end to end", () => {
        expect(parseStructuredJson('```json\n{"a": 1}\n```')).toEqual({a: 1})
        expect(parseStructuredJson("```\n[1, 2]\n```")).toEqual([1, 2])
        expect(parseStructuredJson("```json\nnot json\n```")).toBeNull()
    })

    it("stays linear on the input the old pattern backtracked on", () => {
        // 10k characters of the exact witness CodeQL reported: an opening fence then many spaces.
        const pathological = `\`\`\`${" ".repeat(10_000)}x`

        const started = performance.now()
        const result = parseStructuredJson(pathological)
        const elapsed = performance.now() - started

        expect(result).toBeNull()
        expect(elapsed).toBeLessThan(100)
    })
})
