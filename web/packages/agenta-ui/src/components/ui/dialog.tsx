import * as React from "react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import {X} from "lucide-react"

import {Button} from "./button"
import {cn} from "./utils"

/**
 * Dialog — the shadcn dialog on Radix, styled through the token bridge.
 * antd Modal mapping: onCancel→onOpenChange(false), getContainer→container, closable→showCloseButton.
 */

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
    return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
    return (
        <DialogPrimitive.Overlay
            data-slot="dialog-overlay"
            className={cn(
                // 10% black mask with a light blur where supported.
                "fixed inset-0 isolate z-50 bg-black/10 supports-[backdrop-filter]:backdrop-blur-[4px]",
                "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
                className,
            )}
            {...props}
        />
    )
}

function DialogContent({
    className,
    children,
    container,
    showCloseButton = true,
    closeIcon,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
    /** Portal target; defaults to document.body. */
    container?: HTMLElement | null
    /** Renders the top-right close X. */
    showCloseButton?: boolean
    /** Replaces the default X icon. */
    closeIcon?: React.ReactNode
}) {
    return (
        <DialogPortal container={container}>
            <DialogOverlay />
            {/* Flex-centred, not transform-centred: the zoom keyframes would overwrite a translate. */}
            <div
                data-slot="dialog-positioner"
                // p-4 keeps a phone-width modal off the viewport edges.
                className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
                <DialogPrimitive.Content
                    data-slot="dialog-content"
                    className={cn(
                        // font-portal: portalled to <body>, outside the app font scope (preflight off).
                        "relative pointer-events-auto font-portal",
                        "box-border flex max-h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto",
                        // Hairline ring instead of a shadow; color-mix because v3 can't alpha a var() colour.
                        "rounded-xl bg-popover p-4 text-sm text-popover-foreground outline-none",
                        "ring-1 ring-[color:color-mix(in_srgb,var(--ag-colorText)_10%,transparent)]",
                        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showCloseButton && (
                        <DialogPrimitive.Close data-slot="dialog-close-x" asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="absolute right-2 top-2"
                                aria-label="Close"
                            >
                                {closeIcon ?? <X />}
                            </Button>
                        </DialogPrimitive.Close>
                    )}
                </DialogPrimitive.Content>
            </div>
        </DialogPortal>
    )
}

function DialogHeader({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="dialog-header"
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    )
}

function DialogFooter({
    className,
    showCloseButton = false,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    /** Appends an outline "Close" button that dismisses the dialog. */
    showCloseButton?: boolean
}) {
    return (
        <div
            data-slot="dialog-footer"
            // Full-bleed muted band (-m undoes the content's p-4); stacked on a phone, a row from sm.
            // border-0 first: preflight is off, so `border-solid` alone would paint every side.
            className={cn(
                "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl p-4 sm:flex-row sm:justify-end",
                "border-0 border-t border-solid border-border",
                "bg-[color:color-mix(in_srgb,var(--ag-colorFillTertiary)_50%,transparent)]",
                className,
            )}
            {...props}
        >
            {children}
            {showCloseButton && (
                <DialogPrimitive.Close asChild>
                    <Button variant="outline">Close</Button>
                </DialogPrimitive.Close>
            )}
        </div>
    )
}

function DialogTitle({className, ...props}: React.ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            // m-0 resets the UA <h2> margin (preflight off).
            className={cn("m-0 text-base font-medium leading-none", className)}
            {...props}
        />
    )
}

function DialogDescription({
    className,
    ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
    return (
        <DialogPrimitive.Description
            data-slot="dialog-description"
            // m-0 resets the UA <p> margin (preflight off).
            className={cn(
                "m-0 text-sm text-muted-foreground [&_a]:underline [&_a]:underline-offset-[3px] [&_a:hover]:text-foreground",
                className,
            )}
            {...props}
        />
    )
}

export {
    Dialog,
    DialogTrigger,
    DialogPortal,
    DialogOverlay,
    DialogContent,
    DialogClose,
    DialogHeader,
    DialogFooter,
    DialogTitle,
    DialogDescription,
}
