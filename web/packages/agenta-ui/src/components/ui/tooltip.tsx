import * as React from "react"

import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import {cn} from "./utils"

/**
 * Tooltip — a Radix primitive in @agenta/ui, following shadcn's source conventions (no `forwardRef`, `data-slot`).
 * Re-skinned to antd's overlay: colorBgSpotlight bg, white text, borderRadius (8px), the
 * overlay shadow. antd → @agenta/ui: `title`→children, `placement`→`side`+`align`, `open`→`open`,
 * `getPopupContainer`→`container`.
 */

function TooltipProvider({
    delayDuration = 0,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
    return (
        <TooltipPrimitive.Provider
            data-slot="tooltip-provider"
            delayDuration={delayDuration}
            {...props}
        />
    )
}

/**
 * Self-provides, as current shadcn does. Radix throws "`Tooltip` must be used within
 * `TooltipProvider`" otherwise — a RUNTIME error that neither gate catches (a crashed story
 * renders an error overlay, which the VRT reads as "no pairs" and axe audits as one clean root).
 * antd's Tooltip needed no provider, so every migrated call site was one of these waiting to
 * happen. Nesting is harmless: an outer TooltipProvider still wins for shared delay/skip state.
 */
function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
    return (
        <TooltipProvider>
            <TooltipPrimitive.Root data-slot="tooltip" {...props} />
        </TooltipProvider>
    )
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
    className,
    sideOffset = 4,
    container,
    children,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline (e.g. inside
     * a modal/scroll container, or a forced-open parity story). */
    container?: HTMLElement | null
}) {
    return (
        <TooltipPrimitive.Portal container={container}>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                className={cn(
                    // font-portal: portaled to <body>, escaping the app font scope (preflight off).
                    // antd tooltip is borderless with the overlay shadow (boxShadowSecondary),
                    // colorBgSpotlight bg + white text, borderRadius (8px), 6px×8px padding.
                    "z-50 box-border w-fit rounded-control bg-colorBgSpotlight px-2 py-1.5 text-field-md text-colorTextLightSolid shadow-overlay font-portal",
                    // Soft width cap (matches antd's default tooltip max width) — not a control dim.
                    "max-w-[250px]",
                    className,
                )}
                {...props}
            >
                {children}
                {/* Same fill as bg; Radix renders it as an SVG triangle. */}
                <TooltipPrimitive.Arrow className="fill-colorBgSpotlight" />
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    )
}

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider}
