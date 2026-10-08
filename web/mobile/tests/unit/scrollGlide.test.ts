import {describe, expect, it} from "vitest"

import {scrollGlideMs} from "@/lib/motion/presets"
import {omegaFor, springStep} from "@/lib/motion/scrollGlide"

const OMEGA = omegaFor(scrollGlideMs)

/** Steps a glide from `offset` px away at 60fps for `ms`, returning every offset. */
const run = (offset: number, velocity: number, ms: number) => {
    const offsets = [offset]
    for (let t = 0; t < ms; t += 1000 / 60) {
        const next = springStep(offset, velocity, OMEGA, 1 / 60)
        offset = next.offset
        velocity = next.velocity
        offsets.push(offset)
    }
    return offsets
}

describe("scroll glide spring", () => {
    it("settles within the preset duration", () => {
        const offsets = run(1000, 0, scrollGlideMs)
        expect(Math.abs(offsets.at(-1)!)).toBeLessThan(1000 * 0.01)
    })

    it("never overshoots its target", () => {
        expect(run(1000, 0, 2000).every((offset) => offset >= 0)).toBe(true)
        expect(run(-1000, 0, 2000).every((offset) => offset <= 0)).toBe(true)
    })

    it("closes the gap every frame, so a glide never stalls", () => {
        const offsets = run(1000, 0, scrollGlideMs)
        for (let i = 1; i < offsets.length; i++) expect(offsets[i]).toBeLessThan(offsets[i - 1])
    })

    it("is exact for any frame length, so a dropped frame lands where two frames would", () => {
        const one = springStep(800, -300, OMEGA, 2 / 60)
        const half = springStep(800, -300, OMEGA, 1 / 60)
        const two = springStep(half.offset, half.velocity, OMEGA, 1 / 60)
        expect(one.offset).toBeCloseTo(two.offset, 6)
        expect(one.velocity).toBeCloseTo(two.velocity, 6)
    })

    it("keeps its velocity when the target moves away mid-glide (streamed growth)", () => {
        // Halfway through a glide the target moves 300px further; the spring keeps moving forward.
        let state = {offset: 1000, velocity: 0}
        for (let i = 0; i < 6; i++) state = springStep(state.offset, state.velocity, OMEGA, 1 / 60)
        const before = state.velocity
        state = springStep(state.offset + 300, state.velocity, OMEGA, 1 / 60)
        expect(Math.sign(state.velocity)).toBe(Math.sign(before))
        expect(Math.abs(state.velocity)).toBeGreaterThan(Math.abs(before))
    })
})
