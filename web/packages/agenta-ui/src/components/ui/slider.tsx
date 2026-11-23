import * as React from "react"

import * as SliderPrimitive from "@radix-ui/react-slider"

import {cn} from "./utils"

/**
 * Slider — a Radix + cva primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skinned to antd's horizontal `Slider` (single or
 * multi thumb) via the shared token bridge. The sanctioned replacement for the antd `Slider`.
 *
 * Consumed by `presentational/inputs/SliderInput.tsx`.
 *
 * SCOPE: horizontal only (antd default). antd `vertical`, `range` marks/dots, `tooltip`, and
 * `included=false` are deferred — compose later, do NOT add antd-shaped props speculatively.
 *
 * Geometry + colour are MEASURED against the app theme's explicit `Slider` component token
 * override (antd-themeConfig.json), NOT antd stock — the app sets `handleSize`=10,
 * `handleSizeHover`=12, `railSize`=4, `lineWidth`=1 (→ handleLineWidth = lineWidth+1 = 2px ring),
 * `borderRadiusXS`=4. antd derives the horizontal box as `railSize*3`=12px tall with the 4px rail
 * and the 10px handle both vertically centred (`items-center` reproduces this). `box-border`
 * everywhere (preflight is OFF app-wide).
 *
 * antd token → class mapping. NOTE `colorPrimaryBorder`/`colorPrimaryBorderHover` reach
 * Tailwind through `themeAwareColors` (var-backed); the raw antd-tailwind.json entries of the
 * same name are LIGHT-ONLY hexes, which is what froze this track light-blue in dark mode.
 *   - rail (Track bg)   = `railBg` colorFillTertiary → `bg-secondary`;
 *                          hover `railHoverBg` colorFillSecondary → `group-hover:bg-accent`.
 *   - track (Range fill) = `trackBg` colorPrimaryBorder → `bg-border`;
 *                          hover `trackHoverBg` colorPrimaryBorderHover → `group-hover:bg-border-strong`.
 *     NOTE: antd's RESTING track is `colorPrimaryBorder` (a light primary tint), NOT full
 *     `colorPrimary` — using colorPrimary at rest would render a dark bar unlike antd. Primary
 *     only appears on the HANDLE RING when hovered/focused/dragged. This is the faithful match.
 *   - handle = 10px square (`rounded-xs`, SHAPE-01) with a 1px `border-strong` ring drawn as a
 *     box-shadow outside the fill; `primary` on hover; the shared `focus-ring` on keyboard focus.
 *   - rail/track radius 1px, a quarter of the 4px rail (SHAPE-01).
 *
 * antd → @agenta/ui mapping: <Slider value={n} min max step onChange /> → shadcn-native
 * <Slider value={[n]} onValueChange={([v]) => ...} min max step /> (arrays, one Thumb per entry).
 */
function Slider({
    className,
    defaultValue,
    value,
    min = 0,
    max = 100,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledby,
    ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
    // One Thumb per value entry (shadcn pattern); fall back to a single thumb at `min`.
    const thumbValues = React.useMemo(
        () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
        [value, defaultValue, min],
    )

    return (
        <SliderPrimitive.Root
            data-slot="slider"
            defaultValue={defaultValue}
            value={value}
            min={min}
            max={max}
            className={cn(
                // antd `.ant-slider-horizontal`: 12px content box (railSize*3), rail + handle
                // vertically centred. `group` drives the hover recolour of rail/track/handle.
                "group relative box-border flex w-full touch-none select-none items-center h-3",
                "data-[disabled]:cursor-not-allowed",
                className,
            )}
            {...props}
        >
            <SliderPrimitive.Track
                data-slot="slider-track"
                // antd rail: 4px, colorFillTertiary → colorFillSecondary on hover. motionDurationMid.
                className={cn(
                    "relative box-border grow overflow-hidden rounded-[1px] bg-secondary h-1",
                    "transition-colors group-hover:bg-accent",
                )}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    // antd track (filled): colorPrimaryBorder → colorPrimaryBorderHover on hover;
                    // colorBgContainerDisabled when disabled (antd `trackBgDisabled`).
                    className={cn(
                        "absolute box-border h-full rounded-[1px] bg-border",
                        "transition-colors group-hover:bg-border-strong",
                        "data-[disabled]:!bg-secondary",
                    )}
                />
            </SliderPrimitive.Track>
            {/* Cancels Radix's in-bounds thumb inset. Radix offsets each thumb by
                `handle/2 * (1 - pct/50)` so it never overflows the track, which puts it up to
                5px away from antd's `left: pct%` (worst at the ends). Making the thumbs'
                containing block 5px wider on EACH side makes that offset cancel exactly:
                -5 + (W+10)*pct/100 + 5 - 10*pct/100 === W*pct/100. `flex items-center`
                reproduces the static position that centred them in the Root. */}
            <span className="pointer-events-none absolute inset-y-0 -left-[5px] -right-[5px] flex items-center">
                {thumbValues.map((_, i) => (
                    <SliderPrimitive.Thumb
                        key={i}
                        data-slot="slider-thumb"
                        // The THUMB carries role="slider", so the name must land here, not on Root.
                        aria-label={ariaLabel}
                        aria-labelledby={ariaLabelledby}
                        className={cn(
                            // 10px handle; the 1px ring is a box-shadow outside the fill, so the fill stays 10px.
                            "block box-border size-2.5 shrink-0 rounded-xs bg-background outline-none focus-ring",
                            // Re-enables hits the wrapper turns off, so the hit surface is unchanged.
                            "pointer-events-auto",
                            "shadow-[0_0_0_1px_var(--border-strong)]",
                            "transition-[box-shadow,transform] duration-200 cursor-grab",
                            // hover: ring → colorPrimary + antd's 10→12px grow (handleSizeHover, ~1.2x).
                            "group-hover:scale-[1.2] group-hover:shadow-[0_0_0_1px_var(--primary)]",
                            // disabled: muted ring, no grow, not-allowed (wins over group-hover via `!`).
                            "data-[disabled]:cursor-not-allowed data-[disabled]:!scale-100 data-[disabled]:!shadow-[0_0_0_1px_var(--muted-foreground)]",
                        )}
                    />
                ))}
            </span>
        </SliderPrimitive.Root>
    )
}

export {Slider}
