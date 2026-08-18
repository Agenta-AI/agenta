import {describe, expect, it} from "vitest"

import {stripFence} from "./toolFormat"

// This file is the authoritative `stripFence` for the desktop chat; `@agenta/chat`'s
// src/assets/toolFormat.ts is a byte-parity copy with the fuller suite
// (packages/agenta-chat/tests/unit/assets/toolFormat.test.ts). Kept here so the copy that actually
// ships in the desktop chat has its own guard against the polynomial-ReDoS regression.
describe("stripFence", () => {
    it("strips a fence that spans the whole string", () => {
        expect(stripFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
        expect(stripFence("```\nhello\n```")).toBe("hello")
    })

    it("leaves anything that is not a whole-string fence alone", () => {
        expect(stripFence("see ```inline``` here")).toBe("see ```inline``` here")
        expect(stripFence("plain text")).toBe("plain text")
        expect(stripFence("```oops")).toBe("```oops")
    })

    // The old /^```[\w-]*\n?([\s\S]*?)\n?```$/ let [\w-]* and [\s\S]*? match the same dashes, so an
    // unclosed fence made the engine try every split point: ~3s at 200k dashes vs ~0.1ms scanning.
    it("stays linear on an unclosed fence followed by many dashes", () => {
        const hostile = "```" + "-".repeat(200_000)
        const start = performance.now()
        expect(stripFence(hostile)).toBe(hostile)
        expect(performance.now() - start).toBeLessThan(250)
    })
})
