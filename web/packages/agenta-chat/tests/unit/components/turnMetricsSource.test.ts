import {describe, expect, it} from "vitest"

import {turnMetricsSource} from "../../../src/components/TurnMetrics"

describe("turnMetricsSource", () => {
    it("takes a settled turn's figures from its row only", () => {
        const turnRow = {totalTokens: 10, durationMs: 900}
        expect(turnMetricsSource({turnRow, usage: {totalCost: 1}, isStreaming: false})).toBe(
            turnRow,
        )
    })

    it("leaves a settled turn without a stored usage unavailable", () => {
        expect(turnMetricsSource({usage: {totalTokens: 5}, isStreaming: false})).toBeUndefined()
    })

    it("shows the streamed usage while the turn runs", () => {
        const usage = {totalTokens: 5}
        expect(turnMetricsSource({usage, isStreaming: true})).toBe(usage)
    })
})
