import * as React from "react"

import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    type TooltipShortcut,
    TooltipTrigger,
} from "../../primitives/tooltip"

/**
 * A label stays shut while its own menu or popover is open, and on focus a script moved there
 * after a pointer click (a menu returning focus, a panel focusing its first control).
 */
const shouldOpen = (el: HTMLElement) => {
    if (el.matches('[aria-expanded="true"]') || el.querySelector('[aria-expanded="true"]')) {
        return false
    }
    const active = document.activeElement as HTMLElement | null
    const focused = Boolean(active) && (el === active || el.contains(active))
    if (focused && !el.matches(":hover") && !active?.matches(":focus-visible")) return false
    return true
}

export interface SimpleTooltipProps {
    /** Tooltip body. Empty/undefined renders the child bare — antd `Tooltip title` semantics. */
    title?: React.ReactNode
    side?: React.ComponentProps<typeof TooltipContent>["side"]
    /** Keyboard shortcut printed after `title` as `Kbd` caps, e.g. `["⌘", "K"]`. */
    shortcut?: TooltipShortcut
    className?: string
    /** Must accept a forwarded ref (the trigger renders asChild). */
    children: React.ReactElement
}

/**
 * The one-liner tooltip — antd's `<Tooltip title>` shape over the Radix primitive, for the
 * common label-on-hover case. Compose the parts directly when you need controlled open state,
 * custom delays, or portalling into a specific container.
 *
 * Prefer not to hand this a child that is itself an `asChild` Radix trigger (`PopoverTrigger`,
 * `DropdownMenuTrigger`, …): both collapse onto one element and Radix composes their refs into
 * one nested chain. Wrap the inner trigger in a `<span className="inline-flex">` instead —
 * focus still reaches the tooltip, because React's `onFocus` bubbles from the child.
 *
 * Two things are known and worth not relearning:
 * - Wrapping here for EVERY caller was tried and reverted. The span becomes the flex item, so
 *   children relying on being one themselves (`ml-auto`, `min-w-0`, `truncate`) break.
 * - This trigger IS implicated in the `/evaluations` "Maximum update depth exceeded" loop:
 *   stubbing SimpleTooltip to render `children` bare makes the page render. But un-nesting the
 *   three trigger-in-trigger call sites did NOT fix it, so the nesting is not the mechanism.
 *   The live crash detaches a composed ref chain that ends in a `setState`
 *   (`dispatchSetState ← setRef ← … ← safelyDetachRef ← commitDeletionEffectsOnFiber`).
 *   Unresolved — do not assume the un-nesting above closed it.
 */
export function SimpleTooltip({title, side, shortcut, className, children}: SimpleTooltipProps) {
    const triggerRef = React.useRef<HTMLButtonElement>(null)
    const [open, setOpen] = React.useState(false)
    const handleOpenChange = React.useCallback((next: boolean) => {
        const el = triggerRef.current
        if (next && el && !shouldOpen(el)) return
        setOpen(next)
    }, [])
    if (title == null || title === "") return children
    return (
        <TooltipProvider delayDuration={300}>
            <Tooltip open={open} onOpenChange={handleOpenChange}>
                <TooltipTrigger ref={triggerRef} asChild>
                    {children}
                </TooltipTrigger>
                <TooltipContent side={side} shortcut={shortcut} className={className}>
                    {title}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
