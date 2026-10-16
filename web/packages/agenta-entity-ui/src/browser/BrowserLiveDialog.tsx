import type {ReactNode} from "react"

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
    /** Null while there is no session to show. */
    sessionId: string | null
    autoTakeControl?: boolean
    /** Shown in place of the live view while `sessionId` is null. */
    placeholder?: ReactNode
    footer?: ReactNode
}

export const BrowserLiveDialog = ({
    open,
    onOpenChange,
    title,
    description,
    sessionId,
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
            {sessionId ? (
                <BrowserLiveView sessionId={sessionId} autoTakeControl={autoTakeControl} />
            ) : (
                <div className="flex aspect-[16/10] w-full flex-1 items-center justify-center rounded-lg border border-solid border-border bg-muted p-4 text-center text-sm text-muted-foreground">
                    {placeholder}
                </div>
            )}
            {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </DialogContent>
    </Dialog>
)
