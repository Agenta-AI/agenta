import * as React from "react"

import {XIcon} from "lucide-react"
import {Dialog as SheetPrimitive} from "radix-ui"

import {cn} from "@/lib/utils"

function Sheet({...props}: React.ComponentProps<typeof SheetPrimitive.Root>) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({...props}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({...props}: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({...props}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                // No dim on a phone. iOS composites the status-bar strip from the page's top
                // colour, so any alpha here darkens that strip while the drawer beside it stays
                // light — the seam that reads as the drawer failing to reach the top. With the
                // scrim clear the strip lands on the body colour, which is the rail's own.
                "fixed inset-0 z-50 bg-transparent data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 lg:bg-black/50",
                className,
            )}
            {...props}
        />
    )
}

function SheetContent({
    className,
    children,
    side = "right",
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
    /**
     * `responsive` is the app's form-panel idiom: a bottom sheet on a phone, the right-edge
     * drawer the desktop uses from `lg` up. The literal edges stay literal.
     */
    side?: "top" | "right" | "bottom" | "left" | "responsive"
    showCloseButton?: boolean
}) {
    return (
        <SheetPortal>
            <SheetOverlay />
            <SheetPrimitive.Content
                data-slot="sheet-content"
                className={cn(
                    "fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500",
                    // The phone-width shadows carry the separation the scrim used to: below lg the
                    // overlay is clear, so the panel's own edge is all that lifts it off the page.
                    // Cast away from the edge the sheet is anchored to.
                    side === "right" &&
                        "inset-y-0 right-0 h-full w-3/4 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm max-lg:shadow-[-8px_0_24px_-6px_rgb(0_0_0/0.28)]",
                    side === "left" &&
                        "inset-y-0 left-0 h-full w-3/4 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm max-lg:shadow-[8px_0_24px_-6px_rgb(0_0_0/0.28)]",
                    side === "top" &&
                        "inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top",
                    // A bottom sheet is full-bleed on a phone, but a window this wide would
                    // stretch a two-field form across the whole screen — so it caps and centres,
                    // and rounds its top the way it does against a phone's edge.
                    side === "bottom" &&
                        "inset-x-0 bottom-0 mx-auto h-auto max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:border-x max-lg:shadow-[0_-8px_24px_-6px_rgb(0_0_0/0.28)]",
                    // Bottom sheet on a phone…
                    side === "responsive" &&
                        "inset-x-0 bottom-0 mx-auto h-auto max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom max-lg:shadow-[0_-8px_24px_-6px_rgb(0_0_0/0.28)]",
                    // …and the app's right-edge drawer from lg up, which is where the settings
                    // rail also stops being a phone layout. Every bottom-sheet property is
                    // unset explicitly — Tailwind would otherwise keep the narrower rule.
                    side === "responsive" &&
                        "lg:inset-x-auto lg:inset-y-0 lg:right-0 lg:mx-0 lg:h-full lg:max-h-none lg:w-[480px] lg:max-w-[90vw] lg:rounded-none lg:border-l lg:border-t-0 lg:data-[state=closed]:slide-out-to-right lg:data-[state=open]:slide-in-from-right lg:data-[state=closed]:slide-out-to-bottom-0 lg:data-[state=open]:slide-in-from-bottom-0",
                    className,
                )}
                {...props}
            >
                {children}
                {showCloseButton && (
                    <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
                        <XIcon className="size-4" />
                        <span className="sr-only">Close</span>
                    </SheetPrimitive.Close>
                )}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
}

function SheetHeader({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-header"
            className={cn("flex flex-col gap-1.5 p-4", className)}
            {...props}
        />
    )
}

function SheetFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            // Stacked on a phone (primary within thumb reach, first in DOM order), one row
            // from sm up — reversed, so the primary still lands on the right.
            className={cn(
                "mt-auto flex flex-col gap-2 p-4 sm:flex-row-reverse sm:justify-start",
                className,
            )}
            {...props}
        />
    )
}

function SheetTitle({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Title>) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn("font-semibold text-foreground", className)}
            {...props}
        />
    )
}

function SheetDescription({
    className,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
    return (
        <SheetPrimitive.Description
            data-slot="sheet-description"
            className={cn("text-sm text-muted-foreground", className)}
            {...props}
        />
    )
}

export {
    Sheet,
    SheetTrigger,
    SheetClose,
    SheetContent,
    SheetHeader,
    SheetFooter,
    SheetTitle,
    SheetDescription,
}
