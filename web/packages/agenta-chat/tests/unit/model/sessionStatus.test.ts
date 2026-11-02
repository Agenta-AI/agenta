import {describe, expect, it} from "vitest"

import {deriveSessionRunStatus, type SessionRunStatusInputs} from "../../../src/model/sessionStatus"

describe("deriveSessionRunStatus", () => {
    it.each<[SessionRunStatusInputs, string]>([
        [{error: true, hitlPending: true, busy: true}, "error"],
        [{error: true, hitlPending: false, busy: false}, "error"],
        [{error: false, hitlPending: true, busy: true}, "awaiting"],
        [{error: false, hitlPending: true, busy: false}, "awaiting"],
        [{error: false, hitlPending: false, busy: true}, "running"],
        [{error: false, hitlPending: false, busy: false}, "idle"],
    ])("precedence for %j is %s", (inputs, expected) => {
        expect(deriveSessionRunStatus(inputs)).toBe(expected)
    })
})
