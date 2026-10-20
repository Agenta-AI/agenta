import {describe, expect, it} from "vitest"

import {connectModelGate} from "../../../src/hooks/useAgentModelKeyStatus"

describe("connectModelGate", () => {
    it("stays down while sources load", () => {
        expect(connectModelGate({loading: true, candidateCount: 0})).toBe(false)
    })

    it("stays down when a key or a built-in model gives a runnable route", () => {
        expect(connectModelGate({loading: false, candidateCount: 1})).toBe(false)
    })

    it("opens only when everything settled with no runnable route", () => {
        expect(connectModelGate({loading: false, candidateCount: 0})).toBe(true)
    })
})
