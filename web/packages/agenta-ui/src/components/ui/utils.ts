import {clsx, type ClassValue} from "clsx"
import {extendTailwindMerge} from "tailwind-merge"

/**
 * The one className combiner (`@agenta/ui/styles` and the `@agenta/ui` root re-export it).
 *
 * Uses tailwind-merge so a consumer's `className` override deterministically wins over
 * a component's own utilities (conflicting Tailwind classes are deduped, last kept).
 *
 * The custom class groups below are NOT optional. tailwind-merge only dedupes classes it
 * can classify, and every one of our `controlScale` keys (tailwind.config.ts) is a bare
 * word — `px-btn`, `h-control`, `rounded-control` — not a number or arbitrary value. An
 * unregistered key is treated as an unknown class and simply kept, so BOTH classes reach
 * the DOM and stylesheet order silently picks the winner instead of the caller.
 *
 * Two ways that bites, both invisible to type-checking:
 *  - `text-*` is shared between font-size and text-colour utilities. Unregistered, our
 *    type ramps get classified as COLOURS and drop the component's `text-foreground`,
 *    rendering every control in UA-default black. (This one already happened.)
 *  - Geometry overrides silently no-op. `<Button className="px-2">` emitted
 *    `px-btn px-2`, and `px-btn` (15px) won on stylesheet order — so a ghost dropdown
 *    trigger rendered 14px wider than the antd original it replaced.
 *
 * Any new `controlScale` entry must be mirrored here, in the group matching its utility.
 */
const CONTROL_BOX = ["control-xs", "control-sm", "control", "control-lg"]
// controlScale.height / .width — control heights plus the switch + checkbox/radio dims.
const CONTROL_DIMS = [
    ...CONTROL_BOX,
    "avatar-sm",
    "avatar",
    "avatar-lg",
    // In-button glyph sizes.
    "btn-icon-xs",
    "btn-icon-sm",
    "btn-icon",
    "switch",
    "switch-sm",
    "switch-thumb",
    "switch-thumb-sm",
    "control-check",
    "control-dot",
    "control-check-dash",
]
// controlScale.spacing — the button and input horizontal/vertical padding families.
const CONTROL_PAD = [
    "btn-xs",
    "btn-sm",
    "btn",
    "btn-lg",
    "btn-icon-pad-sm",
    "btn-icon-pad",
    "input-sm",
    "input",
    "input-lg",
    "input-y-sm",
    "input-y",
    "input-y-lg",
    "input-y-ghost-sm",
    "input-y-ghost",
    "input-y-ghost-lg",
]

// Design-system text styles (src/design/theme.config.ts); sizes, not colours.
const TEXT_STYLES = [
    "display",
    "heading",
    "title",
    "subtitle",
    "metric",
    "body",
    "body-sm",
    "label",
    "touch",
    "meta",
    "caption",
    "code",
    "code-sm",
]

const twMerge = extendTailwindMerge({
    extend: {
        classGroups: {
            "font-size": [
                {
                    text: [
                        "btn-xs",
                        "btn-sm",
                        "btn-md",
                        "btn-lg",
                        "field-sm",
                        "field-md",
                        "field-lg",
                        "badge-md",
                        ...TEXT_STYLES,
                    ],
                },
            ],
            p: [{p: CONTROL_PAD}],
            px: [{px: CONTROL_PAD}],
            py: [{py: CONTROL_PAD}],
            pl: [{pl: CONTROL_PAD}],
            pr: [{pr: CONTROL_PAD}],
            gap: [{gap: ["btn-gap-sm", "btn-gap"]}],
            h: [{h: CONTROL_DIMS}],
            "min-h": [{"min-h": CONTROL_DIMS}],
            w: [{w: CONTROL_DIMS}],
            size: [{size: CONTROL_DIMS}],
            rounded: [{rounded: [...CONTROL_BOX, "control-round", "control-check"]}],
        },
    },
})

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}
