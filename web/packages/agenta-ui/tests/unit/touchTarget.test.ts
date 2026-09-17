/**
 * The one definition of the 44px touch minimum, and the helper the site tests read it back with.
 *
 * Two things are worth pinning here rather than at each call site. The expansion has to reach 44
 * at BOTH control heights, which is the bug that made this shared: the 8px inset the chat's
 * approval card uses is right for a 28px control and leaves a 24px one at 40. And the helper has
 * to refuse to credit an inset that paints no box, or a site test would pass on a control that
 * lost its `relative` and grew nothing.
 */
import {
    TOUCH_TARGET_MINIMUM_PX,
    touchTargetExpansion,
    touchTargetHeight,
} from "../../src/components/ui/touch-target"
import {describe, expect, it} from "vitest"

describe("touchTargetExpansion", () => {
    it("reaches the minimum from every control height it defines", () => {
        // The whole reason this is keyed by height: one inset cannot serve both. Written against
        // the class that sets each height so the arithmetic is read back, not restated.
        const heightClass = {24: "h-control-xs", 28: "h-control-sm"} as const
        for (const height of [24, 28] as const) {
            const reached = touchTargetHeight(
                `${heightClass[height]} ${touchTargetExpansion(height)}`,
            )
            expect(reached, `height ${height}`).toBe(TOUCH_TARGET_MINIMUM_PX)
        }
    })

    it("reaches the minimum on the raw height steps too", () => {
        // The row-actions kebab is a bare button at `h-6`, not a Button at a scale name.
        expect(touchTargetHeight(`h-6 ${touchTargetExpansion(24)}`)).toBe(TOUCH_TARGET_MINIMUM_PX)
        expect(touchTargetHeight(`h-7 ${touchTargetExpansion(28)}`)).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("changes nothing a reader can see", () => {
        // Every class in the string is either positioning or an empty pseudo-element. A colour, a
        // background or a border here would be a visual change on every table in the product.
        for (const height of [24, 28] as const) {
            expect(touchTargetExpansion(height).split(" ").sort()).toEqual(
                [
                    "relative",
                    "after:absolute",
                    "after:-inset-x-1",
                    height === 24 ? "after:-inset-y-2.5" : "after:-inset-y-2",
                    "after:content-['']",
                ].sort(),
            )
        }
    })
})

describe("touchTargetHeight", () => {
    it("is the control's own height when nothing expands it", () => {
        expect(touchTargetHeight("h-control-xs p-0 text-xs")).toBe(24)
        expect(touchTargetHeight("h-control-sm")).toBe(28)
        expect(touchTargetHeight("h-11")).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("credits no expansion to an inset that paints no box", () => {
        // `after:absolute` without `relative`, and an inset without `after:content`, are both a
        // pseudo-element that never exists. Reporting 44 for either would make a site test lie.
        expect(touchTargetHeight("h-6 after:absolute after:-inset-y-2.5 after:content-['']")).toBe(
            24,
        )
        expect(touchTargetHeight("h-6 relative after:absolute after:-inset-y-2.5")).toBe(24)
    })

    it("has no answer for a control whose height it cannot read", () => {
        expect(touchTargetHeight("p-0 text-xs")).toBeNull()
        expect(touchTargetHeight("")).toBeNull()
    })

    it("takes the widest inset when a call site sets more than one", () => {
        expect(
            touchTargetHeight("h-6 relative after:absolute after:-inset-1 after:content-['']"),
        ).toBe(32)
    })
})
