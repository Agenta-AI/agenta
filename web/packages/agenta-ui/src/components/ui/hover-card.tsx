import * as React from "react"

import * as HoverCardPrimitive from "@radix-ui/react-hover-card"

import {cn} from "./utils"

/** HoverCard — shadcn's hover card on Radix, with the kit's conventions and Popover's surface. */

function HoverCard(props: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
    return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />
}

function HoverCardTrigger({
    onFocus,
    ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
    return (
        <HoverCardPrimitive.Trigger
            data-slot="hover-card-trigger"
            onFocus={(e) => {
                onFocus?.(e)
                // Keyboard focus only: a tap also focuses, and touch must not open the card.
                if (!e.currentTarget.matches(":focus-visible")) e.preventDefault()
            }}
            {...props}
        />
    )
}

function HoverCardContent({
    className,
    align = "center",
    sideOffset = 4,
    container,
    ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
    /** Portal target. Defaults to document.body. */
    container?: HTMLElement | null
}) {
    return (
        <HoverCardPrimitive.Portal container={container}>
            <HoverCardPrimitive.Content
                data-slot="hover-card-content"
                align={align}
                sideOffset={sideOffset}
                className={cn(
                    // Same surface and motion as PopoverContent.
                    "z-50 box-border w-64 rounded-control-lg bg-popover p-4 text-popover-foreground shadow-overlay outline-none font-portal",
                    "ag-overlay-motion",
                    className,
                )}
                {...props}
            />
        </HoverCardPrimitive.Portal>
    )
}

export {HoverCard, HoverCardTrigger, HoverCardContent}
