import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getTurnGrouping} from "../../../src/model/grouping"

const msg = (role: UIMessage["role"], id: string): UIMessage =>
    ({id, role, parts: []}) as unknown as UIMessage

describe("getTurnGrouping", () => {
    it("anchors the active turn on the last user message", () => {
        const messages = [
            msg("user", "u1"),
            msg("assistant", "a1"),
            msg("user", "u2"),
            msg("assistant", "a2"),
        ]
        expect(getTurnGrouping(messages)).toEqual({
            lastUserIndex: 2,
            activeStart: 2,
            reserveActive: true,
        })
    })

    it("reserves fill even in the degenerate no-user case, anchored past the end", () => {
        // No user message at all — lastUserIndex stays -1, so activeStart falls back to
        // messages.length. reserveActive is still true because activeStart (2) > 0.
        const messages = [msg("assistant", "a1"), msg("assistant", "a2")]
        expect(getTurnGrouping(messages)).toEqual({
            lastUserIndex: -1,
            activeStart: 2,
            reserveActive: true,
        })
    })

    it("does not reserve fill for an empty conversation", () => {
        expect(getTurnGrouping([])).toEqual({
            lastUserIndex: -1,
            activeStart: 0,
            reserveActive: false,
        })
    })

    it("does not reserve fill for the opening turn (a single leading user message)", () => {
        const messages = [msg("user", "u1")]
        expect(getTurnGrouping(messages)).toEqual({
            lastUserIndex: 0,
            activeStart: 0,
            reserveActive: false,
        })
    })
})
