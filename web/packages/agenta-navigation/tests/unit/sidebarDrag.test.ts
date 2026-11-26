import {describe, expect, it} from "vitest"

import {resolveSidebarDragIntent, stepSpring} from "../../src/sidebarDrag"

describe("resolveSidebarDragIntent", () => {
    it("tracks the pointer inside the resize range", () => {
        expect(resolveSidebarDragIntent(260, false)).toEqual({kind: "resize", width: 260})
    })

    it("resists past the minimum instead of stopping dead", () => {
        expect(resolveSidebarDragIntent(180, false)).toEqual({kind: "resize", width: 196})
    })

    it("resists past the maximum", () => {
        expect(resolveSidebarDragIntent(440, false)).toEqual({kind: "resize", width: 360})
    })

    it("collapses once the pointer goes under 160px", () => {
        expect(resolveSidebarDragIntent(160, false)).toEqual({kind: "resize", width: 192})
        expect(resolveSidebarDragIntent(158, false)).toEqual({kind: "collapse", width: 70})
    })

    it("needs the pointer back past 176px to expand again", () => {
        expect(resolveSidebarDragIntent(168, true)).toEqual({kind: "collapse", width: 72})
        expect(resolveSidebarDragIntent(176, true)).toEqual({kind: "resize", width: 195.2})
    })
})

describe("resolveSidebarDragIntent from the icon rail", () => {
    it("leans the icon rail after a pointer that has not opened it yet", () => {
        expect(resolveSidebarDragIntent(48, true)).toEqual({kind: "collapse", width: 48})
        expect(resolveSidebarDragIntent(98, true)).toEqual({kind: "collapse", width: 58})
    })

    it("stays at 48px for a pointer left of the rail", () => {
        expect(resolveSidebarDragIntent(10, true)).toEqual({kind: "collapse", width: 48})
    })

    it("opens to the pointer once it passes 176px", () => {
        expect(resolveSidebarDragIntent(240, true)).toEqual({kind: "resize", width: 240})
    })
})

describe("stepSpring", () => {
    it("lands on the target without overshooting", () => {
        let state = {position: 192, velocity: 0}
        const positions: number[] = []
        for (let frame = 0; frame < 60; frame++) {
            state = stepSpring(state, 48, 16, 0.02)
            positions.push(state.position)
        }
        expect(Math.min(...positions)).toBe(48)
        expect(positions.at(-1)).toBe(48)
        expect(state.velocity).toBe(0)
    })

    it("never passes the target when the handed velocity points at it", () => {
        const glide = (from: number, velocity: number, target: number) => {
            let state = {position: from, velocity}
            const positions: number[] = []
            for (let frame = 0; frame < 60; frame++) {
                state = stepSpring(state, target, 16, 0.02)
                positions.push(state.position)
            }
            return positions
        }
        expect(Math.min(...glide(70, -1.5, 48))).toBe(48)
        expect(Math.max(...glide(196, 1.5, 200))).toBe(200)
    })

    it("lands in the same place however the frames are sliced", () => {
        let fine = {position: 192, velocity: -0.5}
        for (let frame = 0; frame < 10; frame++) fine = stepSpring(fine, 48, 10, 0.02)
        const coarse = stepSpring({position: 192, velocity: -0.5}, 48, 100, 0.02)
        expect(fine.position).toBeCloseTo(coarse.position, 6)
    })

    it("jumps straight to the target when motion is off", () => {
        expect(stepSpring({position: 192, velocity: -1}, 48, 16, 0)).toEqual({
            position: 48,
            velocity: 0,
        })
    })
})
