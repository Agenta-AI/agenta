/**
 * hitRatioMeter — unit tests for the v1→v2 escalation signal.
 *
 * The meter has three observable states and a small policy surface
 * (rolling window + threshold). These tests lock in the regime transitions
 * and the edge cases that would otherwise drift silently.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {createHitRatioMeter} from "../hitRatioMeter"

// =============================================================================
// State machine — warming → client → escalate
// =============================================================================

describe("hitRatioMeter — state transitions", () => {
    it("starts in `warming` with no observations", () => {
        const meter = createHitRatioMeter()
        const r = meter.regime()
        assert.equal(r.state, "warming")
        assert.equal(r.rollingRatio, null)
        assert.equal(r.chunksObserved, 0)
    })

    it("stays `warming` until windowSize chunks observed (default 3)", () => {
        const meter = createHitRatioMeter()
        meter.record({chunk: 1, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "warming")
        meter.record({chunk: 2, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "warming")
        meter.record({chunk: 3, scanned: 50, matched: 0})
        // Now has 3 chunks → transitions out of warming
        assert.notEqual(meter.regime().state, "warming")
    })

    it("recommends `client` when rolling ratio >= threshold", () => {
        const meter = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        meter.record({chunk: 1, scanned: 50, matched: 45}) // 90%
        meter.record({chunk: 2, scanned: 50, matched: 40}) // 80%
        meter.record({chunk: 3, scanned: 50, matched: 42}) // 84%
        const r = meter.regime()
        assert.equal(r.state, "client")
        assert.ok(r.rollingRatio !== null && r.rollingRatio > 0.8)
    })

    it("recommends `escalate` when rolling ratio < threshold", () => {
        const meter = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        meter.record({chunk: 1, scanned: 50, matched: 1}) // 2%
        meter.record({chunk: 2, scanned: 50, matched: 2}) // 4%
        meter.record({chunk: 3, scanned: 50, matched: 1}) // 2%
        const r = meter.regime()
        assert.equal(r.state, "escalate")
        assert.ok(r.rollingRatio !== null && r.rollingRatio < 0.1)
        assert.match(r.reason, /recommend v2 server-side filter/)
    })

    it("oscillates between client and escalate as the rolling window slides", () => {
        const meter = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        meter.record({chunk: 1, scanned: 50, matched: 50}) // 100%
        meter.record({chunk: 2, scanned: 50, matched: 50}) // 100%
        meter.record({chunk: 3, scanned: 50, matched: 50}) // 100%
        assert.equal(meter.regime().state, "client")
        // Slide window: window=[c2,c3,c4] = 100,100,0 → still 67%, client
        meter.record({chunk: 4, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "client")
        // Slide: [c3,c4,c5] = 100,0,0 → 33%, still client (above 10%)
        meter.record({chunk: 5, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "client")
        // Slide: [c4,c5,c6] = 0,0,0 → 0%, escalate
        meter.record({chunk: 6, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "escalate")
        // Slide back up: [c5,c6,c7] = 0,0,50 → 33%, back to client
        meter.record({chunk: 7, scanned: 50, matched: 50})
        assert.equal(meter.regime().state, "client")
    })
})

// =============================================================================
// Edge cases
// =============================================================================

describe("hitRatioMeter — edge cases", () => {
    it("zero-scanned chunks count as observed but contribute 0 to ratio", () => {
        const meter = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        meter.record({chunk: 1, scanned: 0, matched: 0})
        meter.record({chunk: 2, scanned: 50, matched: 25})
        meter.record({chunk: 3, scanned: 50, matched: 25})
        const r = meter.regime()
        // total scanned across window: 100, total matched: 50 → 50%
        assert.equal(r.rollingRatio, 0.5)
        assert.equal(r.state, "client")
    })

    it("dedups repeated chunk indices — caller can replay without distortion", () => {
        const meter = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        meter.record({chunk: 1, scanned: 50, matched: 45})
        meter.record({chunk: 1, scanned: 50, matched: 45}) // duplicate
        meter.record({chunk: 1, scanned: 50, matched: 45}) // duplicate
        meter.record({chunk: 2, scanned: 50, matched: 45})
        meter.record({chunk: 3, scanned: 50, matched: 45})
        const r = meter.regime()
        assert.equal(r.chunksObserved, 3, "duplicates ignored")
    })

    it("reset() drops all observations and returns to warming", () => {
        const meter = createHitRatioMeter()
        for (let i = 1; i <= 5; i++) meter.record({chunk: i, scanned: 50, matched: 50})
        assert.notEqual(meter.regime().state, "warming")
        meter.reset()
        assert.equal(meter.regime().state, "warming")
        assert.equal(meter.regime().chunksObserved, 0)
    })

    it("windows() returns observations in chunk-arrival order", () => {
        const meter = createHitRatioMeter()
        meter.record({chunk: 1, scanned: 50, matched: 10})
        meter.record({chunk: 2, scanned: 50, matched: 20})
        meter.record({chunk: 3, scanned: 50, matched: 30})
        const ws = meter.windows()
        assert.equal(ws.length, 3)
        assert.equal(ws[0].chunk, 1)
        assert.equal(ws[0].ratio, 0.2)
        assert.equal(ws[2].chunk, 3)
        assert.equal(ws[2].ratio, 0.6)
    })

    it("rejects invalid windowSize", () => {
        assert.throws(() => createHitRatioMeter({windowSize: 0}), /windowSize must be >= 1/)
    })

    it("rejects threshold outside [0, 1]", () => {
        assert.throws(() => createHitRatioMeter({threshold: -0.1}), /threshold must be/)
        assert.throws(() => createHitRatioMeter({threshold: 1.1}), /threshold must be/)
    })

    it("custom windowSize affects when regime is decidable", () => {
        const meter = createHitRatioMeter({windowSize: 5, threshold: 0.1})
        for (let i = 1; i <= 4; i++) meter.record({chunk: i, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "warming")
        meter.record({chunk: 5, scanned: 50, matched: 0})
        assert.equal(meter.regime().state, "escalate")
    })

    it("custom threshold drives the same windows to different regimes", () => {
        const high = createHitRatioMeter({windowSize: 3, threshold: 0.5})
        const low = createHitRatioMeter({windowSize: 3, threshold: 0.1})
        for (let i = 1; i <= 3; i++) {
            high.record({chunk: i, scanned: 50, matched: 15}) // 30%
            low.record({chunk: i, scanned: 50, matched: 15})
        }
        // High threshold (50%): 30% < 50% → escalate
        assert.equal(high.regime().state, "escalate")
        // Low threshold (10%): 30% >= 10% → client
        assert.equal(low.regime().state, "client")
    })
})
