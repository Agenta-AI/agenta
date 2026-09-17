/**
 * The 44px touch minimum, reached without changing what a control looks like.
 *
 * A control keeps the height the desktop row rhythm gives it and grows an invisible `after`
 * box around itself, so a finger has 44px to land on and a pointer sees exactly the button it
 * saw before. The pattern started in `@agenta/chat`'s ApprovalCard and was named in the mobile
 * app's tool line; this is the one copy of it, so the geometry cannot drift per call site.
 *
 * The inset is chosen per rendered dimension because the box grows symmetrically: 8px a side
 * brings a 28px control to 44 and leaves a 24px one at 40, which is the shortfall the mobile
 * parity audit found. The heights are the shared control scale's own — `control-xs` is 24px and
 * `control-sm` is 28px. A width is given only for a control the minimum also fails on the other
 * axis, which is an icon button: a labelled control's own text carries it past 44 wide.
 *
 * Every class here is a literal, because neither Tailwind toolchain sees a class name this
 * module builds at runtime.
 */

/** The mobile minimum, in px. */
export const TOUCH_TARGET_MINIMUM_PX = 44

/** Rendered control heights the expansion is defined for, in px. */
export type TouchTargetControlHeight = 24 | 28

/** Rendered control widths the expansion is defined for, in px. */
export type TouchTargetControlWidth = 28 | 30

/** A control the expansion is asked for, when the minimum fails it on both axes. */
export interface TouchTargetControlBox {
    height: TouchTargetControlHeight
    width: TouchTargetControlWidth
}

/** One Tailwind spacing step, in px. */
const SPACING_STEP_PX = 4

const verticalByHeight: Record<TouchTargetControlHeight, string> = {
    // 10px a side: 24 + 20 = 44.
    24: "after:-inset-y-2.5",
    // 8px a side: 28 + 16 = 44. The inset ApprovalCard and the tool line already use.
    28: "after:-inset-y-2",
}

/** A labelled control is wider than the minimum already; this keeps a finger off its edge. */
const DEFAULT_HORIZONTAL = "after:-inset-x-1"

const horizontalByWidth: Record<TouchTargetControlWidth, string> = {
    // 8px a side: 28 + 16 = 44.
    28: "after:-inset-x-2",
    // 7px a side: 30 + 14 = 44. No spacing step is 7px, so the arbitrary value is the exact one;
    // the next step up would overshoot into the neighbouring cell's own control.
    30: "after:-inset-x-[7px]",
}

const SCAFFOLDING_CLASSES = "relative after:absolute after:content-['']"

/**
 * Classes that take a control to the 44px touch minimum, chrome unchanged. Pass the height alone
 * for a labelled control, or both dimensions for an icon button. The caller keeps its own
 * `relative`-free layout classes; this string brings its own.
 */
export const touchTargetExpansion = (
    control: TouchTargetControlHeight | TouchTargetControlBox,
): string => {
    const height = typeof control === "number" ? control : control.height
    const horizontal =
        typeof control === "number" ? DEFAULT_HORIZONTAL : horizontalByWidth[control.width]
    return `${SCAFFOLDING_CLASSES} ${horizontal} ${verticalByHeight[height]}`
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

/** The hit area a class string yields, in px. `null` on an axis whose size it cannot read. */
export interface TouchTargetHitArea {
    width: number | null
    height: number | null
}

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
 * The hit area a class string yields, in px. Reads the dimension classes and the `after` insets
 * from the same string, so changing one without the other is visible to a test.
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
    const grow = (size: number | null, axis: "x" | "y") =>
        size === null ? null : size + insetOnAxis(classes, axis) * 2
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
