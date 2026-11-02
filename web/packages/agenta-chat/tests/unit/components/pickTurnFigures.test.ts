import {describe, expect, it} from "vitest"

import {pickTurnFigures} from "../../../src/components/TurnMetrics"

describe("pickTurnFigures", () => {
    it("takes a settled turn's figures from its session turn only", () => {
        const sessionTurnFigures = {totalTokens: 10, durationMs: 900}
        expect(
            pickTurnFigures({sessionTurnFigures, usage: {totalCost: 1}, isStreaming: false}),
        ).toBe(sessionTurnFigures)
    })

    it("leaves a settled turn without a stored usage unavailable", () => {
        expect(pickTurnFigures({usage: {totalTokens: 5}, isStreaming: false})).toBeUndefined()
    })

    it("shows the streamed usage while the turn runs", () => {
        const usage = {totalTokens: 5}
        expect(pickTurnFigures({usage, isStreaming: true})).toBe(usage)
    })
})
