import {describe, expect, it} from "vitest"

import {
    normalizeTraceId,
    turnFigures,
    turnsByTraceId,
    turnsMayChange,
} from "../../src/session/core/turnUsage"

describe("turnFigures", () => {
    it("maps usage to display fields and latency from start and end", () => {
        expect(
            turnFigures({
                trace_id: "a",
                start_time: "2026-10-28T10:00:00Z",
                end_time: "2026-10-28T10:00:02.5Z",
                usage: {input_tokens: 7, output_tokens: 3, total_tokens: 10, cost: 0.02},
            }),
        ).toEqual({
            promptTokens: 7,
            completionTokens: 3,
            totalTokens: 10,
            totalCost: 0.02,
            durationMs: 2500,
        })
    })

    it("keeps unknown figures unknown, never zero", () => {
        const figures = turnFigures({
            start_time: "2026-10-28T10:00:00Z",
            end_time: null,
            usage: {total_tokens: 10, cost: null, source: "runner"},
        })
        expect(figures).toEqual({totalTokens: 10})
        expect(figures?.totalCost).toBeUndefined()
        expect(figures?.durationMs).toBeUndefined()
    })

    it("returns undefined for a turn with no usage", () => {
        expect(turnFigures({trace_id: "a", usage: null})).toBeUndefined()
    })
})

describe("turnsByTraceId", () => {
    it("matches a UUID trace id to the hex form a message carries", () => {
        const turn = {trace_id: "0A1B2C3D-0000-4000-8000-00000000000F"}
        const map = turnsByTraceId([turn, {trace_id: null}])
        expect(map.size).toBe(1)
        expect(map.get(normalizeTraceId("0a1b2c3d00004000800000000000000f"))).toBe(turn)
    })
})

describe("turnsMayChange", () => {
    const now = Date.parse("2026-10-28T10:05:00Z")

    it("is true while a turn runs", () => {
        expect(turnsMayChange([{end_time: null}], now)).toBe(true)
    })

    it("is true for a recent turn waiting for its priced usage", () => {
        expect(
            turnsMayChange([{end_time: "2026-10-28T10:04:30Z", usage: {total_tokens: 3}}], now),
        ).toBe(true)
    })

    it("is false once usage is priced or the turn is old", () => {
        expect(
            turnsMayChange([{end_time: "2026-10-28T10:04:30Z", usage: {cost: 0.01}}], now),
        ).toBe(false)
        expect(turnsMayChange([{end_time: "2026-10-28T09:00:00Z"}], now)).toBe(false)
    })
})
