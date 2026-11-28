import * as React from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {XIcon} from "@phosphor-icons/react"
import * as SheetPrimitive from "@radix-ui/react-dialog"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "../foundation/utils/cn"

import {Button} from "./button"

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

// Reduced motion: collapse the duration, not `animation: none` (Radix waits for `animationend`).
const SHEET_REDUCED_MOTION = "motion-reduce:[animation-duration:1ms]!"

function SheetOverlay({className, ...props}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
    return (
        <SheetPrimitive.Overlay
            data-slot="sheet-overlay"
            className={cn(
                // The one scrim behind dialogs and sheets (`overlay`).
                "fixed inset-0 isolate z-40 bg-overlay",
                "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
                SHEET_REDUCED_MOTION,
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
        "bg-background text-body text-foreground shadow-modal",
        "border-0 border-solid border-border",
        SHEET_REDUCED_MOTION,
    ],
    {
        variants: {
            side: {
                right: [
                    "inset-y-2 right-2 h-auto w-3/4 rounded-xl sm:max-w-sm",
                    "data-[state=open]:animate-sheet-in-right data-[state=closed]:animate-sheet-out-right",
                ],
                // The phone's sidebar sheet: the rail's own surface, radius 12 as the design draws it.
                left: [
                    "inset-y-2 left-2 h-auto w-3/4 rounded-xl bg-muted sm:max-w-sm",
                    "data-[state=open]:animate-sheet-in-left data-[state=closed]:animate-sheet-out-left",
                ],
                top: [
                    "inset-x-0 top-0 h-auto w-full border-b",
                    "data-[state=open]:animate-sheet-in-top data-[state=closed]:animate-sheet-out-top",
                ],
                // The base `shadow-modal` above it instead of a hairline.
                bottom: [
                    "inset-x-0 bottom-0 h-auto w-full",
                    "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
                ],
                // The app's form-panel idiom, promoted from web/mobile's local sheet: a full-width
                // bottom sheet below `lg`, the floating right-edge drawer from `lg` up. The literal
                // edges stay literal.
                responsive: [
                    "inset-x-0 bottom-0 h-auto max-h-[85dvh] w-full rounded-t-xl border-t",
                    "data-[state=open]:animate-sheet-in-bottom data-[state=closed]:animate-sheet-out-bottom",
                    // Every bottom-sheet property is unset explicitly: Tailwind would otherwise
                    // keep the narrower rule. The width reads a variable so a caller's `width`
                    // applies at `lg` only, where there is room for it.
                    "lg:inset-x-auto lg:max-h-none lg:w-[var(--ag-sheet-responsive-width,480px)] lg:max-w-[90vw]",
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
    const t = useT(commonCatalog)
    return (
        <div
            data-slot="sheet-header"
            // A column for title and description, then the close button.
            // No rule under it: the title's spacing separates it from the body.
            // One line: the close button centres on it. More than one (a description, a meta
            // row): it stays level with the title rather than floating between the lines.
            className={cn(
                "box-border flex items-center gap-2 p-4",
                "[&:has(>[data-slot=sheet-header-content]>:nth-child(2))]:items-start",
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
                        // Centred on a one-line header, level with the title's 24px line on a
                        // taller one. -my-0.5 keeps the 28px button from growing a one-line
                        // (24px) header, and centres it on that line when top-aligned.
                        className="-my-0.5 shrink-0"
                        aria-label={t("common.close")}
                    >
                        <XIcon />
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
                "rounded-b-[inherit] bg-[color:color-mix(in_srgb,var(--secondary)_50%,transparent)]",
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
            className={cn("m-0 text-title text-foreground", className)}
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
            className={cn("m-0 text-body text-muted-foreground", className)}
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
