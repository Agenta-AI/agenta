import {type ReactNode} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"

import {Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger} from "@/components/ui/sheet"
import {useMediaQuery} from "@/lib/useMediaQuery"
import {cn} from "@/lib/utils"

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
    /** Names the surface. The sheet needs it for its accessible title; the popover shows it too. */
    title: string
    /** The field control itself — it IS the trigger, so it takes the open/close handlers. */
    trigger: ReactNode
    contentClassName?: string
    children: ReactNode
}) => {
    // SSR default false: the server has no viewport, and a phone is the narrower guess to be
    // wrong about — the sheet renders correctly at any width, a popover does not.
    const isWide = useMediaQuery("(min-width: 64rem)")

    if (isWide) {
        return (
            <Popover open={open} onOpenChange={onOpenChange}>
                <PopoverTrigger asChild>{trigger}</PopoverTrigger>
                <PopoverContent
                    align="start"
                    className={cn("flex flex-col gap-0 p-0", contentClassName)}
                >
                    <span className="text-foreground shrink-0 px-3 pb-1 pt-3 text-xs font-medium">
                        {title}
                    </span>
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
                className="gap-0 overflow-hidden p-0"
            >
                <SheetHeader className="shrink-0 px-4 pb-2 pt-4">
                    <SheetTitle className="text-sm">{title}</SheetTitle>
                </SheetHeader>
                {children}
            </SheetContent>
        </Sheet>
    )
}
