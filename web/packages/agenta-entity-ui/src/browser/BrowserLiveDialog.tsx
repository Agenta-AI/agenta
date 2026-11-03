import type {ReactNode} from "react"

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@agenta/ui/ui"

import {BrowserLiveView} from "./BrowserLiveView"

export interface BrowserLiveDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    description?: ReactNode
    sessionId: string
}

export const BrowserLiveDialog = ({
    open,
    onOpenChange,
    title,
    description,
    sessionId,
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
            <BrowserLiveView sessionId={sessionId} />
        </DialogContent>
    </Dialog>
)
