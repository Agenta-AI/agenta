import {useCallback, useState} from "react"

import {ConfirmSheet} from "./ConfirmSheet"

interface ConfirmRequest {
    title: string
    message: string
    onOk: () => void | Promise<void>
}

/**
 * Adapts `ConfirmSheet` (controlled) to the imperative `confirm({title, message, onOk})` the
 * shared settings sections expect — the desktop passes antd's AlertPopup, which is imperative.
 *
 * Returns the sheet to render; a section given no `confirm` hides its destructive actions.
 */
export const useConfirmSheet = () => {
    const [request, setRequest] = useState<ConfirmRequest | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const confirm = useCallback((next: ConfirmRequest) => {
        setError(null)
        setRequest(next)
    }, [])

    const close = useCallback(() => {
        setRequest(null)
        setError(null)
    }, [])

    const sheet = (
        <ConfirmSheet
            open={Boolean(request)}
            title={request?.title ?? ""}
            body={request?.message}
            confirmLabel="Confirm"
            pending={pending}
            error={error}
            onClose={close}
            onConfirm={async () => {
                if (!request) return
                setPending(true)
                try {
                    await request.onOk()
                    close()
                } catch (cause) {
                    setError((cause as Error)?.message || "That did not work")
                } finally {
                    setPending(false)
                }
            }}
        />
    )

    return {confirm, sheet, close}
}
