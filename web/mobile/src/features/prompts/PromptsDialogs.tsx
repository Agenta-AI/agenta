import {useCallback, useEffect, useState} from "react"

import {
    folderPathPreview,
    isValidMoveTarget,
    type Folder,
    type FoldersById,
} from "@agenta/entities/workflow"

import {ArchivePromptDialog} from "./dialogs/ArchivePromptDialog"
import {DeleteFolderDialog} from "./dialogs/DeleteFolderDialog"
import {FolderNameDialog} from "./dialogs/FolderNameDialog"
import {MoveToFolderDialog} from "./dialogs/MoveToFolderDialog"
import {RenamePromptDialog} from "./dialogs/RenamePromptDialog"
import type {PromptsDialog} from "./promptDialogState"
import type {usePromptFolderActions} from "./usePromptFolderActions"

type Actions = ReturnType<typeof usePromptFolderActions>

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
        async (work: Promise<{ok: true} | {ok: false; error: string}>) => {
            const result = await work
            if (result.ok) onClose()
            else setError(result.error)
        },
        [onClose],
    )

    const folders: Folder[] = [...foldersById.values()]
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
                open={dialog?.kind === "moveFolder" || dialog?.kind === "movePrompt"}
                itemName={
                    dialog?.kind === "moveFolder"
                        ? (dialog.folder.name ?? "")
                        : dialog?.kind === "movePrompt"
                          ? (dialog.prompt.name ?? "")
                          : ""
                }
                folders={folders}
                initialSelectedId={
                    dialog?.kind === "moveFolder"
                        ? dialog.folder.id
                        : dialog?.kind === "movePrompt"
                          ? (dialog.prompt.folder_id ?? null)
                          : null
                }
                isDisabled={(destinationId) =>
                    dialog?.kind === "moveFolder"
                        ? !isValidMoveTarget({
                              foldersById,
                              item: {kind: "folder", id: dialog.folder.id},
                              destinationId,
                          })
                        : dialog?.kind === "movePrompt"
                          ? !isValidMoveTarget({
                                foldersById,
                                item: {
                                    kind: "prompt",
                                    id: dialog.prompt.id,
                                    folderId: dialog.prompt.folder_id ?? null,
                                },
                                destinationId,
                            })
                          : true
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
