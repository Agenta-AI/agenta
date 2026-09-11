import {type ReactNode} from "react"

import {
    Popover,
    PopoverContent,
    PopoverTrigger,
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@agenta/ui/ui"

import {useMediaQuery} from "../lib/useMediaQuery"
import {cn} from "../lib/utils"

/** The phone/desktop line every automation picker reads — the app's own `lg`. */
export const PICKER_WIDE_QUERY = "(min-width: 64rem)"

/** True from `lg` up: the picker is a popover, and its panels have room to sit side by side. */
export const usePickerIsWide = () => useMediaQuery(PICKER_WIDE_QUERY)

/**
 * The one overlay the automation pickers open from: a popover anchored to the field from `lg` up,
 * a bottom sheet below it.
 *
 * The design anchors these to the control, which is right on a desktop and wrong on a phone — a
 * 320px popover hanging off a full-width field is a sheet that forgot to be one. The two are
 * different trees, not two skins of one tree (different portals, different dismiss gestures,
 * different focus behaviour), so the breakpoint is read in JS: no CSS rule can swap a `Popover`
 * for a `Sheet`, and rendering both would mount every child twice.
 *
 * `lg` is the app's own phone/desktop line (`ScreenScaffold`, `SheetContent side="responsive"`),
 * so a picker changes shape at the same width the screen around it does. Crossing that line
 * remounts the children — an in-flight pick is lost, which only happens on a live window resize.
 */
export const PickerOverlay = ({
    open,
    onOpenChange,
    title,
    trigger,
    contentClassName,
    children,
}: {
    open: boolean
    onOpenChange: (next: boolean) => void
    /**
     * Names the surface. The sheet shows it as its header; the popover only exposes it to
     * assistive tech — anchored under the field's own label, a repeat of that label is noise.
     */
    title: string
    /** The field control itself — it IS the trigger, so it takes the open/close handlers. */
    trigger: ReactNode
    contentClassName?: string
    children: ReactNode
}) => {
    // SSR default false: the server has no viewport, and a phone is the narrower guess to be
    // wrong about — the sheet renders correctly at any width, a popover does not.
    const isWide = usePickerIsWide()

    if (isWide) {
        return (
            <Popover open={open} onOpenChange={onOpenChange}>
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                <PopoverContent
                    align="start"
                    aria-label={title}
                    collisionPadding={16}
                    // As wide as the control that opened it: a menu narrower than its own field
                    // reads as a different surface rather than that field, opened.
                    // Radix does not bound a popover's height, so a long event list ran off the
                    // bottom of the window. `available-height` is the room left below the
                    // trigger, less a margin so the panel never sits flush against the window
                    // edge; the panes inside flex within it rather than each capping themselves
                    // at a guess. Bounding by the viewport instead was tried and is worse: the
                    // panel then hangs past the bottom of the window and takes Done with it.
                    className={cn(
                        "flex max-h-[calc(var(--radix-popover-content-available-height)-16px)] w-[var(--radix-popover-trigger-width)] flex-col gap-0 overflow-hidden p-0",
                        contentClassName,
                    )}
                >
                    {children}
                </PopoverContent>
            </Popover>
        )
    }

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetTrigger asChild>{trigger}</SheetTrigger>
            {/* The content panes below scroll on their own, so the sheet must not also scroll —
                two nested scrollers is how a footer ends up unreachable behind the keyboard. */}
            <SheetContent
                side="bottom"
                // No description on a picker; declaring none keeps Radix from warning about it.
                aria-describedby={undefined}
                // Taller than the sheet's 378px default: the schedule builder and an event's
                // filter form both run past it, and a body clipped at a fixed height is one
                // whose Done button is off screen.
                className="h-[min(85dvh,640px)] gap-0 overflow-hidden p-0"
            >
                <SheetHeader className="shrink-0 px-4 pb-2 pt-4">
                    <SheetTitle className="text-sm">{title}</SheetTitle>
                </SheetHeader>
                {children}
            </SheetContent>
        </Sheet>
    )
}
