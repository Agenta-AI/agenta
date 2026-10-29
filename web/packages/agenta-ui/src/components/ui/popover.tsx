import * as React from "react"

import * as PopoverPrimitive from "@radix-ui/react-popover"

import {cn} from "./utils"

/** Popover — a Radix primitive in @agenta/ui, following shadcn's source conventions (no `forwardRef`, `data-slot`). */

function Popover(props: React.ComponentProps<typeof PopoverPrimitive.Root>) {
    return <PopoverPrimitive.Root data-slot="popover" {...props} />
}

function PopoverTrigger(props: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
    return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}

function PopoverAnchor(props: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
    return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverArrow({className, ...props}: React.ComponentProps<typeof PopoverPrimitive.Arrow>) {
    return (
        <PopoverPrimitive.Arrow
            data-slot="popover-arrow"
            className={cn("fill-popover", className)}
            {...props}
        />
    )
}

function PopoverContent({
    className,
    align = "start",
    sideOffset = 4,
    container,
    ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline (e.g. inside
     * a modal/scroll container, or a forced-open parity story). */
    container?: HTMLElement | null
}) {
    return (
        <PopoverPrimitive.Portal container={container}>
            <PopoverPrimitive.Content
                data-slot="popover-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    // font-portal: portaled to <body>, escaping the app font scope (preflight off).
                    // antd overlays (dropdown/popover) are borderless with the overlay shadow
                    // (boxShadowSecondary) and borderRadiusLG (10px), not a bordered shadcn panel.
                    // box-border: preflight is off, so w-[trigger-width] must include the p-1 padding
                    // (else the panel renders 8px wider than the trigger / antd dropdown).
                    "z-50 box-border rounded-control-lg bg-popover text-popover-foreground shadow-overlay outline-none font-portal",
                    // Enter/exit (surfaces.css). Without it a popover has no open/closed state to
                    // read — it is simply there, then not, on the same frame as the click.
                    "ag-overlay-motion",
                    className,
                )}
                {...props}
            />
        </PopoverPrimitive.Portal>
    )
}

export {Popover, PopoverTrigger, PopoverAnchor, PopoverArrow, PopoverContent}
