/**
 * The 44px touch minimum, reached without changing what a control looks like.
 *
 * A control keeps the size the desktop row rhythm gives it and grows an invisible `after` box
 * around itself, so a finger has 44px to land on and a pointer sees exactly the button it saw
 * before. The pattern started in `@agenta/chat`'s ApprovalCard and was named in the mobile app's
 * tool line; this is the one copy of it, so the geometry cannot drift per call site.
 *
 * Three things set the inset, and leaving any of them out leaves a control short:
 *
 * - The rendered size, because the box grows symmetrically. The heights are the shared control
 *   scale's own: `control-xs` is 24px and `control-sm` is 28px.
 * - The axis. A labelled control is already wider than the minimum and asks for its height alone;
 *   an icon button is short on both axes and asks for both.
 * - The control's own border. An absolutely positioned pseudo-element resolves its inset against
 *   the PADDING box, and the shared Button paints a 1px transparent border on every side, so an
 *   inset written for the visible edge starts a pixel inside it and lands 2px short on the axis.
 *   That is D126: six controls were written for 44 and measured 42 in a browser. The border is
 *   charged here rather than at the call sites, and defaults to the Button's own 1px, because
 *   every call site but the two bare buttons is a Button.
 *
 * Every class here is a literal, because neither Tailwind toolchain sees a class name this module
 * builds at runtime.
 */

/** The mobile minimum, in px. */
export const TOUCH_TARGET_MINIMUM_PX = 44

/** Rendered control heights the expansion is defined for, in px. */
export type TouchTargetControlHeight = 24 | 28

/** Rendered control widths the expansion is defined for, in px. */
export type TouchTargetControlWidth = 28 | 30

/** A control's own border, in px: the shared Button's 1, or 0 for a button that zeroes it. */
export type TouchTargetControlBorder = 0 | 1

/** The control the expansion is asked for. */
export interface TouchTargetControlBox {
    height: TouchTargetControlHeight
    /** Given only for a control the minimum also fails on the other axis, which is an icon button. */
    width?: TouchTargetControlWidth
    /** Defaults to the shared Button's 1px. A control with `border-0` has to say so. */
    border?: TouchTargetControlBorder
}

/** One Tailwind spacing step, in px. */
const SPACING_STEP_PX = 4

/** What a labelled control reaches past its visible edge; its own text carries it past 44 wide. */
const LABELLED_REACH_PX = 4

/**
 * Insets by [size][border]. The size class is the BORDER box (`box-border`), the inset is measured
 * from inside the border, so the hit box is `(size - 2 x border) + 2 x inset` and the reach past
 * the edge a reader can see is `inset - border`. Each entry is therefore
 *
 *     inset = (44 - size) / 2 + border
 *
 * Do not add an inset to the size class and call it the hit area. That is the arithmetic that
 * shipped six controls at 42 while every comment and every test said 44 (D126), because the
 * reader repeated the same mistake and so agreed with the class instead of with the browser.
 */
const verticalByHeight: Record<
    TouchTargetControlHeight,
    Record<TouchTargetControlBorder, string>
> = {
    // Reach 10 past the visible edge: 24 + 20 = 44 on a bare control, (24 - 2) + 22 = 44 bordered.
    24: {0: "after:-inset-y-2.5", 1: "after:-inset-y-[11px]"},
    // Reach 8: 28 + 16 = 44 bare, (28 - 2) + 18 = 44 bordered. The bare 8 is the inset ApprovalCard
    // and the mobile tool line already used, and the one that measured 42 on a bordered control.
    28: {0: "after:-inset-y-2", 1: "after:-inset-y-[9px]"},
}

const horizontalByWidth: Record<
    TouchTargetControlWidth,
    Record<TouchTargetControlBorder, string>
> = {
    // Reach 8: 28 + 16 = 44 bare, (28 - 2) + 18 = 44 bordered.
    28: {0: "after:-inset-x-2", 1: "after:-inset-x-[9px]"},
    // Reach 7: 30 + 14 = 44 bare, (30 - 2) + 16 = 44 bordered. No spacing step is 7px, so the
    // arbitrary value is the exact one; the next step up would reach into the neighbouring cell.
    30: {0: "after:-inset-x-[7px]", 1: "after:-inset-x-[8px]"},
}

/** Reach 4 either way, which is `LABELLED_REACH_PX`, not a number sized to arrive at 44. */
const labelledHorizontal: Record<TouchTargetControlBorder, string> = {
    0: "after:-inset-x-1",
    1: "after:-inset-x-[5px]",
}

const SCAFFOLDING_CLASSES = "relative after:absolute after:content-['']"

/**
 * Classes that take a control to the 44px touch minimum, chrome unchanged. Pass the height alone
 * for a labelled Button, or the box for anything that zeroes its border or is short on both axes.
 * The caller keeps its own `relative`-free layout classes; this string brings its own.
 */
