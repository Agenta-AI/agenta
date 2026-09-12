import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Kbd — shadcn's keycap in @agenta/ui (no `forwardRef`, `data-slot`). Re-skinned to the chip
 * surface (`ag-surface-chip` + colorTextSecondary). `tone="inverse"` sits on a dark or filled
 * surface (a primary button); inside a `TooltipContent` the cap flips to that tone on its own via
 * the `[data-slot=tooltip-content]` ancestor selector, so tooltip callers never pass it.
 */
const kbdVariants = cva(
    "pointer-events-none inline-flex w-fit select-none items-center justify-center gap-1 rounded font-sans font-medium leading-none whitespace-nowrap [&_svg:not([class*='size-'])]:size-3",
    {
        variants: {
            tone: {
                chip: "ag-surface-chip text-[var(--ag-colorTextSecondary)] [[data-slot=tooltip-content]_&]:border-transparent [[data-slot=tooltip-content]_&]:bg-white/20 [[data-slot=tooltip-content]_&]:text-inherit",
                inverse: "bg-white/20 text-inherit",
            },
            size: {
                // Fixed height = min-width, so a single glyph is a square cap and a word
                // (`Esc`) grows only sideways.
                sm: "h-4 min-w-4 px-1 text-[10px]",
                md: "h-5 min-w-5 px-1.5 text-[11px]",
            },
        },
        defaultVariants: {tone: "chip", size: "sm"},
    },
)

export interface KbdProps extends React.ComponentProps<"kbd">, VariantProps<typeof kbdVariants> {}

function Kbd({className, tone, size, ...props}: KbdProps) {
    return <kbd data-slot="kbd" className={cn(kbdVariants({tone, size}), className)} {...props} />
}

/** Lays several caps out as one chord, e.g. `⌘` `K`. */
function KbdGroup({className, ...props}: React.ComponentProps<"div">) {
    return (
        <kbd
            data-slot="kbd-group"
            className={cn("inline-flex items-center gap-0.5 align-middle", className)}
            {...props}
        />
    )
}

export {Kbd, KbdGroup, kbdVariants}
