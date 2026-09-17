/**
 * The 44px touch minimum, reached without changing what a control looks like.
 *
 * A control keeps the height the desktop row rhythm gives it and grows an invisible `after`
 * box around itself, so a finger has 44px to land on and a pointer sees exactly the button it
 * saw before. The pattern started in `@agenta/chat`'s ApprovalCard and was named in the mobile
 * app's tool line; this is the one copy of it, so the geometry cannot drift per call site.
 *
 * The vertical inset is chosen per control height because the box grows symmetrically: 8px a
 * side brings a 28px control to 44 and leaves a 24px one at 40, which is the shortfall the
 * mobile parity audit found. The heights are the shared control scale's own — `control-xs` is
 * 24px and `control-sm` is 28px.
 */

/** The mobile minimum, in px. */
export const TOUCH_TARGET_MINIMUM_PX = 44

/** Rendered control heights the expansion is defined for, in px. */
export type TouchTargetControlHeight = 24 | 28

/** One Tailwind spacing step, in px. */
const SPACING_STEP_PX = 4

const expansionByHeight: Record<TouchTargetControlHeight, string> = {
    // 10px a side: 24 + 20 = 44.
    24: "relative after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']",
    // 8px a side: 28 + 16 = 44. The inset ApprovalCard and the tool line already use.
    28: "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']",
}

/**
 * Classes that take a control of `controlHeight` to the 44px touch minimum, chrome unchanged.
 * The caller keeps its own `relative`-free layout classes; this string brings its own.
 */
export const touchTargetExpansion = (controlHeight: TouchTargetControlHeight): string =>
    expansionByHeight[controlHeight]

/**
 * Control heights this module can read back off a class string, so a rendered test asserts the
 * hit area rather than the literal class it was written with. Keyed by the class that sets the
 * height: the control scale's names, and the raw `h-*` steps used where a control is not a Button.
 */
const controlHeightByClass: Record<string, number> = {
    "h-control-xs": 24,
    "h-control-sm": 28,
    "h-control": 32,
    "h-control-lg": 36,
    "h-6": 24,
    "h-7": 28,
    "h-8": 32,
    "h-9": 36,
    "h-11": 44,
}

/** The scaffolding without which an `after` inset paints no box and so expands no hit area. */
const SCAFFOLDING = ["relative", "after:absolute", "after:content-['']"]

/**
 * The vertical hit area a class string yields, in px, or null when it names no height this
 * module knows. Reads the height class and the `after` inset from the same string, so changing
 * one without the other is visible to a test.
 */
export const touchTargetHeight = (className: string): number | null => {
    const classes = className.split(/\s+/).filter(Boolean)
    const height = classes.reduce<number | null>(
        (found, candidate) => found ?? controlHeightByClass[candidate] ?? null,
        null,
    )
    if (height === null) return null
    if (!SCAFFOLDING.every((candidate) => classes.includes(candidate))) return height

    const inset = classes.reduce((widest, candidate) => {
        const match = /^after:-inset(?:-y)?-(\d+(?:\.\d+)?)$/.exec(candidate)
        return match ? Math.max(widest, Number(match[1]) * SPACING_STEP_PX) : widest
    }, 0)
    return height + inset * 2
}
