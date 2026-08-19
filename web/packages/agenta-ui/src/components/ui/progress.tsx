import * as React from "react"

import {CheckCircleFilled, CheckOutlined, CloseCircleFilled, CloseOutlined} from "@ant-design/icons"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Progress — a presentational @agenta/ui port of antd `Progress` LINE variant (plain divs +
 * cva, no Radix). Reproduces antd v6's rail + filled track + trailing info, colour-per-status.
 *
 * Structure mirrors antd's DOM/tokens (verified against v6.3.7 source + the app theme):
 * - root `.ant-progress` → `inline-flex`, `role="progressbar"` + aria-valuenow/min/max.
 * - body → `inline-flex items-center w-full`, gap `marginXS` 8px (`gap-2`).
 * - track (antd's `-rail`) → `bg-fill-secondary` (`remainingColor` = colorFillSecondary),
 *   `overflow-hidden`, radius `lineBorderRadius` 100 (`rounded-full`), height 8px default /
 *   6px small (antd `size === 'small' ? 6 : 8` → `h-2` / `h-1.5`).
 * - bar (antd's `-track`) → absolute, inset-y-0 left-0, radius inherit, width = `percent%`
 *   (inline style, content-driven like antd). Colour = antd `defaultColor` = **colorInfo**
 *   (NOT colorPrimary — the two diverge in dark: info blue vs primary yellow); success =
 *   colorSuccess, exception = colorError. `transition-[width]` at `motionDurationSlow` 0.3s
 *   with antd's `motionEaseInOutCirc` — a CSS transition, not a keyframe.
 * - text (antd's `-indicator`) → `colorText` normal / colorSuccess / colorError, `fontSize`
 *   14px default / 12px small (`text-sm` / `text-[12px]`), `line-height:1` (`leading-none`). At
 *   status success/exception antd swaps the `{percent}%` label for antd's own filled glyphs
 *   `CheckCircleFilled` / `CloseCircleFilled` (@ant-design/icons — exact glyph parity; their
 *   `1em` svg + shared `.anticon` box make both the icon AND the info-area height match antd,
 *   which keeps the bar vertically aligned). Size comes from the span font (1em = 12/10px).
 *
 * antd auto-promotes an unset status to `success` at percent >= 100 (matches antd). `box-border`
 * is required (preflight is OFF app-wide). `strokeColor`/`trailColor` override the bar/track
 * fill via inline style, exactly as antd applies them.
 *
 * CIRCLE (`type="circle"`) mirrors antd's `Circle` + `@rc-component/progress` Circle (v1.0.2),
 * verified against that source rather than the token literals:
 * - root stays `inline-flex`; the body is a `size × size` square (antd's `size` IS the circle
 *   DIAMETER: 120 default, 60 for `"small"`, or any number) with `font-size: size*0.15 + 6`.
 * - `strokeWidth` is a PERCENT of the diameter (antd default `max(3/size*100, 6)` — the 3px
 *   `CIRCLE_MIN_STROKE_WIDTH` floor, which is why a 20px ring defaults to 15, not 6).
 * - the svg is a `0 0 100 100` viewBox, so radius = `(100 - strokeWidth) / 2`, the dash cycle is
 *   the perimeter `2πr`, and `strokeDashoffset = (100 - percent)/100 * perimeter` (+ `strokeWidth/2`
 *   below 100% — antd's round-linecap accuracy fix, clamped to `perimeter - 0.01`). Both circles
 *   are `rotate(-90deg)` about `50px 50px` so 0% starts at 12 o'clock, `strokeLinecap="round"`.
 * - colours reuse the LINE tokens (antd uses the same ones): rail = `remainingColor`
 *   (colorFillSecondary), stroke = `defaultColor` (colorInfo) / colorSuccess / colorError. They
 *   are applied as `text-*` + `stroke="currentColor"` so the CSS-var token layer drives both
 *   themes. The indicator recolours by status too — antd's base `-status-*` rule (specificity
 *   0,3,0) beats `-circle -indicator`'s `circleTextColor` (0,2,0).
 * - the indicator is absolutely centred at `1em` (i.e. it inherits the body font size), and its
 *   glyph is `circleIconFontSize` = `fontSize/fontSizeSM` em = 1.2em under the app theme (12/10).
 *
 * Status glyphs are per-variant, matching antd exactly: LINE uses `CheckCircleFilled`/
 * `CloseCircleFilled`, CIRCLE uses the bare `CheckOutlined`/`CloseOutlined`.
 *
 * One DELIBERATE circle divergence from antd: it wraps the info in a Tooltip when the diameter
 * is <= 20 — we render it inline instead (no Tooltip dependency in this primitive).
 *
 * antd → @agenta/ui mapping: percent/size/status/showInfo/strokeColor/trailColor/format map
 * 1:1 for both variants; `strokeWidth` and numeric `size` apply to the circle. `type="dashboard"`
 * (and its `gapDegree`/`gapPosition`) is still deferred — see Progress.md.
 */
const progressTrackVariants = cva(
    "relative box-border w-full flex-auto overflow-hidden rounded-full bg-fill-secondary",
    {
        variants: {
            // antd line height: default 8px, small 6px (`size === 'small' ? 6 : 8`).
            size: {default: "h-2", small: "h-1.5"},
        },
        defaultVariants: {size: "default"},
    },
)

// antd `-track` fill colour per status (defaultColor = colorInfo; success/exception overrides).
const progressBarVariants = cva(
    "absolute inset-y-0 left-0 box-border rounded-[inherit] transition-[width] duration-300 ease-[cubic-bezier(0.78,0.14,0.15,0.86)]",
    {
        variants: {
            status: {
                normal: "bg-info",
                active: "bg-info",
                success: "bg-success",
                exception: "bg-error",
            },
        },
        defaultVariants: {status: "normal"},
    },
)

// antd `-indicator`: colour per status (colorText normal; success/exception recolour) and
// font per size — default `fontSize` 12px, small `fontSizeSM` 10px (antd's small-line rule).
// `leading-none` = antd's `line-height: 1`.
const progressTextVariants = cva("box-border whitespace-nowrap leading-none", {
    variants: {
        status: {
            normal: "text-foreground",
            active: "text-foreground",
            success: "text-success",
            exception: "text-error",
        },
        size: {default: "text-sm", small: "text-[12px]"},
    },
    defaultVariants: {status: "normal", size: "default"},
})

// antd circle `-circle-path` fill per status — the SAME tokens as the line bar, applied as
// `color` so the svg can paint with `currentColor`.
const progressCircleStrokeVariants = cva(
    "transition-[stroke-dashoffset] duration-300 ease-[cubic-bezier(0.78,0.14,0.15,0.86)]",
    {
        variants: {
            status: {
                normal: "text-info",
                active: "text-info",
                success: "text-success",
                exception: "text-error",
            },
        },
        defaultVariants: {status: "normal"},
    },
)

// antd circle `-indicator`: absolutely centred over the ring, `1em` (inherits the body font),
// `line-height: 1`; the glyph is `circleIconFontSize` = fontSize/fontSizeSM em (12/10 = 1.2em).
const progressCircleTextVariants = cva(
    "absolute inset-x-0 top-1/2 m-0 box-border -translate-y-1/2 whitespace-normal p-0 text-center leading-none [&_.anticon]:text-[1.2em]",
    {
        variants: {
            status: {
                normal: "text-foreground",
                active: "text-foreground",
                success: "text-success",
                exception: "text-error",
            },
        },
        defaultVariants: {status: "normal"},
    },
)

export type ProgressSize = "default" | "small"
export type ProgressStatus = "normal" | "active" | "success" | "exception"
export type ProgressType = "line" | "circle"

export interface ProgressProps
    extends
        Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
        Omit<VariantProps<typeof progressTrackVariants>, "size"> {
    ref?: React.Ref<HTMLDivElement>
    /** 0–100. */
    percent?: number
    /** Shape: horizontal bar (default) or ring. */
    type?: ProgressType
    /**
     * Line: thickness token — 8px (default) / 6px (small).
     * Circle: DIAMETER — 120px (default) / 60px (small), or any number of px.
     */
    size?: ProgressSize | number
    /**
     * Circle only — ring thickness as a PERCENT of the diameter (antd default
     * `max(3 / diameter * 100, 6)`). Ignored by the line variant.
     */
    strokeWidth?: number
    /** Explicit status; unset auto-promotes to `success` at percent >= 100 (antd behaviour). */
    status?: ProgressStatus
    /** Show the trailing percent label / status icon. */
    showInfo?: boolean
    /** Override the bar fill (antd `strokeColor`) — any CSS colour. */
    strokeColor?: string
    /** Override the track (rail) fill (antd `trailColor`/`railColor`). */
    trailColor?: string
    /** Custom formatter for the info label (antd `format`). Defaults to `${percent}%`. */
    format?: (percent: number) => React.ReactNode
}

const clampPercent = (value: number): number =>
    Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0

// antd `getSize(size, 'circle')`: numbers are the diameter, `'small'` is 60, anything else 120.
const circleDiameter = (size: ProgressSize | number): number =>
    typeof size === "number" ? size : size === "small" ? 60 : 120

// antd `CIRCLE_MIN_STROKE_WIDTH` 3px floor, expressed as a percent of the diameter.
const circleStrokeWidth = (diameter: number, strokeWidth?: number): number =>
    strokeWidth ?? Math.max((3 / diameter) * 100, 6)

export function Progress({
    className,
    percent = 0,
    type = "line",
    size = "default",
    strokeWidth,
    status,
    showInfo = true,
    strokeColor,
    trailColor,
    format,
    "aria-label": ariaLabel,
    ...props
}: ProgressProps) {
    const pct = clampPercent(percent)
    // antd: an unset status becomes `success` once complete; an explicit status is kept.
    const effectiveStatus: ProgressStatus = status ?? (pct >= 100 ? "success" : "normal")

    // Status glyphs match antd PER VARIANT: line uses the filled circle glyphs, circle uses the
    // bare check/close (antd renders different icons for each). Sized to the info font via their
    // `1em` svg and coloured by the span's `currentColor`.
    let info: React.ReactNode = null
    if (showInfo) {
        const isCircle = type === "circle"
        if (format) {
            info = format(pct)
        } else if (effectiveStatus === "exception") {
            info = isCircle ? <CloseOutlined /> : <CloseCircleFilled />
        } else if (effectiveStatus === "success") {
            info = isCircle ? <CheckOutlined /> : <CheckCircleFilled />
        } else {
            info = `${pct}%`
        }
    }

    if (type === "circle") {
        const diameter = circleDiameter(size)
        const stroke = circleStrokeWidth(diameter, strokeWidth)
        const radius = (100 - stroke) / 2
        const perimeter = 2 * Math.PI * radius
        let dashOffset = ((100 - pct) / 100) * perimeter
        if (pct !== 100) {
            // antd's round-linecap accuracy fix (ant-design#35009), clamped so 0% stays visible.
            dashOffset = Math.min(dashOffset + stroke / 2, perimeter - 0.01)
        }

        return (
            <div
                data-slot="progress"
                role="progressbar"
                aria-label={ariaLabel ?? `${pct}%`}
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                className={cn("box-border inline-flex leading-none", className)}
                {...props}
            >
                <div
                    data-slot="progress-body"
                    className="relative box-border bg-transparent leading-none"
                    // antd inlines the diameter + `font-size: width * 0.15 + 6` on the body.
                    style={{width: diameter, height: diameter, fontSize: diameter * 0.15 + 6}}
                >
                    <svg
                        data-slot="progress-circle"
                        className="block h-full w-full"
                        viewBox="0 0 100 100"
                        role="presentation"
                    >
                        <circle
                            data-slot="progress-circle-trail"
                            className="text-fill-secondary"
                            cx={50}
                            cy={50}
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={stroke}
                            strokeLinecap="round"
                            style={trailColor ? {stroke: trailColor} : undefined}
                        />
                        <circle
                            data-slot="progress-circle-stroke"
                            className={progressCircleStrokeVariants({status: effectiveStatus})}
                            cx={50}
                            cy={50}
                            r={radius}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={stroke}
                            strokeLinecap="round"
                            opacity={pct === 0 ? 0 : 1}
                            style={{
                                strokeDasharray: `${perimeter}px ${perimeter}px`,
                                strokeDashoffset: dashOffset,
                                // -90deg starts the ring at 12 o'clock; origin is in user units.
                                transform: "rotate(-90deg)",
                                transformOrigin: "50px 50px",
                                ...(strokeColor ? {stroke: strokeColor} : {}),
                            }}
                        />
                    </svg>
                    {info != null ? (
                        <span
                            data-slot="progress-circle-text"
                            className={progressCircleTextVariants({status: effectiveStatus})}
                        >
                            {info}
                        </span>
                    ) : null}
                </div>
            </div>
        )
    }

    // antd line sizing is a token, never a number — a numeric `size` (circle diameter) falls
    // back to the default 8px rail.
    const lineSize: ProgressSize = size === "small" ? "small" : "default"

    return (
        <div
            data-slot="progress"
            role="progressbar"
            // role=progressbar needs an accessible name; default to the percent (overridable).
            aria-label={ariaLabel ?? `${pct}%`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cn("inline-flex w-full", className)}
            {...props}
        >
            <div data-slot="progress-body" className="inline-flex w-full items-center gap-2">
                <div
                    data-slot="progress-track"
                    className={progressTrackVariants({size: lineSize})}
                    style={trailColor ? {backgroundColor: trailColor} : undefined}
                >
                    <div
                        data-slot="progress-bar"
                        className={progressBarVariants({status: effectiveStatus})}
                        style={{
                            width: `${pct}%`,
                            ...(strokeColor ? {background: strokeColor} : {}),
                        }}
                    />
                </div>
                {info != null ? (
                    <span
                        data-slot="progress-text"
                        className={progressTextVariants({status: effectiveStatus, size: lineSize})}
                    >
                        {info}
                    </span>
                ) : null}
            </div>
        </div>
    )
}

export {
    progressTrackVariants,
    progressBarVariants,
    progressTextVariants,
    progressCircleStrokeVariants,
    progressCircleTextVariants,
}
