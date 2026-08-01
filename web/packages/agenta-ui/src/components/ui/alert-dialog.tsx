import * as React from "react"

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"
import {X} from "lucide-react"

import {buttonVariants} from "./button"
import {cn} from "./utils"

/**
 * AlertDialog — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skinned to antd's confirm `Modal`
 * (`Modal.confirm` / a modal that forces a choice: no close X, dismiss only via an action).
 *
 * Shares Dialog's measured chrome (overlay = colorBgMask; content = colorBgElevated,
 * borderless, radius borderRadiusLG, contentPadding 20/24, shadow-dialog, width 520px,
 * centered). Action = primary Button, Cancel = outline Button (styled via buttonVariants).
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
                // antd mask = colorBgMask over the whole viewport; fades in/out. (Same as Dialog.)
                "fixed inset-0 z-50 bg-colorBgMask",
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
                className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            >
                <AlertDialogPrimitive.Content
                    data-slot="alert-dialog-content"
                    className={cn(
                        // Same measured chrome as DialogContent (antd Modal). gap-3 (12px) matches
                        // antd's rendered section rhythm (title→body and body→footer both 12px; box 132px).
                        "relative pointer-events-auto",
                        "box-border flex flex-col gap-3 w-full max-w-[520px]",
                        // radius 16px = the app's EnhancedModal (`style={{borderRadius:16}}`), NOT
                        // antd's raw borderRadiusLG (10px). Candidate token: control-xl.
                        "bg-colorBgElevated text-colorText shadow-dialog rounded-[16px] font-portal",
                        "py-5 px-6",
                        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showCloseButton ? (
                        // Dismiss = cancel (antd close X behaviour). Same chrome as DialogContent's X.
                        <AlertDialogPrimitive.Cancel
                            data-slot="alert-dialog-close-x"
                            className={cn(
                                "absolute right-[13px] top-[13px] box-border p-0 bg-transparent border-0 font-[inherit]",
                                "flex size-7 items-center justify-center rounded-control-sm",
                                "text-colorIcon cursor-pointer outline-none transition-colors",
                                "hover:bg-fill-quaternary hover:text-colorIconHover",
                                "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring",
                            )}
                            aria-label="Close"
                        >
                            <X className="size-3.5" />
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
            // antd footer: buttons right-aligned; the 12px gap above comes from the content's
            // gap-3. gap-2 here is the horizontal spacing between the footer buttons.
            className={cn("flex flex-row items-center justify-end gap-2", className)}
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
            // antd `.ant-modal-title`: 16px/20px, weight 600, colorTextHeading.
            className={cn("m-0 text-base font-semibold leading-5 text-colorTextHeading", className)}
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
            // antd `.ant-modal-body`: 12px/20px colorText.
            className={cn("m-0 text-field-md text-colorText", className)}
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
