import {connectModelGate} from "@agenta/chat/hooks"
import {describe, expect, it} from "vitest"

const facts = (over: Partial<Parameters<typeof connectModelGate>[0]> = {}) => ({
    loading: false,
    candidateCount: 0,
    ...over,
})

describe("connectModelGate", () => {
    it("shows setup after all sources resolve with no runnable candidate", () => {
        expect(connectModelGate(facts())).toBe(true)
    })

    it("stays down when a stored connection or ready subscription contributes a candidate", () => {
        expect(connectModelGate(facts({candidateCount: 1}))).toBe(false)
    })

    it("does not turn loading into an empty-state claim", () => {
        expect(connectModelGate(facts({loading: true}))).toBe(false)
    })
})