export const touchTargetExpansion = (
    control: TouchTargetControlHeight | TouchTargetControlBox,
): string => {
    const box: TouchTargetControlBox = typeof control === "number" ? {height: control} : control
    const border = box.border ?? 1
    const horizontal =
        box.width === undefined ? labelledHorizontal[border] : horizontalByWidth[box.width][border]
    return `${SCAFFOLDING_CLASSES} ${horizontal} ${verticalByHeight[box.height][border]}`
}

/** The hit area a class string yields, in px. `null` on an axis whose size it cannot read. */
export interface TouchTargetHitArea {
    width: number | null
    height: number | null
}

/**
 * Rendered control boxes this module can read back off a class string, so a rendered test asserts
 * the hit area rather than the literal class it was written with. Keyed by the class that sets the
 * dimension: the control scale's names, the raw steps used where a control is not a Button, and
 * the `size-*` pair an icon button sets both axes with.
 */
const controlBoxByClass: Record<string, Partial<TouchTargetHitArea>> = {
    "h-control-xs": {height: 24},
    "h-control-sm": {height: 28},
    "h-control": {height: 32},
    "h-control-lg": {height: 36},
    // An inline toggle has no chrome, so the control scale reaches it as a floor, not a height.
    "min-h-control-xs": {height: 24},
    "h-6": {height: 24},
    "h-7": {height: 28},
    "h-8": {height: 32},
    "h-9": {height: 36},
    "h-11": {height: 44},
    "size-control-xs": {width: 24, height: 24},
    "size-control-sm": {width: 28, height: 28},
    "size-control": {width: 32, height: 32},
    "w-[30px]": {width: 30},
}

/** The scaffolding without which an `after` inset paints no box and so expands no hit area. */
const SCAFFOLDING = SCAFFOLDING_CLASSES.split(" ")

const insetPx = (candidate: string, axis: "x" | "y"): number | null => {
    const match = new RegExp(
        `^after:-inset(?:-${axis})?-(?:\\[(\\d+(?:\\.\\d+)?)px\\]|(\\d+(?:\\.\\d+)?))$`,
    ).exec(candidate)
    if (!match) return null
    // An arbitrary value is already px; a spacing step is steps.
    return match[1] !== undefined ? Number(match[1]) : Number(match[2]) * SPACING_STEP_PX
}

/** The widest inset the string sets on one axis, so a call site setting two is read honestly. */
const insetOnAxis = (classes: string[], axis: "x" | "y"): number =>
    classes.reduce((widest, candidate) => {
        const px = insetPx(candidate, axis)
        return px === null ? widest : Math.max(widest, px)
    }, 0)

/**
 * The border the class string paints, in px, because the inset is measured from inside it. An
 * explicit width (`border-0`, `border-2`) is what a call site writes to override the component's
 * own, so it wins over the bare `border` the Button always carries.
 */
const borderOf = (classes: string[]): number => {
    const explicit = classes.reduce<number | null>((found, candidate) => {
        const match = /^border-(\d+)$/.exec(candidate)
        return match ? Number(match[1]) : found
    }, null)
    if (explicit !== null) return explicit
    return classes.includes("border") ? 1 : 0
}

/**
 * The hit area a class string yields, in px, measured at the control's visible edge. Reads the
 * dimension, the border and the `after` insets from the same string, so changing one without the
 * others is visible to a test.
 */
export const touchTargetHitArea = (className: string): TouchTargetHitArea => {
    const classes = className.split(/\s+/).filter(Boolean)
    const box = classes.reduce<TouchTargetHitArea>(
        (found, candidate) => {
            const named = controlBoxByClass[candidate]
            if (!named) return found
            return {
                width: found.width ?? named.width ?? null,
                height: found.height ?? named.height ?? null,
            }
        },
        {width: null, height: null},
    )
    if (!SCAFFOLDING.every((candidate) => classes.includes(candidate))) return box
    const border = borderOf(classes)
    const grow = (size: number | null, axis: "x" | "y") =>
        size === null ? null : size + Math.max(0, insetOnAxis(classes, axis) - border) * 2
    return {width: grow(box.width, "x"), height: grow(box.height, "y")}
}

/**
 * The vertical hit area a class string yields, in px, or null when it names no height this
 * module knows.
 */
export const touchTargetHeight = (className: string): number | null =>
    touchTargetHitArea(className).height

/**
 * The horizontal hit area a class string yields, in px, or null when it names no width this
 * module knows. A labelled control names none: its width is its text.
 */
export const touchTargetWidth = (className: string): number | null =>
    touchTargetHitArea(className).width

/** What a labelled control reaches past each visible edge horizontally, in px. */
export const TOUCH_TARGET_LABELLED_REACH_PX = LABELLED_REACH_PX
