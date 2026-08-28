/**
 * When a tool row offers its "Show more" toggle.
 *
 * The row measures its own description width, but the measurement alone gets two cases wrong: a
 * description whose text is hidden behind a NEWLINE rather than past the right edge, and a row
 * reused for the same tool key after the description went away, which keeps the last measurement.
 * The second is reachable: a key that leaves the provider catalog comes back through `withStaleTools`
 * as `{key, stale: true}` with no description, and React keeps the row's state across that swap.
 */
import {describe, expect, it} from "vitest"

import {isDescriptionTruncatable} from "../../src/DrillInView/SchemaControls/integrationPolicy"

describe("isDescriptionTruncatable", () => {
    it("offers the toggle when the one-line preview cuts the text off", () => {
        expect(isDescriptionTruncatable("a very long single line", true)).toBe(true)
    })

    it("leaves a short single-line description alone", () => {
        expect(isDescriptionTruncatable("Read one issue", false)).toBe(false)
    })

    it("offers the toggle for a newline even when the first line fits", () => {
        expect(isDescriptionTruncatable("Merges a PR.\n\nFails on a closed PR.", false)).toBe(true)
    })

    it("never offers a toggle with no description, whatever the last measurement said", () => {
        expect(isDescriptionTruncatable(undefined, true)).toBe(false)
        expect(isDescriptionTruncatable("", true)).toBe(false)
    })

    it("does not offer a toggle for a stale row that used to overflow", () => {
        // The row's state before the catalog dropped the key.
        expect(isDescriptionTruncatable("a very long single line", true)).toBe(true)
        // The same row after `withStaleTools` replaced it with a description-less entry.
        expect(isDescriptionTruncatable(undefined, true)).toBe(false)
    })
})
