import * as React from "react"

import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import {Kbd, KbdGroup} from "./kbd"
import {cn} from "./utils"

/**
 * Tooltip — a Radix primitive in @agenta/ui, following shadcn's source conventions (no `forwardRef`, `data-slot`).
 * Re-skinned to antd's overlay: colorBgSpotlight bg, white text, borderRadius (8px), the
 * overlay shadow. antd → @agenta/ui: `title`→children, `placement`→`side`+`align`, `open`→`open`,
 * `getPopupContainer`→`container`.
 *
 * Body copy is always the small step (`text-field-sm`, 12px). Pass `shortcut` to print a
 * keyboard chord after the label as `Kbd` caps in the inverse tone.
 */

/** One key or a chord, e.g. `"Esc"` or `["⌘", "K"]`. Each entry becomes one cap. */
export type TooltipShortcut = string | string[]

/** Renders a `TooltipShortcut` as caps; `null` when there is nothing to print. */
function TooltipShortcutKeys({shortcut}: {shortcut?: TooltipShortcut}) {
    const keys = shortcut == null ? [] : Array.isArray(shortcut) ? shortcut : [shortcut]
    if (keys.length === 0) return null
    return (
        <KbdGroup data-slot="tooltip-shortcut" className="ml-1.5">
            {keys.map((key, index) => (
                <Kbd key={`${key}-${index}`}>{key}</Kbd>
            ))}
        </KbdGroup>
    )
}

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

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
    return <TooltipPrimitive.Root data-slot="tooltip" {...props} />
}

function TooltipTrigger(props: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
    className,
    sideOffset = 4,
    container,
    shortcut,
    children,
    ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline (e.g. inside
     * a modal/scroll container, or a forced-open parity story). */
    container?: HTMLElement | null
    /** Keyboard shortcut printed after the body as `Kbd` caps. */
    shortcut?: TooltipShortcut
}) {
    return (
        <TooltipPrimitive.Portal container={container}>
            <TooltipPrimitive.Content
                data-slot="tooltip-content"
                sideOffset={sideOffset}
                className={cn(
                    // font-portal: portaled to <body>, escaping the app font scope (preflight off).
                    // antd tooltip is borderless with the overlay shadow (boxShadowSecondary),
                    // colorBgSpotlight bg + white text. Deliberately more compact than antd:
                    // 12px/16px type, 6px×10px padding, 6px radius — a 28px single-line pill.
                    "z-50 box-border w-fit rounded-control-sm bg-colorBgSpotlight px-2.5 py-1.5 text-field-sm leading-4 text-colorTextLightSolid shadow-overlay font-portal",
                    // Soft width cap (matches antd's default tooltip max width) — not a control dim.
                    // break-words: the cap alone can't contain an unbreakable token (an event key,
                    // an id, a URL), which otherwise runs straight out of the tooltip's background.
                    "max-w-[250px] break-words",
                    className,
                )}
                {...props}
            >
                {children}
                <TooltipShortcutKeys shortcut={shortcut} />
                {/* Same fill as bg; Radix renders it as an SVG triangle. */}
                <TooltipPrimitive.Arrow className="fill-colorBgSpotlight" />
            </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
    )
}

export {Tooltip, TooltipTrigger, TooltipContent, TooltipProvider}
