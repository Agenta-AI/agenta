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
 *   - rail (Track bg)   = `railBg` colorFillTertiary → `bg-colorFillTertiary`;
 *                          hover `railHoverBg` colorFillSecondary → `group-hover:bg-colorFillSecondary`.
 *   - track (Range fill) = `trackBg` colorPrimaryBorder → `bg-colorPrimaryBorder`;
 *                          hover `trackHoverBg` colorPrimaryBorderHover → `group-hover:bg-colorPrimaryBorderHover`.
 *     NOTE: antd's RESTING track is `colorPrimaryBorder` (a light primary tint), NOT full
 *     `colorPrimary` — using colorPrimary at rest would render a dark bar unlike antd. Primary
 *     only appears on the HANDLE RING when hovered/focused/dragged. This is the faithful match.
 *   - handle = 10px white circle (`colorBgElevated`) with antd's 2px RING drawn as a box-shadow
 *     (antd uses `box-shadow: 0 0 0 handleLineWidth handleColor`, not a border — the ring sits
 *     OUTSIDE the 10px fill, giving the ~14px visual handle). Ring `handleColor` colorPrimaryBorder
 *     at rest → `handleActiveColor` colorPrimary on hover/focus/drag. Disabled ring = colorTextDisabled.
 *   - rail/track radius `borderRadiusXS`=4 on a 4px rail == fully rounded → `rounded-full`.
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
                    "relative box-border grow overflow-hidden rounded-full bg-colorFillTertiary h-1",
                    "transition-colors group-hover:bg-colorFillSecondary",
                )}
            >
                <SliderPrimitive.Range
                    data-slot="slider-range"
                    // antd track (filled): colorPrimaryBorder → colorPrimaryBorderHover on hover;
                    // colorBgContainerDisabled when disabled (antd `trackBgDisabled`).
                    className={cn(
                        "absolute box-border h-full rounded-full bg-colorPrimaryBorder",
                        "transition-colors group-hover:bg-colorPrimaryBorderHover",
                        "data-[disabled]:!bg-colorBgContainerDisabled",
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
                            // antd handle: 10px white circle. The 2px ring is a box-shadow OUTSIDE
                            // the fill (antd `box-shadow: 0 0 0 handleLineWidth handleColor`), so the
                            // fill stays 10px and the visual handle reads ~14px — matching antd.
                            "block box-border size-2.5 shrink-0 rounded-full bg-colorBgElevated outline-none",
                            // Re-enables hits the wrapper turns off, so the hit surface is unchanged.
                            "pointer-events-auto",
                            "shadow-[0_0_0_2px_var(--ag-colorPrimaryBorder)]",
                            "transition-[box-shadow,transform] duration-200 cursor-grab",
                            // hover: ring → colorPrimary + antd's 10→12px grow (handleSizeHover, ~1.2x).
                            "group-hover:scale-[1.2] group-hover:shadow-[0_0_0_2px_var(--ag-colorPrimary)]",
                            // keyboard/drag focus: primary ring + antd's translucent outer outline
                            // (approx via colorPrimaryBorder — antd uses colorPrimary@20%, no token).
                            "focus-visible:shadow-[0_0_0_2px_var(--ag-colorPrimary),0_0_0_6px_var(--ag-colorPrimaryBorder)]",
                            // disabled: muted ring, no grow, not-allowed (wins over group-hover via `!`).
                            "data-[disabled]:cursor-not-allowed data-[disabled]:!scale-100 data-[disabled]:!shadow-[0_0_0_2px_var(--ag-colorTextDisabled)]",
                        )}
                    />
                ))}
            </span>
        </SliderPrimitive.Root>
    )
}

export {Slider}
