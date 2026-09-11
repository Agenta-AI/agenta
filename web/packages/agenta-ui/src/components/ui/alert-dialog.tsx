import * as React from "react"

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import {X} from "lucide-react"

import {Button, buttonVariants} from "./button"
import {cn} from "./utils"

/**
 * AlertDialog — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). The confirm-style modal (`Modal.confirm` / a
 * modal that forces a choice).
 *
 * Shares Dialog's Nova chrome (see ./dialog.tsx): blurred 10% mask, 16px-padded popover
 * surface with a hairline ring, 520px default width, footer band. Action = primary Button,
 * Cancel = outline Button (styled via buttonVariants).
 *
 * antd → @agenta/ui mapping:
 *   Modal.confirm({title, content, onOk, onCancel})
 *     → <AlertDialog><AlertDialogContent><AlertDialogHeader>
 *         <AlertDialogTitle/><AlertDialogDescription/></AlertDialogHeader>
 *       <AlertDialogFooter><AlertDialogCancel/><AlertDialogAction/></AlertDialogFooter>
 *       </AlertDialogContent></AlertDialog>
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
                // Nova mask, same as Dialog.
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
    showCloseButton = true,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content> & {
    /** Portal target. Defaults to document.body; pass an element to render inline (e.g. a
     * scroll container, or a forced-open parity story). */
    container?: HTMLElement | null
    /** antd `closable`. The app's confirm modals show a top-right close X (dismiss = cancel);
     * default true to match them. Set false for a strict forced-choice alert. */
    showCloseButton?: boolean
}) {
    return (
        <AlertDialogPortal container={container}>
            <AlertDialogOverlay />
            {/* Center via a flex positioner, NOT a transform: the scale-only animate-dialog
                keyframes set `transform`, which would drop a `-translate-*` centering offset
                mid-zoom and make the modal jump. (Same pattern as DialogContent.) */}
            <div
                data-slot="alert-dialog-positioner"
                className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
                <AlertDialogPrimitive.Content
                    data-slot="alert-dialog-content"
                    className={cn(
                        // Same Nova chrome as DialogContent.
                        "relative pointer-events-auto font-portal",
                        "box-border flex max-h-full w-full max-w-[520px] flex-col gap-4 overflow-y-auto",
                        "rounded-xl bg-popover p-4 text-sm text-popover-foreground outline-none",
                        "ring-1 ring-[color:color-mix(in_srgb,var(--ag-colorText)_10%,transparent)]",
                        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showCloseButton ? (
                        // Dismiss = cancel. Same ghost icon Button as DialogContent's X.
                        <AlertDialogPrimitive.Cancel data-slot="alert-dialog-close-x" asChild>
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                className="absolute right-2 top-2"
                                aria-label="Close"
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
            className={cn("flex flex-col gap-2", className)}
            {...props}
        />
    )
}

function AlertDialogFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="alert-dialog-footer"
            // Nova footer band, same as DialogFooter.
            className={cn(
                "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl p-4 sm:flex-row sm:justify-end",
                "border-0 border-t border-solid border-border",
                "bg-[color:color-mix(in_srgb,var(--ag-colorFillTertiary)_50%,transparent)]",
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
            // Nova title: 16px, weight 500. m-0 resets the UA margin (preflight off).
            className={cn("m-0 text-base font-medium leading-none", className)}
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
            // Nova description: 14px muted.
            className={cn("m-0 text-sm text-muted-foreground", className)}
            {...props}
        />
    )
}

function AlertDialogAction({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
    // antd confirm OK = primary Button.
    return (
        <AlertDialogPrimitive.Action
            data-slot="alert-dialog-action"
            className={cn(buttonVariants(), className)}
            {...props}
        />
    )
}

function AlertDialogCancel({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
    // antd confirm Cancel = outline (default) Button.
    return (
        <AlertDialogPrimitive.Cancel
            data-slot="alert-dialog-cancel"
            className={cn(buttonVariants({variant: "outline"}), className)}
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
