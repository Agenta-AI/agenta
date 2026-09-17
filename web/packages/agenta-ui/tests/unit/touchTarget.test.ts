/**
 * The one definition of the 44px touch minimum, and the helper the site tests read it back with.
 *
 * What is worth pinning here rather than at each call site is the arithmetic, because every way it
 * has gone wrong so far has gone wrong quietly. One inset cannot serve both control heights: the
 * 8px the chat's approval card uses is right for 28 and leaves 24 at 40. A height-only expansion
 * leaves an icon button 38px wide. And the inset resolves against the PADDING box, so a control
 * with a border reaches a pixel less on every side than the number says: that is D126, where six
 * controls written for 44 measured 42 in a browser. Each of the three is a case below.
 *
 * The reader has to refuse an inset that paints no box, keep each axis to its own inset, and
 * charge the same border, or a site test passes on a control a finger still misses.
 */
import {
    TOUCH_TARGET_LABELLED_REACH_PX,
    TOUCH_TARGET_MINIMUM_PX,
    touchTargetExpansion,
    touchTargetHeight,
    touchTargetHitArea,
    touchTargetWidth,
    type TouchTargetControlBorder,
    type TouchTargetControlBox,
} from "../../src/components/ui/touch-target"
import {describe, expect, it} from "vitest"

/** The class that sets each height, so a case reads the arithmetic back instead of restating it. */
const heightClass = {24: "h-control-xs", 28: "h-control-sm"} as const
/** What a control writes to carry, or to zero, the shared Button's 1px border. */
const borderClass: Record<TouchTargetControlBorder, string> = {0: "border-0", 1: "border"}

describe("touchTargetExpansion", () => {
    it("reaches the minimum from every control height, bordered or not", () => {
        for (const height of [24, 28] as const) {
            for (const border of [0, 1] as const) {
                const reached = touchTargetHeight(
                    `${heightClass[height]} ${borderClass[border]} ${touchTargetExpansion({height, border})}`,
                )
                expect(reached, `height ${height} border ${border}`).toBe(TOUCH_TARGET_MINIMUM_PX)
            }
        }
    })

    it("takes the Button's own border when a call site does not say", () => {
        // Every call site but the two bare buttons is a Button, so the default is its 1px. A
        // helper that defaulted to 0 would leave each of them at 42, which is the D126 defect.
        expect(touchTargetExpansion(28)).toBe(touchTargetExpansion({height: 28, border: 1}))
        expect(touchTargetExpansion(24)).toBe(touchTargetExpansion({height: 24, border: 1}))
    })

    it("reaches the minimum on the raw height steps too", () => {
        // The row-actions kebab is a bare button at `h-6`, not a Button at a scale name.
        expect(touchTargetHeight(`h-6 border-0 ${touchTargetExpansion({height: 24, border: 0})}`)).toBe(
            TOUCH_TARGET_MINIMUM_PX,
        )
        expect(touchTargetHeight(`h-7 border ${touchTargetExpansion(28)}`)).toBe(
            TOUCH_TARGET_MINIMUM_PX,
        )
    })

    it("reaches the minimum on both axes for an icon button", () => {
        // A control narrower than the minimum is short on the other axis too. The registry's kebab
        // is a bare 30x24 button, the drawer's close a bordered 28px square Button.
        const boxes: {box: TouchTargetControlBox; sizeClasses: string}[] = [
            {box: {height: 24, width: 30, border: 0}, sizeClasses: "h-6 w-[30px] border-0"},
            {box: {height: 28, width: 28}, sizeClasses: "size-control-sm border"},
        ]
        for (const {box, sizeClasses} of boxes) {
            const reached = touchTargetHitArea(`${sizeClasses} ${touchTargetExpansion(box)}`)
            expect(reached, `${box.width}x${box.height} border ${box.border ?? 1}`).toEqual({
                width: TOUCH_TARGET_MINIMUM_PX,
                height: TOUCH_TARGET_MINIMUM_PX,
            })
        }
    })

    it("leaves a labelled control's width to its label", () => {
        // Asking for the height alone is the labelled case: "Show more", "Add", "Reconnect". The
        // horizontal inset there keeps a finger off the edge and is not sized to reach 44, but it
        // still charges the border, so the reach past the visible edge is the same either way.
        expect(touchTargetWidth(`h-control-sm border ${touchTargetExpansion(28)}`)).toBeNull()
        for (const border of [0, 1] as const) {
            const reached = touchTargetHitArea(
                `w-[30px] ${borderClass[border]} ${touchTargetExpansion({height: 28, border})}`,
            )
            expect(reached.width, `border ${border}`).toBe(30 + TOUCH_TARGET_LABELLED_REACH_PX * 2)
        }
    })

    it("changes nothing a reader can see", () => {
        // Every class in the string is either positioning or an empty pseudo-element. A colour, a
        // background or a border here would be a visual change on every table in the product.
        const boxes: TouchTargetControlBox[] = [
            {height: 24, border: 0},
            {height: 24, border: 1},
            {height: 28, border: 0},
            {height: 28, border: 1},
            {height: 24, width: 30, border: 0},
            {height: 28, width: 28, border: 1},
        ]
        for (const box of boxes) {
            for (const candidate of touchTargetExpansion(box).split(" ")) {
                expect(candidate, JSON.stringify(box)).toMatch(
                    /^(relative|after:absolute|after:content-\[''\]|after:-inset-[xy]-[\d.]+|after:-inset-[xy]-\[\d+px\])$/,
                )
            }
        }
    })
})

