import {describe, expect, it} from "vitest"

import {connectModelGate} from "../../../src/hooks/useAgentModelKeyStatus"

describe("connectModelGate", () => {
    it("stays down while sources load", () => {
        expect(connectModelGate({loading: true, candidateCount: 0})).toBe(false)
    })

    it("stays down when credits fund built-in models", () => {
        expect(connectModelGate({loading: false, candidateCount: 0, hasBuiltinModels: true})).toBe(
            false,
        )
    })

    it("stays down when a key gives a runnable route", () => {
        expect(connectModelGate({loading: false, candidateCount: 1})).toBe(false)
    })

    it("opens only when everything settled with no route and no credits", () => {
        expect(connectModelGate({loading: false, candidateCount: 0})).toBe(true)
    })
})
