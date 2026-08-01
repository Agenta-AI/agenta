import * as React from "react"

import {cva} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Divider — a presentational @agenta/ui port of antd `Divider` (no Radix). Reproduces antd's
 * horizontal/vertical rules, the with-text rail-both-sides layout, dashed + plain variants.
 *
 * Line colour = antd `colorSplit` (`border-colorSplit`), text colour = `colorTextHeading`
 * (default) / `colorText` (plain). Margins come from the Tailwind spacing scale mapping
 * antd's measured tokens: horizontal `marginLG` 24px (`my-6`), with-text `margin` 16px
 * (`my-4`), vertical `marginXS` 8px (`mx-2`). `border-0` first is REQUIRED: preflight is off
 * and a global default border-width leaks ~1.5px onto the unset sides, so the line must zero
 * all borders then re-add only the one it draws (`border-t`/`border-l`). `border-solid` sets
 * the style (the `border` utility only sets width).
 */
const dividerVariants = cva("box-border border-0 border-solid border-colorSplit", {
    variants: {
        type: {
            // Full-width 1px line; margin marginLG 24px.
            horizontal: "flex w-full min-w-full my-6 border-t",
            // Inline 1px line, height 0.9em, marginInline marginXS 8px, nudged -0.06em.
            vertical:
                "relative -top-[0.06em] inline-block h-[0.9em] mx-2 my-0 align-middle border-l",
        },
        dashed: {true: "border-dashed", false: ""},
    },
    defaultVariants: {type: "horizontal", dashed: false},
})

// with-text root: rails carry the line, so the root has no border of its own. antd's text
// line-height is 5/3 (1.6667) at every size; Tailwind's text-sm/text-xs bundle a shorter one,
// so `leading-[..]` overrides it (last, after the text-size class — it drives the row height:
// 14px→23.33px, 12px→20px).
const withTextVariants = cva(
    "box-border flex items-center w-full min-w-full my-4 whitespace-nowrap",
    {
        variants: {
            plain: {
                // Default: heading colour, weight 500, fontSizeLG 14px.
                false: "text-colorTextHeading font-medium text-sm leading-[1.6666666666666667]",
                // plain: base text colour, normal weight, fontSize 12px.
                true: "text-colorText font-normal text-xs leading-[1.6666666666666667]",
            },
        },
        defaultVariants: {plain: false},
    },
)

// antd orientationMargin 0.05 → 5%/95% rail split; center is 50/50.
const RAIL_WIDTH = {
    center: ["w-[50%]", "w-[50%]"],
    left: ["w-[5%]", "w-[95%]"],
    right: ["w-[95%]", "w-[5%]"],
} as const

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
    ref?: React.Ref<HTMLDivElement>
    /** Axis (antd calls it `type`). */
    type?: "horizontal" | "vertical"
    /** Text position for the with-text divider. */
    orientation?: "left" | "right" | "center"
    dashed?: boolean
    /** Lighter, normal-weight text (vs the default heading weight). */
    plain?: boolean
}

export function Divider({
    className,
    type = "horizontal",
    orientation = "center",
    dashed = false,
    plain = false,
    children,
    ...props
}: DividerProps) {
    // Horizontal with text: two border-t rails flanking the label (antd's rail layout).
    if (children && type === "horizontal") {
        const [startW, endW] = RAIL_WIDTH[orientation]
        const rail = cn(
            "border-0 border-t border-solid border-colorSplit",
            dashed && "border-dashed",
        )
        return (
            <div
                data-slot="divider"
                role="separator"
                className={cn(withTextVariants({plain}), className)}
                {...props}
            >
                <span className={cn(rail, startW)} />
                <span className="inline-block px-[1em]">{children}</span>
                <span className={cn(rail, endW)} />
            </div>
        )
    }

    // Plain horizontal / vertical line.
    return (
        <div
            data-slot="divider"
            role="separator"
            className={cn(dividerVariants({type, dashed}), className)}
            {...props}
        />
    )
}

export {dividerVariants}
