import {useCallback, useEffect, useState, type CSSProperties, type ReactNode} from "react"

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
import {Button} from "@agenta/primitive-ui/components/button"

export interface ConfirmRequest {
    title: ReactNode
    message?: ReactNode
    content?: ReactNode
    okText?: ReactNode
    cancelText?: ReactNode
    danger?: boolean
    okButtonProps?: {danger?: boolean}
    centered?: boolean
    style?: CSSProperties
    onOk?: () => void | Promise<void>
    onCancel?: () => void | Promise<void>
    thirdButtonText?: ReactNode
    onThirdButton?: () => void | Promise<void>
}

export interface ConfirmDialogProps {
    request: ConfirmRequest | null
    onClose: () => void
}

export function ConfirmDialog({request, onClose}: ConfirmDialogProps) {
    const [busy, setBusy] = useState(false)

    return (
        <AlertDialog
            open={request !== null}
            onOpenChange={(open) => {
                if (open || busy) return
                request?.onCancel?.()
                onClose()
            }}
        >
            <AlertDialogContent style={request?.style}>
                <AlertDialogHeader>
                    <AlertDialogTitle>{request?.title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {request?.message ?? request?.content}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {request?.cancelText !== null && (
                        <AlertDialogCancel disabled={busy}>
                            {request?.cancelText ?? "Cancel"}
                        </AlertDialogCancel>
                    )}
                    {request?.thirdButtonText && (
                        <Button
                            variant="outline"
                            disabled={busy}
                            onClick={async () => {
                                try {
                                    setBusy(true)
                                    await request.onThirdButton?.()
                                } finally {
                                    setBusy(false)
                                    onClose()
                                }
                            }}
                        >
                            {request.thirdButtonText}
                        </Button>
                    )}
                    <AlertDialogAction
                        variant={
                            request?.danger || request?.okButtonProps?.danger
                                ? "destructive"
                                : "default"
                        }
                        disabled={busy}
                        aria-busy={busy}
                        onClick={async () => {
                            if (!request) return
                            try {
                                setBusy(true)
                                await request.onOk?.()
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

type ConfirmListener = (request: ConfirmRequest | null) => void

let imperativeRequest: ConfirmRequest | null = null
const imperativeListeners = new Set<ConfirmListener>()

function publishImperativeRequest(request: ConfirmRequest | null) {
    imperativeRequest = request
    imperativeListeners.forEach((listener) => listener(request))
}

export function showConfirmDialog(request: ConfirmRequest) {
    publishImperativeRequest(request)
    return {
        destroy: () => publishImperativeRequest(null),
        update: (nextRequest: Partial<ConfirmRequest>) =>
            publishImperativeRequest({...request, ...nextRequest}),
    }
}

export function ConfirmDialogHost() {
    const [request, setRequest] = useState<ConfirmRequest | null>(imperativeRequest)

    useEffect(() => {
        imperativeListeners.add(setRequest)
        return () => {
            imperativeListeners.delete(setRequest)
        }
    }, [])

    return <ConfirmDialog request={request} onClose={() => publishImperativeRequest(null)} />
}

export function useConfirmDialog() {
    const [request, setRequest] = useState<ConfirmRequest | null>(null)
    const confirm = useCallback((nextRequest: ConfirmRequest) => setRequest(nextRequest), [])
    const closeConfirmDialog = useCallback(() => setRequest(null), [])

    return {
        confirm,
        closeConfirmDialog,
        confirmDialog: <ConfirmDialog request={request} onClose={closeConfirmDialog} />,
    }
}

export default ConfirmDialog
