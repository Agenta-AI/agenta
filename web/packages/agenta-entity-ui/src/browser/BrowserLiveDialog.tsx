import type {ReactNode} from "react"

import type {BrowserLiveTarget} from "@agenta/entities/browserProfile"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {BrowserLiveView} from "./BrowserLiveView"

export interface BrowserLiveDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: ReactNode
    /** Null while the browser is not ready yet (e.g. a login still starting). */
    target: BrowserLiveTarget | null
    autoTakeControl?: boolean
    /** Shown in place of the live view while `target` is null. */
    placeholder?: ReactNode
    footer?: ReactNode
}

export const BrowserLiveDialog = ({
    open,
    onOpenChange,
    title,
    description,
    target,
    autoTakeControl,
    placeholder,
    footer,
}: BrowserLiveDialogProps) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
            className="max-w-5xl max-sm:fixed max-sm:inset-0 max-sm:max-h-none max-sm:max-w-none max-sm:rounded-none"
            onInteractOutside={(event) => event.preventDefault()}
        >
            <DialogHeader className="pr-8">
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription className={description ? undefined : "sr-only"}>
                    {description ?? title}
                </DialogDescription>
            </DialogHeader>
            {target ? (
                <BrowserLiveView target={target} autoTakeControl={autoTakeControl} />
            ) : (
                <div className="flex aspect-[16/10] w-full flex-1 items-center justify-center rounded-lg border border-solid border-border bg-muted p-4 text-center text-sm text-muted-foreground">
                    {placeholder}
                </div>
            )}
            {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
    </Dialog>
)
