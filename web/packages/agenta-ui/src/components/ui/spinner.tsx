import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Spinner — a presentational @agenta/ui port of antd `Spin`'s default indicator (plain
 * spans + cva, no Radix). Reproduces antd v6's rotating 4-dot square: four `currentColor`
 * dots pinned to the corners of a square, the whole group held at 45° (so they read as a
 * diamond) and spun continuously.
 *
 * Geometry mirrors antd's tokens exactly (MEASURED against the app theme, which sets
 * `controlHeight`=28 / `controlHeightLG`=40 / base `fontSize`=12, not antd's stock
 * 32/40/14). Holder box = antd `dot(-holder)-size` (small `controlHeightLG*0.35`=14,
 * default `controlHeightLG/2`=20, large `controlHeight`=28 → `size-3.5/5/7`). Dot =
 * antd `(holderSize - marginXXS/2)/2` (6/9/13px) at `scale(0.75)` + `opacity 0.3`.
 * Colour = antd section `colorPrimary` (`text-colorPrimary`, dots `bg-current`, tip
 * inherits — matching antd's `currentColor`). Layout = antd's standalone
 * `ant-spin-section`: `inline-flex` column, `items-center`, `gap` = `paddingSM` 12px
 * (`gap-3`); tip = `ant-spin-description` `fontSize` 12px / `line-height:1`
 * (`text-xs leading-none`). `box-border` is required (preflight is OFF).
 *
 * Rotation: antd spins the group 45°→405° at 1.2s linear. Tailwind's `animate-spin`
 * (0°→360°, linear) drives a nested rotor while the holder holds the static 45° base, so
 * the composite matches antd; `[animation-duration:1.2s]` matches antd's timing. The VRT
 * freezes the animation — a static (angle-0) match is the contract; residual rotation
 * phase between the two frozen frames is expected animation-phase noise.
 *
 * A11y: antd's Spin sets only `aria-live`/`aria-busy` — this adds `role="status"` +
 * `aria-label` (a small, deliberate a11y win; see Spinner.md).
 *
 * antd → @agenta/ui mapping: `size` (small/default/large) + `tip` map 1:1. The wrap-children
 * mask mode (Spin wrapping content behind a blur) is deferred — see Spinner.md.
 */
const spinnerVariants = cva("relative box-border inline-block rotate-45", {
    variants: {
        // antd holder box = dot-holder-size per size (14/20/28px, app theme).
        size: {
            small: "size-3.5",
            default: "size-5",
            large: "size-7",
        },
    },
    defaultVariants: {size: "default"},
})

export type SpinnerSize = "small" | "default" | "large"

// antd dot item = (holderSize - marginXXS/2)/2 → 6/9/13px. 6 is on the scale (size-1.5);
// 9 and 13 are off it, so arbitrary px (matches antd exactly). See Spinner.md §deviations.
const DOT_SIZE: Record<SpinnerSize, string> = {
    small: "size-1.5",
    default: "size-[9px]",
    large: "size-[13px]",
}

// antd corners: nth1 top-left, nth2 top-right, nth3 bottom-right, nth4 bottom-left.
const DOT_POSITION = ["left-0 top-0", "right-0 top-0", "bottom-0 right-0", "bottom-0 left-0"]

// antd staggers antSpinMove per nth-child so only 1-2 dots are bright at a time.
const DOT_DELAY = [
    "[animation-delay:0s]",
    "[animation-delay:0.4s]",
    "[animation-delay:0.8s]",
    "[animation-delay:1.2s]",
]

export interface SpinnerProps
    extends
        Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
        VariantProps<typeof spinnerVariants> {
    ref?: React.Ref<HTMLSpanElement>
    /** Optional label rendered under the indicator (antd `tip`/`description`). */
    tip?: React.ReactNode
    /** Accessible label announced by screen readers (antd omits this). */
    "aria-label"?: string
}

export function Spinner({
    className,
    size = "default",
    tip,
    "aria-label": ariaLabel = "Loading",
    ...props
}: SpinnerProps) {
    return (
        <span
            data-slot="spinner"
            role="status"
            aria-live="polite"
            aria-busy
            aria-label={ariaLabel}
            className={cn(
                // antd standalone ant-spin-section: inline-flex column, centered, gap paddingSM 12px.
                "box-border inline-flex flex-col items-center gap-3 text-colorPrimary",
                className,
            )}
            {...props}
        >
            <span data-slot="spinner-indicator" className={spinnerVariants({size})}>
                {/* Static 45° base lives on the holder; the rotor adds the continuous spin. */}
                <span
                    data-slot="spinner-rotor"
                    className="absolute inset-0 animate-spin [animation-duration:1.2s]"
                >
                    {DOT_POSITION.map((pos, i) => (
                        <span
                            key={i}
                            data-slot="spinner-dot"
                            className={cn(
                                // antd dot radius is `100%` (not 9999px) — match it exactly.
                                "absolute block scale-75 rounded-[100%] bg-current opacity-30",
                                "animate-spin-move",
                                DOT_SIZE[size ?? "default"],
                                DOT_DELAY[i],
                                pos,
                            )}
                        />
                    ))}
                </span>
            </span>
            {tip != null ? (
                <div data-slot="spinner-tip" className="text-xs leading-none">
                    {tip}
                </div>
            ) : null}
        </span>
    )
}

export {spinnerVariants}
