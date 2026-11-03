import {ConfirmModal} from "../../settings/ConfirmModal"
import {promptsCopy} from "../promptsCopy"

export const ArchivePromptDialog = ({
    open,
    promptName,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    open: boolean
    promptName: string
    pending?: boolean
    error?: string | null
    onConfirm: () => void
    onClose: () => void
}) => (
    <ConfirmModal
        open={open}
        title={promptsCopy.archiveDialog.title}
        description={promptsCopy.archiveDialog.text(promptName)}
        confirmLabel={promptsCopy.archiveDialog.confirm}
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onClose={onClose}
    />
)
