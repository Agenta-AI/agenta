import {useCallback, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"

interface ConfirmRequest {
    title: string
    message: ReactNode
    /** Names the act on the button. Absent falls back to the generic answer. */
    okText?: string
    cancelText?: string
    /** Destructive unless `false`. */
    danger?: boolean
    onOk: () => void | Promise<void>
}

/**
 * The state behind an imperative `confirm({title, message, onOk})`, which the shared settings
 * sections expect (the desktop passes antd's AlertPopup). The caller draws the `AlertDialog`.
 */
export const useConfirmModal = () => {
    const t = useT(commonCatalog)
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

    const runConfirm = useCallback(async () => {
        if (!request) return
        setPending(true)
        try {
            await request.onOk()
            close()
        } catch (cause) {
            setError((cause as Error)?.message || t("common.thatDidNotWork"))
        } finally {
            setPending(false)
        }
    }, [close, request, t])

    return {request, pending, error, confirm, close, runConfirm}
}

export type ConfirmDialogState = ReturnType<typeof useConfirmModal>
