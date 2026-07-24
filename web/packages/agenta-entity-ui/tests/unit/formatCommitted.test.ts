/**
 * Unit tests for `formatCommitted`, the pure helper behind a changed rail row's "committed value"
 * popover.
 *
 * It exists because the two sides disagree on what a value looks like: the commit-diff classifier
 * stores scalars through `JSON.stringify` (`commitDiff/classify.ts` → `fmtScalar`) because it is
 * COMPARING them, while the popover is SHOWING them to a person. Left unformatted that leaked wire
 * syntax into the UI — an untouched allow-list rendered as a bare `[]`. These pin the unwrapping,
 * and that the empty/absent cases get named rather than printing punctuation at the reader.
 *
 * Runs under @agenta/entity-ui's vitest runner.
 */
import {describe, expect, it} from "vitest"

import {formatCommitted} from "../../src/drawers/shared/RailField"

describe("formatCommitted — the classifier's wire value, as a reader sees it", () => {
    it("names the absent and empty cases instead of showing their punctuation", () => {
        // `[]` is what the popover actually leaked before this existed.
        expect(formatCommitted(undefined)).toEqual({text: "Not set", muted: true})
        expect(formatCommitted("[]")).toEqual({text: "Empty", muted: true})
        expect(formatCommitted("{}")).toEqual({text: "Empty", muted: true})
        expect(formatCommitted('""')).toEqual({text: "Empty", muted: true})
        expect(formatCommitted("   ")).toEqual({text: "Empty", muted: true})
    })

    it("unwraps a stringified list to one entry per line, matching the control that renders it", () => {
        // The allow-rules field is a textarea of one rule per line — not `["Terminal","Write"]`.
        expect(formatCommitted('["Terminal","Write"]')).toEqual({
            text: "Terminal\nWrite",
            muted: false,
        })
    })

    it("keeps a plain scalar as itself", () => {
        expect(formatCommitted("ask")).toEqual({text: "ask", muted: false})
        expect(formatCommitted("42")).toEqual({text: "42", muted: false})
    })

    it("pretty-prints a non-empty object rather than showing one long line", () => {
        expect(formatCommitted('{"mode":"deny"}')).toEqual({
            text: '{\n  "mode": "deny"\n}',
            muted: false,
        })
    })

    it("passes through a string that only looks like JSON, without throwing", () => {
        // fmtScalar sends non-objects through `String(v)`, so an instruction can reach here unquoted.
        expect(formatCommitted("{not json")).toEqual({text: "{not json", muted: false})
    })
})
