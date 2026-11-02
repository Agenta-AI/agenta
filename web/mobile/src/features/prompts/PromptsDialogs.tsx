import {useCallback, useEffect, useState} from "react"

import {
    folderPathPreview,
    isValidMoveTarget,
    type Folder,
    type FoldersById,
    type MoveItem,
} from "@agenta/entities/workflow"

import {ArchivePromptDialog} from "./dialogs/ArchivePromptDialog"
import {DeleteFolderDialog} from "./dialogs/DeleteFolderDialog"
import {FolderNameDialog} from "./dialogs/FolderNameDialog"
import {MoveToFolderDialog} from "./dialogs/MoveToFolderDialog"
import {RenamePromptDialog} from "./dialogs/RenamePromptDialog"
import type {PromptsDialog} from "./promptDialogState"
import type {ActionResult, usePromptFolderActions} from "./usePromptFolderActions"

type Actions = ReturnType<typeof usePromptFolderActions>

/** What the move dialog is moving, and the folder the item sits in now. */
const moveTarget = (
    dialog: PromptsDialog | null,
): {name: string; currentId: string | null; item: MoveItem} | null => {
    if (dialog?.kind === "moveFolder") {
        return {
            name: dialog.folder.name ?? "",
            currentId: dialog.folder.id,
            item: {kind: "folder", id: dialog.folder.id},
        }
    }
    if (dialog?.kind === "movePrompt") {
        const folderId = dialog.prompt.folder_id ?? null
        return {
            name: dialog.prompt.name ?? "",
            currentId: folderId,
            item: {kind: "prompt", id: dialog.prompt.id, folderId},
        }
    }
    return null
}

/**
 * Hosts the dialog the page has open: runs its write, shows the failure sentence inside it
 * and closes it when the write is done.
 */
export const PromptsDialogs = ({
    dialog,
    folderId,
    foldersById,
    actions,
    onClose,
}: {
    dialog: PromptsDialog | null
    folderId: string | null
    foldersById: FoldersById
    actions: Actions
    onClose: () => void
}) => {
    const [error, setError] = useState<string | null>(null)
    // A new dialog starts without the last one's failure.
    useEffect(() => setError(null), [dialog])

    const finish = useCallback(
        async (work: Promise<ActionResult>) => {
            const result = await work
            if (result.ok) onClose()
            else setError(result.error)
        },
        [onClose],
    )

    const folders: Folder[] = [...foldersById.values()]
    const move = moveTarget(dialog)
    const common = {pending: actions.pending, error, onClose}

    return (
        <>
            <FolderNameDialog
                {...common}
                open={dialog?.kind === "newFolder" || dialog?.kind === "renameFolder"}
                mode={dialog?.kind === "renameFolder" ? "rename" : "create"}
                initialName={dialog?.kind === "renameFolder" ? (dialog.folder.name ?? "") : ""}
                pathFor={(name) =>
                    folderPathPreview(
                        foldersById,
                        dialog?.kind === "renameFolder"
                            ? (dialog.folder.parent_id ?? null)
                            : folderId,
                        name,
                    )
                }
                onSubmit={(name) => {
                    if (dialog?.kind === "renameFolder") {
                        void finish(actions.renameFolder(dialog.folder, name))
                    } else void finish(actions.createFolder(name))
                }}
            />
            <MoveToFolderDialog
                {...common}
                open={move !== null}
                itemName={move?.name ?? ""}
                folders={folders}
                initialSelectedId={move?.currentId ?? null}
                isDisabled={(destinationId) =>
                    move ? !isValidMoveTarget({foldersById, item: move.item, destinationId}) : true
                }
                onConfirm={(destinationId) => {
                    if (dialog?.kind === "moveFolder") {
                        void finish(actions.moveFolder(dialog.folder, destinationId))
                    } else if (dialog?.kind === "movePrompt") {
                        void finish(actions.movePrompt(dialog.prompt, destinationId))
                    }
                }}
            />
            <DeleteFolderDialog
                {...common}
                open={dialog?.kind === "deleteFolder"}
                folderName={dialog?.kind === "deleteFolder" ? dialog.folder.name : null}
                onConfirm={() => {
                    if (dialog?.kind === "deleteFolder")
                        void finish(actions.deleteFolder(dialog.folder))
                }}
            />
            <ArchivePromptDialog
                {...common}
                open={dialog?.kind === "archivePrompt"}
                promptName={dialog?.kind === "archivePrompt" ? (dialog.prompt.name ?? "") : ""}
                onConfirm={() => {
                    if (dialog?.kind === "archivePrompt") {
                        void finish(actions.archivePrompt(dialog.prompt))
                    }
                }}
            />
            <RenamePromptDialog
                {...common}
                open={dialog?.kind === "renamePrompt"}
                initialName={dialog?.kind === "renamePrompt" ? (dialog.prompt.name ?? "") : ""}
                initialDescription={
                    dialog?.kind === "renamePrompt" ? (dialog.prompt.description ?? "") : ""
                }
                onSubmit={(fields) => {
                    if (dialog?.kind === "renamePrompt") {
                        void finish(actions.renamePrompt(dialog.prompt, fields))
                    }
                }}
            />
        </>
    )
}
