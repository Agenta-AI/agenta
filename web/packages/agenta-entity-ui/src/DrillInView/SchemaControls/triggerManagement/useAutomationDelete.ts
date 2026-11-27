import {useState} from "react"

/**
 * The "Delete this automation?" dialog's state (F06 f4). While the delete runs the buttons
 * wait; when it fails the dialog stays open and says so, and the automation stays.
 */
export const useAutomationDelete = ({
    onDelete,
    onClose,
}: {
    /** Deletes the automation. Throws when the delete failed. */
    onDelete: () => Promise<void>
    onClose: () => void
}) => {
    const [pending, setPending] = useState(false)
    const [failed, setFailed] = useState(false)

    const close = () => {
        if (pending) return
        setFailed(false)
        onClose()
    }
    const remove = async () => {
        setPending(true)
        setFailed(false)
        try {
            await onDelete()
            setPending(false)
            onClose()
        } catch (error) {
            console.error("[useAutomationDelete] delete failed", error)
            setPending(false)
            setFailed(true)
        }
    }

    return {pending, failed, close, remove}
}
