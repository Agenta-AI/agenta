import {useState, type ReactNode} from "react"

import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    LoadingButton,
} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"

/** A pending connection's sign-in was never completed; this finishes it or deletes it. */
export const FinishConnectionDialog = ({
    open,
    name,
    logo,
    onAuthorize,
    onDelete,
    onClose,
}: {
    open: boolean
    name: string
    logo: ReactNode
    /** Starts the provider's sign-in; resolves once its window is open. */
    onAuthorize: () => Promise<void>
    onDelete?: () => void
    onClose: () => void
}) => {
    const [authorizing, setAuthorizing] = useState(false)

    return (
        <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
            <DialogContent className="sm:max-w-[440px]">
                <DialogHeader className="gap-3 text-left">
                    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs [&_img]:size-[18px] [&_img]:object-contain">
                        {logo}
                    </span>
                    <div className="flex flex-col gap-1">
                        <DialogTitle className="text-base font-medium leading-snug">
                            Finish connecting {name}
                        </DialogTitle>
                        <DialogDescription className="text-sm text-colorTextDescription">
                            Its sign-in was never completed, so agents can&apos;t use its tools yet.
                        </DialogDescription>
                    </div>
                </DialogHeader>

                <DialogFooter>
                    {onDelete ? (
                        <Button
                            variant="ghost"
                            className="mr-auto text-destructive"
                            onClick={() => {
                                onClose()
                                onDelete()
                            }}
                        >
                            Delete
                        </Button>
                    ) : null}
                    <Button variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                    <LoadingButton
                        loading={authorizing}
                        onClick={async () => {
                            setAuthorizing(true)
                            try {
                                await onAuthorize()
                                onClose()
                            } finally {
                                setAuthorizing(false)
                            }
                        }}
                    >
                        Authorize
                        <ArrowSquareOut size={14} />
                    </LoadingButton>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
