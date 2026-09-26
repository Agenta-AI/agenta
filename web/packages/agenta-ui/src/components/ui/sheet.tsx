import * as React from "react"

import * as SheetPrimitive from "@radix-ui/react-dialog"
import {cva, type VariantProps} from "class-variance-authority"
import {X} from "lucide-react"

import {Button} from "./button"
import {touchTargetExpansion} from "./touch-target"
import {cn} from "./utils"

/**
 * Sheet — the shadcn sheet on Radix Dialog: a panel that slides in from a screen edge (antd Drawer).
 * antd mapping: onClose→onOpenChange(false), placement→side, getContainer→container, closable→showCloseButton.
 */

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetPortal(props: React.ComponentProps<typeof SheetPrimitive.Portal>) {
    return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetOverlay({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                // Same mask as Dialog.
                "fixed inset-0 isolate z-40 bg-black/10 supports-[backdrop-filter]:backdrop-blur-[4px]",
                "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
                className,
            )}
            {...props}
        />
    )
}

// `side` drives the edge, its hairline, the default size and the slide.
// border-0 first: preflight is off, so a bare `border-t` would paint every side.
// The left and right panels float: inset 8px from the viewport, rounded, and borderless (the
// mask and shadow separate them). The keyframes travel an extra 1rem so the panel clears that
// inset before it unmounts.

const sheetVariants = cva(
    [
        // No panel gap: the header and footer rules meet the body, which pads itself.
        "fixed z-50 box-border flex flex-col font-portal",
        // The container surface (antd Drawer's), not popover: a shade darker in dark mode.
        "bg-background text-sm text-foreground shadow-lg",
        "border-0 border-solid border-border",
    ],
    {
        variants: {
            side: {
                right: [
                    "inset-y-2 right-2 h-auto w-3/4 rounded-xl sm:max-w-sm",
                    "data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right",
                ],
                left: [
                    "inset-y-2 left-2 h-auto w-3/4 rounded-xl sm:max-w-sm",
                    "data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left",
                ],
                top: [
                    "inset-x-0 top-0 h-auto w-full border-b",
                    "data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top",
                ],
                bottom: [
                    "inset-x-0 bottom-0 h-auto w-full border-t",
                    "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
                ],
                // The app's form-panel idiom, promoted from web/mobile's local sheet: a bottom
                // sheet on a phone, the floating right-edge drawer from `lg` up. The literal edges stay
                // literal. A panel this wide would otherwise stretch a two-field form across a
                // tablet, so the sheet half caps and centres and rounds its top.
                responsive: [
                    "inset-x-0 bottom-0 mx-auto h-auto max-h-[85vh] w-full max-w-[560px] rounded-t-2xl border-t max-lg:shadow-drawer-bottom",
                    "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
                    // Every bottom-sheet property is unset explicitly: Tailwind would otherwise
                    // keep the narrower rule. The width reads a variable so a caller's `width`
                    // applies at `lg` only, where there is room for it.
                    "lg:inset-x-auto lg:mx-0 lg:max-h-none lg:w-[var(--ag-sheet-responsive-width,480px)] lg:max-w-[90vw]",
                    "lg:inset-y-2 lg:right-2 lg:rounded-xl lg:border-0",
                    "lg:data-[state=open]:animate-sheet-in-right lg:data-[state=closed]:animate-sheet-out-right",
                ],
            },
        },
        defaultVariants: {side: "right"},
    },
)

function SheetContent({
    className,
    children,
    side = "right",
    container,
    ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> &
    VariantProps<typeof sheetVariants> & {
        /** Portal target; defaults to document.body. */
        container?: HTMLElement | null
    }) {
    return (
        <SheetPortal container={container}>
            <SheetOverlay />
            <SheetPrimitive.Content
                data-slot="sheet-content"
                data-side={side}
                className={cn(sheetVariants({side}), className)}
                {...props}
            >
                {children}
            </SheetPrimitive.Content>
        </SheetPortal>
    )
}

function SheetHeader({
    className,
    children,
    showCloseButton = true,
    ...props
}: React.ComponentProps<"div"> & {
    /** Renders the close button after the title, at the right edge. */
    showCloseButton?: boolean
}) {
    return (
        <div
            data-slot="sheet-header"
            // A column for title and description, then the close button.
            // No rule under it: the title's spacing separates it from the body.
            className={cn(
                "box-border flex items-center gap-2 p-4",
                className,
            )}
            {...props}
        >
            <div data-slot="sheet-header-content" className="flex min-w-0 flex-1 flex-col gap-0.5">
                {children}
            </div>
            {showCloseButton && (
                <SheetPrimitive.Close data-slot="sheet-close" asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        // The header centres it on the title block, so a title with a description
                        // or a wrapped line still has it in the middle. -my-0.5 keeps the 28px
                        // button from growing a one-line (24px) header. The invisible
                        // expansion takes the 28px square to the 44px touch minimum; its 8px
                        // reach to the left stops at the header's own 8px gap, so it covers no
                        // part of the title.
                        className={cn(
                            "-my-0.5 shrink-0",
                            touchTargetExpansion({height: 28, width: 28}),
                        )}
                        aria-label="Close"
                    >
                        <X />
                    </Button>
                </SheetPrimitive.Close>
            )}
        </div>
    )
}

function SheetFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="sheet-footer"
            // Pinned to the bottom; stacked on a phone, a right-aligned row from sm. Dialog's
            // muted band instead of a rule; rounded-b-[inherit] follows the panel's own corners
            // (rounded when it floats, square on a bottom sheet).
            className={cn(
                "mt-auto box-border flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-end",
                "rounded-b-[inherit] bg-[color:color-mix(in_srgb,var(--ag-colorFillTertiary)_50%,transparent)]",
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
            // m-0 resets the UA <h2> margin (preflight off).
            className={cn("m-0 text-base font-medium text-foreground", className)}
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
            // m-0 resets the UA <p> margin (preflight off).
            className={cn("m-0 text-sm text-muted-foreground", className)}
            {...props}
        />
    )
}

export {
    Sheet,
    SheetTrigger,
    SheetPortal,
    SheetOverlay,
    SheetContent,
    SheetClose,
    SheetTitle,
    SheetDescription,
    SheetHeader,
    SheetFooter,
    sheetVariants,
}
