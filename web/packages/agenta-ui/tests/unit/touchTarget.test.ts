/**
 * The one definition of the 44px touch minimum, and the helper the site tests read it back with.
 *
 * Three things are worth pinning here rather than at each call site. The expansion has to reach 44
 * on BOTH axes and at every control size, which is the bug that made this shared: the 8px inset
 * the chat's approval card uses is right for a 28px control and leaves a 24px one at 40, and a
 * height-only expansion leaves an icon button 38px wide. The helper has to refuse to credit an
 * inset that paints no box, or a site test would pass on a control that lost its `relative` and
 * grew nothing. And an inset on one axis must not be read on the other.
 */
import {
    TOUCH_TARGET_MINIMUM_PX,
    touchTargetExpansion,
    touchTargetHeight,
    touchTargetHitArea,
    touchTargetWidth,
    type TouchTargetControlBox,
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

    it("reaches the minimum on both axes for an icon button", () => {
        // A control narrower than the minimum is short on the other axis too. The class that sets
        // each dimension is written out so the arithmetic is read back, not restated: the
        // registry's kebab is a bare 30x24 button, the drawer's close a 28px square Button.
        const boxes: {box: TouchTargetControlBox; sizeClasses: string}[] = [
            {box: {height: 24, width: 30}, sizeClasses: "h-6 w-[30px]"},
            {box: {height: 28, width: 28}, sizeClasses: "size-control-sm"},
        ]
        for (const {box, sizeClasses} of boxes) {
            const reached = touchTargetHitArea(`${sizeClasses} ${touchTargetExpansion(box)}`)
            expect(reached, `${box.width}x${box.height}`).toEqual({
                width: TOUCH_TARGET_MINIMUM_PX,
                height: TOUCH_TARGET_MINIMUM_PX,
            })
        }
    })

    it("leaves a labelled control's width to its label", () => {
        // Asking for the height alone is the labelled case: "Show more", "Add", "Reconnect". The
        // horizontal inset there keeps a finger off the edge and is not sized to reach 44.
        expect(touchTargetWidth(`h-control-sm ${touchTargetExpansion(28)}`)).toBeNull()
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
        for (const box of [{height: 24, width: 30}, {height: 28, width: 28}] as const) {
            expect(touchTargetExpansion(box).split(" ").sort()).toEqual(
                [
                    "relative",
                    "after:absolute",
                    box.width === 30 ? "after:-inset-x-[7px]" : "after:-inset-x-2",
                    box.height === 24 ? "after:-inset-y-2.5" : "after:-inset-y-2",
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

describe("touchTargetHitArea", () => {
    it("reads both axes off the pair class an icon button sets them with", () => {
        expect(touchTargetHitArea("size-control-sm p-0")).toEqual({width: 28, height: 28})
    })

    it("reads a width the call site had to write as an arbitrary value", () => {
        // The kebab's 30px is not a spacing step, at the control or at the inset.
        expect(touchTargetHitArea("h-6 w-[30px]")).toEqual({width: 30, height: 24})
    })

    it("takes an inline toggle's control-scale floor as its height", () => {
        // "Show more" has no chrome, so the scale reaches it as `min-h`, not `h`. Reading only
        // `h-*` would have reported no height and let the toggle's own test pass on null.
        expect(touchTargetHeight("mt-1 inline-flex min-h-control-xs w-fit p-0")).toBe(24)
    })

    it("keeps each axis to its own inset", () => {
        // `-inset-x-2` on a control expanded for width only must not be credited with 16px of
        // height, which would report 44 for a control a finger still misses vertically.
        const widthOnly = "size-control-sm relative after:absolute after:-inset-x-2 after:content-['']"
        expect(touchTargetHitArea(widthOnly)).toEqual({width: 44, height: 28})
        const heightOnly = "size-control-sm relative after:absolute after:-inset-y-2 after:content-['']"
        expect(touchTargetHitArea(heightOnly)).toEqual({width: 28, height: 44})
    })

    it("credits an all-sides inset to both axes", () => {
        expect(
            touchTargetHitArea("size-control-sm relative after:absolute after:-inset-2 after:content-['']"),
        ).toEqual({width: 44, height: 44})
    })

    it("has no answer for an axis whose size it cannot read", () => {
        expect(touchTargetHitArea("h-control-sm")).toEqual({width: null, height: 28})
        expect(touchTargetHitArea("p-0 text-xs")).toEqual({width: null, height: null})
    })
})
