import * as React from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import {X} from "lucide-react"

import {Button, ButtonSizeContext, buttonVariants} from "./button"
import {cn} from "./utils"

/**
 * AlertDialog — the shadcn confirm dialog on Radix, drawn on the canvas scale: 400px wide, a
 * 14px/600 title, 13px secondary text and 28px buttons in a row under it, with no footer band.
 * Replaces antd Modal.confirm: Action = primary Button, Cancel = outline Button.
 */

function AlertDialog(props: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger(props: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
    return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />
}

function AlertDialogPortal(props: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
    return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
    return (
        <AlertDialogPrimitive.Overlay
            data-slot="alert-dialog-overlay"
            className={cn(
                // Same mask as Dialog.
                "fixed inset-0 isolate z-50 bg-black/10 supports-[backdrop-filter]:backdrop-blur-[4px]",
                "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out",
                className,
            )}
            {...props}
        />
    )
}

function AlertDialogContent({
    className,
    container,
    children,
    showCloseButton = false,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
    /** Portal target; defaults to document.body. A given container (positioned) is the dialog's
     * whole world: mask and dialog cover it, not the window. */
    container?: HTMLElement | null
    /** No close X by default (an alert forces a choice); opting in makes dismiss = cancel. */
    showCloseButton?: boolean
}) {
    const t = useT(commonCatalog)
    return (
        <AlertDialogPortal container={container}>
            <AlertDialogOverlay className={container ? "absolute" : undefined} />
            {/* Flex-centred, not transform-centred: the zoom keyframes would overwrite a translate. */}
            <div
                data-slot="alert-dialog-positioner"
                className={cn(
                    "inset-0 z-50 flex items-center justify-center p-4 pointer-events-none",
                    container ? "absolute" : "fixed",
                )}
            >
                <AlertDialogPrimitive.Content
                    data-slot="alert-dialog-content"
                    className={cn(
                        // Same chrome as DialogContent.
                        "relative pointer-events-auto font-portal",
                        "box-border flex max-h-full w-full max-w-[400px] flex-col gap-2 overflow-y-auto",
                        "rounded-[12px] bg-popover p-5 text-sm text-popover-foreground outline-none",
                        "ring-1 ring-[color:color-mix(in_srgb,var(--ag-colorText)_10%,transparent)] shadow-dialog",
                        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
                        className,
                    )}
                    {...props}
                >
                    <ButtonSizeContext.Provider value="compact">
                        {children}
                    </ButtonSizeContext.Provider>
                    {showCloseButton ? (
                        // Dismiss = cancel.
                        <AlertDialogPrimitive.Cancel data-slot="alert-dialog-close-x" asChild>
                            <Button
                                variant="ghost"
                                size="icon-compact"
                                className="absolute right-2 top-2"
                                aria-label={t("common.close")}
                            >
                                <X />
                            </Button>
                        </AlertDialogPrimitive.Cancel>
                    ) : null}
                </AlertDialogPrimitive.Content>
            </div>
        </AlertDialogPortal>
    )
}

function AlertDialogHeader({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-dialog-header"
            className={cn("flex flex-col gap-1", className)}
            {...props}
        />
    )
}

function AlertDialogFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-dialog-footer"
            // The buttons sit in a row under the text, with no band. Stacked on a phone, where each
            // one grows to the 44px touch minimum.
            className={cn(
                "mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
                "max-md:[&>*]:h-11",
                className,
            )}
            {...props}
        />
    )
}

function AlertDialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
    return (
        <AlertDialogPrimitive.Title
            data-slot="alert-dialog-title"
            // m-0 resets the UA <h2> margin (preflight off).
            className={cn("m-0 text-sm font-semibold", className)}
            {...props}
        />
    )
}

function AlertDialogDescription({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
    return (
        <AlertDialogPrimitive.Description
            data-slot="alert-dialog-description"
            // m-0 resets the UA <p> margin (preflight off).
            className={cn("m-0 text-[13px] leading-5 text-colorTextSecondary", className)}
            {...props}
        />
    )
}

function AlertDialogAction({
    className,
    asChild,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
    // With `asChild` the child Button owns its look, so the default variant is not merged over it.
    return (
        <AlertDialogPrimitive.Action
            data-slot="alert-dialog-action"
            asChild={asChild}
            className={cn(!asChild && buttonVariants({size: "compact"}), className)}
            {...props}
        />
    )
}

function AlertDialogCancel({
    className,
    asChild,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
    // Same `asChild` rule as Action.
    return (
        <AlertDialogPrimitive.Cancel
            data-slot="alert-dialog-cancel"
            asChild={asChild}
            className={cn(
                !asChild && buttonVariants({variant: "outline", size: "compact"}),
                className,
            )}
            {...props}
        />
    )
}

export {
    AlertDialog,
    AlertDialogTrigger,
    AlertDialogPortal,
    AlertDialogOverlay,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogAction,
    AlertDialogCancel,
}
