import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Segmented — a custom cva primitive in @agenta/ui (NO Radix). A single-select control: a
 * rounded track of N options with ONE sliding pill/thumb behind the active option that
 * animates its position + width on selection change (antd's `motionDurationMid` ease).
 * Follows shadcn's source conventions (no `forwardRef`, `data-slot` on every part).
 *
 * Re-skinned to antd's `Segmented` geometry/colour via the shared control scale
 * (`h-control*`, `rounded-control*`) and bridge tokens only — no raw px/hex.
 *
 * antd → @agenta/ui mapping (for migrating call-sites):
 *   <Segmented options value onChange size="small|middle|large" block disabled />
 *     → <Segmented options value onChange size="sm|default|lg" block disabled />
 *   antd size middle → default; the option shape ({label,value,icon,disabled}) is unchanged.
 *
 * ICON CENTERING: antd centres the item label by line-height, so a bare inline <svg> hangs off
 * the text baseline and lands ~4px ABOVE centre (measured, 16px icon in a 24px label). Call-sites
 * patch it by flexing the LABEL BOX (globals.css `.ag-icon-segmented` override); we build that
 * in with `items-center justify-center` on the item.
 */

export type SegmentedValue = string | number

export interface SegmentedOption {
    label?: React.ReactNode
    value: SegmentedValue
    icon?: React.ReactNode
    disabled?: boolean
    /** Accessible name — required for icon-only options so axe/screen-readers have a label. */
    "aria-label"?: string
    className?: string
}

type SegmentedRawOption = SegmentedValue | SegmentedOption

// Track: the rounded rail holding the options. antd trackBg = colorBgLayout (white light / black
// dark — it blends into the page; the thumb is distinguished by its shadow), trackPadding 2px,
// radius = borderRadius per size. box-border + border-solid: preflight is off (see button.tsx).
const segmentedTrackVariants = cva(
    [
        // border-0 zeroes the app's global default border-width (preflight off) — antd's track
        // has no border, and a phantom ~1.5px border would eat the height so items can't fill.
        "relative inline-flex items-stretch box-border border-0 font-[inherit] p-0.5",
        "bg-colorBgLayout",
        "data-[disabled=true]:cursor-not-allowed",
    ],
    {
        variants: {
            size: {
                sm: "h-control-sm rounded-control-sm",
                default: "h-control rounded-control",
                lg: "h-control-lg rounded-control-lg",
            },
            block: {true: "flex w-full", false: ""},
        },
        defaultVariants: {size: "default", block: false},
    },
)

// Item: a transparent <button> sitting ABOVE the thumb (z-10). antd itemColor = colorTextLabel
// (inactive), itemSelectedColor/itemHoverColor = colorText. Hover/active fills apply only to
// inactive items (the selected one shows the thumb). bg-transparent stops the UA button-face leak.
const segmentedItemVariants = cva(
    [
        "relative z-10 box-border border-0 bg-transparent font-[inherit] cursor-pointer",
        // gap-1.5 = antd's `-item-icon + * { margin-inline-start: marginSM/2 }` = 6px.
        "inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap select-none",
        "transition-colors outline-none",
        "text-colorTextLabel",
        "data-[state=active]:text-colorText",
        // hover/active only when inactive + enabled — the selected item owns the thumb. antd
        // itemHoverColor/itemActiveColor = colorText, itemHoverBg = colorFillSecondary,
        // itemActiveBg = colorFill.
        "enabled:data-[state=inactive]:hover:text-colorText enabled:data-[state=inactive]:hover:bg-colorFillSecondary",
        "enabled:data-[state=inactive]:active:text-colorText enabled:data-[state=inactive]:active:bg-colorFill",
        "disabled:cursor-not-allowed disabled:text-colorTextDisabled",
        // antd shared keyboard focus ring: 4px colorPrimaryBorder, focus-visible only.
        "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-1 focus-visible:outline-focus-ring",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:block",
    ],
    {
        variants: {
            // antd horizontal padding lives on the item-label: 11px (controlPaddingHorizontal - 1px
            // border) default/lg = `input`, 7px (SM - 1) = `input-sm`. Font 12px sm/default,
            // 14px lg (antd bumps the label to fontSizeLG at lg); item radius 4/6/8px per size.
            size: {
                sm: "px-input-sm text-field-md rounded",
                default: "px-input text-field-md rounded-control-sm",
                lg: "px-input-lg text-field-lg rounded-control",
            },
            block: {true: "flex-1 basis-0", false: ""},
        },
        defaultVariants: {size: "default", block: false},
    },
)

// Thumb: the single sliding pill behind the active option. antd itemSelectedBg = colorBgElevated
// with boxShadowTertiary. It transitions transform + width to the active item's box.
const segmentedThumbVariants = cva(
    // left-0 pins the absolute origin to the track's padding box (else left:auto = static
    // position, which double-offsets the translateX slide).
    [
        "absolute left-0 z-0 box-border border-0 bg-colorBgElevated shadow-tertiary",
        "pointer-events-none",
    ],
    {
        variants: {
            // Thumb radius matches the item radius per size (4/6/8px).
            size: {
                sm: "rounded",
                default: "rounded-control-sm",
                lg: "rounded-control",
            },
        },
        defaultVariants: {size: "default"},
    },
)

// Narrow on the PRIMITIVE side: `typeof opt === "object"` leaves the else-branch un-narrowed
// under a non-strictNullChecks tsconfig, so `opt` stayed `SegmentedRawOption`.
function normalizeOption(opt: SegmentedRawOption): SegmentedOption {
    return typeof opt === "string" || typeof opt === "number" ? {value: opt, label: opt} : opt
}

export interface SegmentedProps
    extends
        Omit<React.ComponentProps<"div">, "onChange" | "defaultValue">,
        VariantProps<typeof segmentedTrackVariants> {
    options: SegmentedRawOption[]
    value?: SegmentedValue
    defaultValue?: SegmentedValue
    onChange?: (value: SegmentedValue) => void
    disabled?: boolean
}

function Segmented({
    options,
    value: valueProp,
    defaultValue,
    onChange,
    size = "default",
    block = false,
    disabled = false,
    className,
    ...props
}: SegmentedProps) {
    const items = React.useMemo(() => options.map(normalizeOption), [options])

    const [internal, setInternal] = React.useState<SegmentedValue | undefined>(
        defaultValue ?? items[0]?.value,
    )
    const isControlled = valueProp !== undefined
    const selected = isControlled ? valueProp : internal

    const trackRef = React.useRef<HTMLDivElement>(null)
    const itemRefs = React.useRef(new Map<SegmentedValue, HTMLButtonElement>())
    const [thumb, setThumb] = React.useState<{
        left: number
        top: number
        width: number
        height: number
    } | null>(null)
    // Suppress the slide on the very first measured layout so the thumb appears in place.
    const readyRef = React.useRef(false)

    const measure = React.useCallback(() => {
        if (selected === undefined) {
            setThumb(null)
            return
        }
        const el = itemRefs.current.get(selected)
        if (!el) {
            setThumb(null)
            return
        }
        setThumb({
            left: el.offsetLeft,
            top: el.offsetTop,
            width: el.offsetWidth,
            height: el.offsetHeight,
        })
    }, [selected])

    React.useLayoutEffect(() => {
        measure()
    }, [measure, items, size, block])

    // Re-measure on container resize (block/full-width layouts, font load).
    React.useEffect(() => {
        const track = trackRef.current
        if (!track || typeof ResizeObserver === "undefined") return
        const ro = new ResizeObserver(() => measure())
        ro.observe(track)
        return () => ro.disconnect()
    }, [measure])

    // Enable the slide transition only after the first paint with a measured thumb.
    React.useEffect(() => {
        if (thumb && !readyRef.current) {
            const id = requestAnimationFrame(() => {
                readyRef.current = true
            })
            return () => cancelAnimationFrame(id)
        }
    }, [thumb])

    const commit = (val: SegmentedValue, opt: SegmentedOption) => {
        if (disabled || opt.disabled) return
        if (!isControlled) setInternal(val)
        onChange?.(val)
    }

    const enabledValues = items.filter((o) => !o.disabled && !disabled).map((o) => o.value)

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (selected === undefined || enabledValues.length === 0) return
        const idx = enabledValues.indexOf(selected)
        let next = idx
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % enabledValues.length
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
            next = (idx - 1 + enabledValues.length) % enabledValues.length
        else if (e.key === "Home") next = 0
        else if (e.key === "End") next = enabledValues.length - 1
        else return
        e.preventDefault()
        const val = enabledValues[next]
        const opt = items.find((o) => o.value === val)
        if (opt) {
            commit(val, opt)
            itemRefs.current.get(val)?.focus()
        }
    }

    return (
        <div
            ref={trackRef}
            data-slot="segmented"
            role="radiogroup"
            aria-disabled={disabled || undefined}
            data-disabled={disabled || undefined}
            className={cn(segmentedTrackVariants({size, block}), className)}
            onKeyDown={handleKeyDown}
            {...props}
        >
            {thumb ? (
                <div
                    data-slot="segmented-thumb"
                    aria-hidden="true"
                    className={cn(
                        segmentedThumbVariants({size}),
                        readyRef.current &&
                            "transition-[transform,width] duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)]",
                    )}
                    style={{
                        transform: `translateX(${thumb.left}px)`,
                        top: thumb.top,
                        width: thumb.width,
                        height: thumb.height,
                    }}
                />
            ) : null}
            {items.map((opt) => {
                const isActive = opt.value === selected
                const isDisabled = disabled || !!opt.disabled
                return (
                    <button
                        key={opt.value}
                        ref={(node) => {
                            if (node) itemRefs.current.set(opt.value, node)
                            else itemRefs.current.delete(opt.value)
                        }}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        aria-label={opt["aria-label"]}
                        disabled={isDisabled}
                        tabIndex={isActive && !isDisabled ? 0 : -1}
                        data-slot="segmented-item"
                        data-state={isActive ? "active" : "inactive"}
                        className={cn(segmentedItemVariants({size, block}), opt.className)}
                        onClick={() => commit(opt.value, opt)}
                    >
                        {opt.icon}
                        {opt.label}
                    </button>
                )
            })}
        </div>
    )
}

export {Segmented, segmentedTrackVariants, segmentedItemVariants, segmentedThumbVariants}
