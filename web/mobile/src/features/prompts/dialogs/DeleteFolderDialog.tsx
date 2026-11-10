import {FolderIcon} from "@phosphor-icons/react"

import {ConfirmModal} from "../../settings/ConfirmModal"
import {promptsCopy} from "../promptsCopy"

/** Confirms deleting a folder. The server deletes its subfolders too and keeps the prompts. */
export const DeleteFolderDialog = ({
    open,
    folderName,
    pending,
    error,
    onConfirm,
    onClose,
}: {
    open: boolean
    folderName?: string | null
    pending?: boolean
    error?: string | null
    onConfirm: () => void
    onClose: () => void
}) => (
    <ConfirmModal
        open={open}
        title={promptsCopy.deleteDialog.title}
        description={promptsCopy.deleteDialog.description}
        body={
            <div className="flex flex-col gap-2">
                <span>{promptsCopy.deleteDialog.about}</span>
                <span className="flex min-w-0 items-center gap-2 font-medium">
                    <FolderIcon className="size-4 shrink-0" />
                    <span className="truncate">
                        {folderName || promptsCopy.deleteDialog.fallbackName}
                    </span>
                </span>
            </div>
        }
        confirmLabel={promptsCopy.deleteDialog.confirm}
        solid
        pending={pending}
        error={error}
        onConfirm={onConfirm}
        onClose={onClose}
    />
)