describe("touchTargetHitArea", () => {
    it("charges the border the inset is measured from inside of", () => {
        // The pseudo-element's containing block is the padding box. Reporting 44 for a bordered
        // control on an 8px inset is exactly the lie that let six controls ship at 42.
        const bordered = "size-control-sm border relative after:absolute after:-inset-2 after:content-['']"
        expect(touchTargetHitArea(bordered)).toEqual({width: 42, height: 42})
        const bare = "size-control-sm border-0 relative after:absolute after:-inset-2 after:content-['']"
        expect(touchTargetHitArea(bare)).toEqual({width: 44, height: 44})
    })

    it("lets an explicit border width win over the Button's bare border", () => {
        // A call site that writes `border-0` is overriding the component's own, and the two
        // classes travel together on a Button that zeroes its border. Reading the bare `border`
        // there would charge a pixel the control does not paint and report 42 for a 44 box.
        const zeroed =
            "size-control-sm border border-0 relative after:absolute after:-inset-2 after:content-['']"
        expect(touchTargetHitArea(zeroed)).toEqual({width: 44, height: 44})
    })

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
        const widthOnly = "size-control-sm border-0 relative after:absolute after:-inset-x-2 after:content-['']"
        expect(touchTargetHitArea(widthOnly)).toEqual({width: 44, height: 28})
        const heightOnly = "size-control-sm border-0 relative after:absolute after:-inset-y-2 after:content-['']"
        expect(touchTargetHitArea(heightOnly)).toEqual({width: 28, height: 44})
    })

    it("is the control's own size when nothing expands it", () => {
        expect(touchTargetHeight("h-control-xs p-0 text-xs")).toBe(24)
        expect(touchTargetHeight("h-control-sm")).toBe(28)
        expect(touchTargetHeight("h-11")).toBe(TOUCH_TARGET_MINIMUM_PX)
    })

    it("credits no expansion to an inset that paints no box", () => {
        // `after:absolute` without `relative`, and an inset without `after:content`, are both a
        // pseudo-element that never exists. Reporting 44 for either would make a site test lie.
        expect(
            touchTargetHeight("h-6 border-0 after:absolute after:-inset-y-2.5 after:content-['']"),
        ).toBe(24)
        expect(touchTargetHeight("h-6 border-0 relative after:absolute after:-inset-y-2.5")).toBe(24)
    })

    it("has no answer for an axis whose size it cannot read", () => {
        expect(touchTargetHitArea("h-control-sm")).toEqual({width: null, height: 28})
        expect(touchTargetHitArea("p-0 text-xs")).toEqual({width: null, height: null})
    })

    it("takes the widest inset when a call site sets more than one", () => {
        expect(
            touchTargetHeight("h-6 border-0 relative after:absolute after:-inset-1 after:content-['']"),
        ).toBe(32)
    })
})
