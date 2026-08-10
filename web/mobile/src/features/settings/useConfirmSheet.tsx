import {useCallback, useEffect, useState} from "react"

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
 *
 * `scope` is whatever the staged action belongs to — the open settings tab, say. The host stays
 * mounted across tabs, so without this a confirmation staged on one tab is still pending on the
 * next and could be resolved against a screen the user has left.
 */
export const useConfirmSheet = (scope?: unknown) => {
    const [request, setRequest] = useState<ConfirmRequest | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const confirm = useCallback((next: ConfirmRequest) => {
        setError(null)
        setRequest(next)
    }, [])

    useEffect(() => {
        setRequest(null)
        setError(null)
        setPending(false)
    }, [scope])

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

    return {confirm, sheet}
}
