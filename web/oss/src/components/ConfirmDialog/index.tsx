import {ReactNode, useState} from "react"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@agenta/primitive-ui/components/alert-dialog"

export interface ConfirmRequest {
    title: ReactNode
    message: ReactNode
    okText?: string
    cancelText?: string
    danger?: boolean
    onOk: () => void | Promise<void>
}

/**
 * Controlled shadcn replacement for the imperative antd AlertPopup pattern:
 * hold a ConfirmRequest in state, render <ConfirmDialog>, call the setter to open.
 */
const ConfirmDialog = ({
    request,
    onClose,
}: {
    request: ConfirmRequest | null
    onClose: () => void
}) => {
    const [busy, setBusy] = useState(false)

    return (
        <AlertDialog
            open={request !== null}
            onOpenChange={(open) => {
                if (!open && !busy) onClose()
            }}
        >
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{request?.title}</AlertDialogTitle>
                    <AlertDialogDescription>{request?.message}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={busy}>
                        {request?.cancelText ?? "Cancel"}
                    </AlertDialogCancel>
                    <AlertDialogAction
                        className={request?.danger ? "bg-destructive text-white" : undefined}
                        disabled={busy}
                        onClick={async () => {
                            if (!request) return
                            try {
                                setBusy(true)
                                await request.onOk()
                            } finally {
                                setBusy(false)
                                onClose()
                            }
                        }}
                    >
                        {request?.okText ?? "OK"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    )
}

export default ConfirmDialog
