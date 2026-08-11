/**
 * Index logic behind the `/` palette panels' keyboard navigation.
 *
 * The panels are the only way to change a model, harness, or permission policy from the chat, and
 * `README.md` beside this file makes keyboard operation a contract rather than a nice-to-have —
 * so the stepping, wrapping, and "open on the row already in effect" rules are pinned here.
 */
import {describe, expect, it} from "vitest"

import {firstEnabledIndex, initialIndex, stepIndex} from "./useRovingList"

const items = ["pi_core", "claude", "codex"]

describe("stepIndex", () => {
    it("moves forward and backward", () => {
        expect(stepIndex(items, 0, 1)).toBe(1)
        expect(stepIndex(items, 2, -1)).toBe(1)
    })

    it("wraps at both ends", () => {
        expect(stepIndex(items, 2, 1)).toBe(0)
        expect(stepIndex(items, 0, -1)).toBe(2)
    })

    it("enters the list from an unset index", () => {
        expect(stepIndex(items, -1, 1)).toBe(0)
        expect(stepIndex(items, -1, -1)).toBe(2)
    })

    it("skips disabled rows", () => {
        const disabled = (v: string) => v === "claude"
        expect(stepIndex(items, 0, 1, disabled)).toBe(2)
        expect(stepIndex(items, 2, -1, disabled)).toBe(0)
    })

    it("stays put when every other row is disabled", () => {
        const onlyCodex = (v: string) => v !== "codex"
        expect(stepIndex(items, 2, 1, onlyCodex)).toBe(2)
    })

    it("reports no index for an empty list", () => {
        expect(stepIndex([], 0, 1)).toBe(-1)
        expect(stepIndex([], -1, -1)).toBe(-1)
    })
})

describe("firstEnabledIndex", () => {
    it("finds the first selectable row", () => {
        expect(firstEnabledIndex(items)).toBe(0)
        expect(firstEnabledIndex(items, (v) => v === "pi_core")).toBe(1)
    })

    it("returns -1 when nothing is selectable", () => {
        expect(firstEnabledIndex(items, () => true)).toBe(-1)
        expect(firstEnabledIndex([])).toBe(-1)
    })
})

describe("initialIndex", () => {
    // A picker that opened on row 0 would misreport which harness/policy is actually in effect.
    it("opens on the row currently in effect", () => {
        expect(initialIndex(items, "codex")).toBe(2)
    })

    it("falls back to the first row when nothing is in effect", () => {
        expect(initialIndex(items, null)).toBe(0)
        expect(initialIndex(items, undefined)).toBe(0)
    })

    it("falls back when the current value is not in the list", () => {
        expect(initialIndex(items, "pi_agenta")).toBe(0)
    })

    it("honours a custom comparator", () => {
        const objects = [{id: "a"}, {id: "b"}]
        expect(initialIndex(objects, {id: "b"}, (x, y) => x.id === y.id)).toBe(1)
    })

    it("skips a disabled first row when falling back", () => {
        expect(initialIndex(items, null, undefined, (v) => v === "pi_core")).toBe(1)
    })
})
