import {describe, expect, it} from "vitest"

import {shouldShowStopControl} from "../../../src/assets/composerState"

describe("shouldShowStopControl", () => {
    it.each([
        [{busy: true, hitlPending: false}, true],
        [{busy: false, hitlPending: true}, true],
        [{busy: true, hitlPending: true}, true],
        [{busy: false, hitlPending: false}, false],
    ])("returns %s for %o", (state, expected) => {
        expect(shouldShowStopControl(state)).toBe(expected)
    })
})
