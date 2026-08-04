import * as React from "react"

import * as DialogPrimitive from "@radix-ui/react-dialog"
import {X} from "lucide-react"

import {cn} from "./utils"

/**
 * Dialog — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skinned to antd's `Modal`.
 *
 * antd → @agenta/ui mapping:
 *   <Modal open onCancel title footer width>
 *     → <Dialog open onOpenChange><DialogTrigger/><DialogContent>
 *         <DialogHeader><DialogTitle/><DialogDescription/></DialogHeader>
 *         …body… <DialogFooter/></DialogContent></Dialog>
 *   open→open · onCancel→onOpenChange(false) · title→DialogTitle · footer→DialogFooter ·
 *   getContainer→container (on DialogContent) · closable→showCloseButton.
 *
 * Chrome measured against antd Modal (light + dark): content bg colorBgElevated,
 * borderless, radius borderRadiusLG, contentPadding, shadow boxShadow (shadow-dialog),
 * default width 520px, centered. Mask = colorBgMask covering the viewport.
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
                // antd mask = colorBgMask over the whole viewport; fades in/out.
                "fixed inset-0 z-50 bg-colorBgMask",
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
    /** Portal target. Defaults to document.body; pass an element to render inline (e.g. a
     * scroll container, or a forced-open parity story). */
    container?: HTMLElement | null
    /** antd `closable`. Renders the top-right close X. */
    showCloseButton?: boolean
    /** antd `closeIcon`. Overrides the default X (e.g. a caller-owned icon carrying its own
     * `data-tour`/test attributes) — falls back to the default X when omitted. */
    closeIcon?: React.ReactNode
}) {
    return (
        <DialogPortal container={container}>
            <DialogOverlay />
            {/* Center via a flex positioner, NOT a transform on the content: the scale-only
                animate-dialog-in/out keyframes set `transform`, which replaces any static
                transform — so a `-translate-*` centering offset would be dropped mid-zoom and
                the modal would jump. pointer-events-none lets clicks fall through to the mask. */}
            <div
                data-slot="dialog-positioner"
                className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
            >
                <DialogPrimitive.Content
                    data-slot="dialog-content"
                    className={cn(
                        // font-portal: portals to <body>, escaping the app font scope (preflight off).
                        // box-border: preflight off, so padding must sit inside the width.
                        // antd Modal content is borderless, radius borderRadiusLG, bg colorBgElevated,
                        // shadow boxShadow (shadow-dialog). Centered by the positioner above.
                        "relative pointer-events-auto",
                        // gap-3 (12px): antd's rendered section rhythm is title→body 12px and
                        // body→footer 12px (its box is 132px). antd's `.ant-modal-header`
                        // margin-bottom is a literal 8px, but its block layout renders a 12px
                        // header→body gap; matching the rendered 12px both places keeps parity.
                        "box-border flex flex-col gap-3 w-full max-w-[520px]",
                        // radius 16px = the app's EnhancedModal (`style={{borderRadius:16}}`), NOT
                        // antd's raw borderRadiusLG (10px). Candidate token: control-xl.
                        "bg-colorBgElevated text-colorText shadow-dialog rounded-[16px] font-portal",
                        // antd contentPadding: 20px vertical, 24px horizontal.
                        "py-5 px-6",
                        "data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out",
                        className,
                    )}
                    {...props}
                >
                    {children}
                    {showCloseButton && (
                        <DialogPrimitive.Close
                            data-slot="dialog-close-x"
                            className={cn(
                                // Native <button> under preflight-off: reset bg/font/padding.
                                // antd close: 28px square, offset 13px, radius 6px, colorIcon.
                                "absolute right-[13px] top-[13px] box-border p-0 bg-transparent border-0 font-[inherit]",
                                "flex size-7 items-center justify-center rounded-control-sm",
                                "text-colorIcon cursor-pointer outline-none transition-colors",
                                "hover:bg-fill-quaternary hover:text-colorIconHover",
                                "focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-[-3px] focus-visible:outline-focus-ring",
                            )}
                            aria-label="Close"
                        >
                            {/* antd close icon is 14px; size via class, not the lucide size prop. */}
                            {closeIcon ?? <X className="size-3.5" />}
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

function DialogFooter({className, ...props}: React.ComponentProps<"div">) {
    return (
        <div
            data-slot="dialog-footer"
            // antd footer: buttons right-aligned; the 12px gap above comes from the content's
            // gap-3. gap-2 here is the horizontal spacing between the footer buttons.
            className={cn("flex flex-row items-center justify-end gap-2", className)}
            {...props}
        />
    )
}

function DialogTitle({className, ...props}: React.ComponentProps<typeof DialogPrimitive.Title>) {
    return (
        <DialogPrimitive.Title
            data-slot="dialog-title"
            // antd `.ant-modal-title`: 16px/20px, weight 600, colorTextHeading. m-0 resets the
            // UA <h2> margin (preflight off) so section spacing comes only from the layout gap.
            className={cn("m-0 text-base font-semibold leading-5 text-colorTextHeading", className)}
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
            // antd `.ant-modal-body`: 12px/20px colorText. m-0 resets the UA <p> margin.
            className={cn("m-0 text-field-md text-colorText", className)}
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
